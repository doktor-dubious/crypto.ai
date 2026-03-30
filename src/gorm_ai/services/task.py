"""Task record service."""

import asyncio
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.task_record import TaskRecord
from gorm_ai.schemas.task import CeleryWorkerTask

# Lazy import to avoid circular dependencies
_Simulation = None


def _get_simulation_model():
    global _Simulation
    if _Simulation is None:
        from gorm_ai.database.models.simulation import Simulation
        _Simulation = Simulation
    return _Simulation


def _restart_worker_container() -> None:
    """Restart the celery-worker Docker container (blocking call)."""
    import docker  # type: ignore

    client = docker.from_env()
    containers = client.containers.list(
        all=True,
        filters={"label": "com.docker.compose.service=celery-worker"},
    )
    for container in containers:
        container.restart()


class TaskService:
    """Service for task record operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(
        self,
        task_id: str,
        task_type: str,
        customer_id: str | None = None,
        name: str | None = None,
        request_data: dict | None = None,
    ) -> TaskRecord:
        """Create a new task record with status 'pending'."""
        record = TaskRecord(
            task_id=task_id,
            type=task_type,
            status="pending",
            customer_id=customer_id,
            name=name,
            request_data=request_data,
        )
        self.session.add(record)
        await self.session.flush()
        await self.session.refresh(record)
        return record

    async def update_progress(
        self,
        task_id: str,
        progress: int,
        message: str | None = None,
    ) -> None:
        """Update progress (0-100) and optional message for a running task."""
        values: dict = {
            "progress": progress,
            "updated_at": datetime.now(UTC),
        }
        if message is not None:
            values["progress_message"] = message
        await self.session.execute(
            update(TaskRecord).where(TaskRecord.task_id == task_id).values(**values)
        )

    async def update_status(
        self,
        task_id: str,
        status: str,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        error: str | None = None,
        name: str | None = None,
        worker_name: str | None = None,
    ) -> None:
        """Update status (and optional timestamps/error) for a task."""
        values: dict = {"status": status}
        if started_at is not None:
            values["started_at"] = started_at
        if completed_at is not None:
            values["completed_at"] = completed_at
        if error is not None:
            values["error"] = error
        if name is not None:
            values["name"] = name
        if worker_name is not None:
            values["worker_name"] = worker_name
        await self.session.execute(
            update(TaskRecord).where(TaskRecord.task_id == task_id).values(**values)
        )

    async def get(self, task_id: str) -> TaskRecord:
        """Get a task record by Celery task ID. Raises 404 if not found."""
        result = await self.session.execute(
            select(TaskRecord).where(TaskRecord.task_id == task_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            raise HTTPException(status_code=404, detail=f"Task {task_id!r} not found")
        return record

    async def get_by_record_id(self, record_id: str) -> TaskRecord | None:
        """Get a task record by its UUID primary key."""
        result = await self.session.execute(
            select(TaskRecord).where(TaskRecord.id == record_id)
        )
        return result.scalar_one_or_none()

    async def list_tasks(
        self,
        customer_id: str | None = None,
        task_type: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[TaskRecord], int]:
        """List task records with optional filters. Returns (items, total)."""
        base_where = [TaskRecord.active.is_(True)]
        if customer_id is not None:
            base_where.append(TaskRecord.customer_id == customer_id)
        if task_type is not None:
            base_where.append(TaskRecord.type == task_type)
        if status is not None:
            base_where.append(TaskRecord.status == status)

        count_result = await self.session.execute(
            select(func.count()).select_from(TaskRecord).where(*base_where)
        )
        total = count_result.scalar_one()

        result = await self.session.execute(
            select(TaskRecord)
            .where(*base_where)
            .order_by(TaskRecord.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        items = list(result.scalars().all())
        return items, total

    async def update_resource_metrics(
        self,
        task_id: str,
        peak_memory_mb: float | None,
        cpu_time_s: float | None,
    ) -> None:
        """Store resource usage metrics after a task completes."""
        values: dict = {}
        if peak_memory_mb is not None:
            values["peak_memory_mb"] = peak_memory_mb
        if cpu_time_s is not None:
            values["cpu_time_s"] = cpu_time_s
        if not values:
            return
        await self.session.execute(
            update(TaskRecord).where(TaskRecord.task_id == task_id).values(**values)
        )

    async def cancel(self, task_id: str) -> None:
        """Revoke a Celery task and mark its record as 'revoked'.

        With the solo pool the worker is blocked on computation and cannot
        process ``revoke`` control commands.  When the task being cancelled
        is currently running (status='started'), we restart the worker
        container to actually kill it.  The redelivery guard in each task
        (``if record.status != 'pending': skip``) ensures the revoked task
        won't re-run after the restart.
        """
        record = await self.get(task_id)
        is_running = record.status == "started"

        await self.update_status(task_id, "revoked", completed_at=datetime.now(UTC))

        # Also mark any associated finetune record as cancelled so its
        # status column reflects the cancellation correctly.
        if record.type == "finetune":
            from gorm_ai.database.models.fine_tune import FineTune
            result = await self.session.execute(
                select(FineTune).where(FineTune.task_id == task_id)
            )
            ft = result.scalar_one_or_none()
            if ft and ft.end_condition is None:
                ft.end_condition = "cancelled"
                ft.ended_at = datetime.now(UTC)

        await self.session.commit()

        if is_running:
            # Restart the worker container so the running task is actually killed.
            await asyncio.to_thread(_restart_worker_container)
        else:
            # Pending task: a normal revoke is sufficient.
            from gorm_ai.tasks.celery_app import celery_app
            await asyncio.to_thread(celery_app.control.revoke, task_id, terminate=True)

    async def mark_stale_pending_revoked(self, stale_seconds: int = 86400 * 7) -> int:
        """Mark pending tasks as revoked if they have been waiting too long.

        A task stuck in 'pending' for longer than ``stale_seconds`` was likely
        lost (worker restarted with --purge, Redis flush, etc.) and will never
        be picked up.

        Skips cleanup when a task is currently running ('started'), since
        pending tasks may be legitimately queued behind it.
        """
        # Don't revoke pending tasks while another task is actively running —
        # they may just be waiting their turn.
        running = await self.session.execute(
            select(func.count()).select_from(TaskRecord).where(TaskRecord.status == "started")
        )
        if running.scalar_one() > 0:
            return 0

        cutoff = datetime.now(UTC) - timedelta(seconds=stale_seconds)
        result = await self.session.execute(
            update(TaskRecord)
            .where(
                TaskRecord.status == "pending",
                TaskRecord.created_at < cutoff,
            )
            .values(
                status="revoked",
                error="Timed out waiting for worker",
                completed_at=datetime.now(UTC),
            )
            .returning(TaskRecord.id)
        )
        return len(result.all())

    async def _close_associated_records_for_tasks(
        self,
        task_ids: list[str],
        end_condition: str = "worker_terminated",
    ) -> None:
        """Close simulations and finetunes linked to the given tasks."""
        if not task_ids:
            return
        # Resolve task record UUIDs → celery task_id strings
        rows = await self.session.execute(
            select(TaskRecord.task_id)
            .where(TaskRecord.id.in_(task_ids))
        )
        celery_task_ids = [r[0] for r in rows.all() if r[0]]
        if not celery_task_ids:
            return

        now = datetime.now(UTC)

        # Close simulations
        sim_model = _get_simulation_model()
        await self.session.execute(
            update(sim_model)
            .where(
                sim_model.task_id.in_(celery_task_ids),
                sim_model.ended_at.is_(None),
            )
            .values(ended_at=now)
        )

        # Close finetunes
        from gorm_ai.database.models.fine_tune import FineTune
        await self.session.execute(
            update(FineTune)
            .where(
                FineTune.task_id.in_(celery_task_ids),
                FineTune.end_condition.is_(None),
            )
            .values(end_condition=end_condition, ended_at=now)
        )

    async def mark_stale_tasks_failed(self, stale_seconds: int = 0) -> int:
        """Mark all 'started' tasks as failed.

        Called only when the worker container is confirmed down, so any
        task still marked 'started' will never complete.  ``stale_seconds``
        can optionally require that updated_at is older than N seconds.
        """
        wheres = [TaskRecord.status == "started"]
        if stale_seconds > 0:
            cutoff = datetime.now(UTC) - timedelta(seconds=stale_seconds)
            wheres.append(TaskRecord.updated_at < cutoff)
        result = await self.session.execute(
            update(TaskRecord)
            .where(*wheres)
            .values(
                status="failure",
                error="Worker lost",
                completed_at=datetime.now(UTC),
            )
            .returning(TaskRecord.id)
        )
        rows = result.all()
        await self._close_associated_records_for_tasks([r[0] for r in rows])
        return len(rows)

    async def get_active_worker_names(self) -> set[str]:
        """Return short worker names that have at least one running task."""
        result = await self.session.execute(
            select(TaskRecord.worker_name)
            .where(
                TaskRecord.status.in_(("started", "pending")),
                TaskRecord.worker_name.isnot(None),
            )
            .distinct()
        )
        return {row[0] for row in result.all()}

    async def get_recently_active_worker_names(
        self,
        seconds: int = 1800,
    ) -> set[str]:
        """Return worker names with started tasks updated recently.

        A task whose ``updated_at`` is within *seconds* was making
        progress recently (via progress callbacks).  Even if the worker
        is temporarily unreachable (e.g. instance syncing), it is very
        likely still alive and should not be considered orphaned.
        """
        cutoff = datetime.now(UTC) - timedelta(seconds=seconds)
        result = await self.session.execute(
            select(TaskRecord.worker_name)
            .where(
                TaskRecord.status == "started",
                TaskRecord.worker_name.isnot(None),
                TaskRecord.updated_at >= cutoff,
            )
            .distinct()
        )
        return {row[0] for row in result.all()}

    async def mark_orphaned_worker_tasks_failed(
        self,
        alive_worker_names: set[str],
        stale_seconds: int = 600,
    ) -> int:
        """Mark 'started' tasks as failed when their worker is no longer alive.

        ``alive_worker_names`` contains the short worker names (e.g. ``local``,
        ``runpod-gpu``) of workers confirmed to be online.  Any task whose
        ``worker_name`` is set and *not* in this set is orphaned — its worker
        died (e.g. a RunPod instance was terminated) and the task will never
        complete.

        To avoid false positives with solo-pool workers that are simply busy
        (and therefore can't respond to ping), a task is only marked failed
        if its ``updated_at`` is older than ``stale_seconds``.  Progress
        callbacks update this timestamp, so a task that is still making
        progress will not be killed.
        """
        if not alive_worker_names:
            # No workers alive at all — fall back to mark_stale_tasks_failed
            return 0

        cutoff = datetime.now(UTC) - timedelta(seconds=stale_seconds)

        # Find started tasks whose worker is known but not alive
        # AND that haven't been updated recently (no progress callbacks)
        result = await self.session.execute(
            update(TaskRecord)
            .where(
                TaskRecord.status == "started",
                TaskRecord.worker_name.isnot(None),
                TaskRecord.worker_name.notin_(alive_worker_names),
                TaskRecord.updated_at < cutoff,
            )
            .values(
                status="failure",
                error="Worker lost (instance terminated)",
                completed_at=datetime.now(UTC),
            )
            .returning(TaskRecord.id)
        )
        rows = result.all()
        await self._close_associated_records_for_tasks([r[0] for r in rows])
        return len(rows)

    async def mark_worker_tasks_failed(self, worker_name: str) -> int:
        """Mark all 'started' tasks for a specific worker as failed.

        Called on worker startup to clean up tasks that survived a restart.
        When a worker restarts with the same name, its old tasks will never
        complete but the orphan detection won't catch them (since the worker
        name is still alive).
        """
        result = await self.session.execute(
            update(TaskRecord)
            .where(
                TaskRecord.status == "started",
                TaskRecord.worker_name == worker_name,
            )
            .values(
                status="failure",
                error="Worker restarted",
                completed_at=datetime.now(UTC),
            )
            .returning(TaskRecord.id)
        )
        rows = result.all()
        await self._close_associated_records_for_tasks([r[0] for r in rows])
        return len(rows)

    async def get_active_from_db(self) -> list[CeleryWorkerTask]:
        """Return 'started' tasks from DB.

        Fallback for solo pool where inspect().active() can't respond
        because the worker thread is blocked on computation.
        """
        result = await self.session.execute(
            select(TaskRecord).where(TaskRecord.status == "started")
        )
        return [
            CeleryWorkerTask(
                task_id=r.task_id,
                name=r.name or r.type,
                worker="(busy)",
                args=[],
            )
            for r in result.scalars().all()
        ]

    async def get_active(self) -> list[CeleryWorkerTask]:
        """Return live active tasks from Celery workers."""
        from gorm_ai.tasks.celery_app import celery_app

        def _inspect() -> dict | None:
            return celery_app.control.inspect(timeout=1).active()

        result = await asyncio.to_thread(_inspect)
        return self._parse_inspect(result)

    async def get_pending(self) -> list[CeleryWorkerTask]:
        """Return reserved (queued-but-not-started) tasks from Celery workers."""
        from gorm_ai.tasks.celery_app import celery_app

        def _inspect() -> dict | None:
            return celery_app.control.inspect(timeout=1).reserved()

        result = await asyncio.to_thread(_inspect)
        return self._parse_inspect(result)

    @staticmethod
    def _parse_inspect(result: dict | None) -> list[CeleryWorkerTask]:
        if not result:
            return []
        tasks = []
        for worker, task_list in result.items():
            for task in task_list or []:
                tasks.append(
                    CeleryWorkerTask(
                        task_id=task.get("id", ""),
                        name=task.get("name", ""),
                        worker=worker,
                        args=list(task.get("args", [])),
                    )
                )
        return tasks
