"""Task record service."""

import asyncio
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.task_record import TaskRecord
from gorm_ai.schemas.task import CeleryWorkerTask


class TaskService:
    """Service for task record operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(
        self,
        task_id: str,
        task_type: str,
        customer_id: str | None = None,
    ) -> TaskRecord:
        """Create a new task record with status 'pending'."""
        record = TaskRecord(
            task_id=task_id,
            type=task_type,
            status="pending",
            customer_id=customer_id,
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
        values: dict = {"progress": progress}
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
    ) -> None:
        """Update status (and optional timestamps/error) for a task."""
        values: dict = {"status": status}
        if started_at is not None:
            values["started_at"] = started_at
        if completed_at is not None:
            values["completed_at"] = completed_at
        if error is not None:
            values["error"] = error
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

    async def list_tasks(
        self,
        customer_id: str | None = None,
        task_type: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[TaskRecord], int]:
        """List task records with optional filters. Returns (items, total)."""
        base_where = []
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

    async def cancel(self, task_id: str) -> None:
        """Revoke a Celery task and mark its record as 'revoked'."""
        from gorm_ai.tasks.celery_app import celery_app

        await asyncio.to_thread(celery_app.control.revoke, task_id, terminate=True)
        await self.update_status(task_id, "revoked", completed_at=datetime.now(UTC))

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
