"""Simulation Celery tasks."""

import asyncio
from datetime import UTC, date, datetime

from fastapi import HTTPException

from gorm_ai.tasks.celery_app import celery_app


@celery_app.task(bind=True, name="gorm_ai.tasks.simulations.run_simulation_task", time_limit=604800, soft_time_limit=604200)  # 7 days / 6 days 23.5 hrs
def run_simulation_task(self, request_data: dict) -> dict:
    """Run a simulation task asynchronously."""
    return asyncio.run(_run_simulation_async(self.request.id, request_data, self.request.hostname))


async def _run_simulation_async(task_id: str, request_data: dict, hostname: str | None = None) -> dict:
    from gorm_ai.database.connection import task_session
    from gorm_ai.schemas.simulation import SimulationRequest
    from gorm_ai.services.simulation import SimulationService
    from gorm_ai.services.task import TaskService

    # Extract friendly worker name from Celery hostname (e.g. "celery@runpod-gpu" -> "runpod-gpu")
    worker_name = (hostname or "").split("@", 1)[-1] or None

    async with task_session() as session:
        # Guard against redelivery after worker restart.
        # Only run tasks that are still pending – any other status means
        # the task already ran, was cancelled, or failed previously.
        ts = TaskService(session)
        try:
            record = await ts.get(task_id)
            if record.status != "pending":
                return {"skipped": True, "reason": f"task status is {record.status}"}
        except HTTPException:
            # Unknown task ID → redelivered zombie, skip it
            return {"skipped": True, "reason": "redelivered task not in DB"}

        sfrom = request_data.get("simulation_from", "")
        sto = request_data.get("simulation_to", "")
        sim_name = request_data.get("name") or f"Simulation {sfrom} – {sto}"
        if request_data.get("resume_simulation_id"):
            sim_name = "Resuming simulation"
        await ts.update_status(task_id, "started", started_at=datetime.now(UTC), name=sim_name, worker_name=worker_name)
        await session.commit()

    try:
        resume_simulation_id = request_data.pop("resume_simulation_id", None)

        if isinstance(request_data.get("simulation_from"), str):
            request_data["simulation_from"] = date.fromisoformat(request_data["simulation_from"])
        if isinstance(request_data.get("simulation_to"), str):
            request_data["simulation_to"] = date.fromisoformat(request_data["simulation_to"])

        async def _on_progress(progress: int, message: str) -> None:
            from gorm_ai.tasks.celery_app import get_current_metrics
            async with task_session() as s:
                ts = TaskService(s)
                await ts.update_progress(task_id, progress, message)
                peak_mem, cpu_time = get_current_metrics(task_id)
                if peak_mem is not None:
                    await ts.update_resource_metrics(task_id, peak_mem, cpu_time)
                await s.commit()

        async with task_session() as session:
            service = SimulationService(session)
            if resume_simulation_id:
                result = await service.resume_simulation(
                    resume_simulation_id, task_id=task_id, on_progress=_on_progress,
                )
            else:
                request = SimulationRequest(**request_data)
                result = await service.run_simulation(request, task_id=task_id, on_progress=_on_progress)
            await session.commit()

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "success", completed_at=datetime.now(UTC)
            )
            await session.commit()

        return result.model_dump(mode="json")

    except Exception as e:
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e)
            )
            await session.commit()
        raise
