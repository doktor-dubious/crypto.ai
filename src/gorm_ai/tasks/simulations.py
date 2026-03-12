"""Simulation Celery tasks."""

import asyncio
from datetime import UTC, date, datetime

from gorm_ai.tasks.celery_app import celery_app


@celery_app.task(bind=True, name="gorm_ai.tasks.simulations.run_simulation_task", time_limit=604800, soft_time_limit=604200)  # 7 days / 6 days 23.5 hrs
def run_simulation_task(self, request_data: dict) -> dict:
    """Run a simulation task asynchronously."""
    return asyncio.run(_run_simulation_async(self.request.id, request_data))


async def _run_simulation_async(task_id: str, request_data: dict) -> dict:
    from gorm_ai.database.connection import task_session
    from gorm_ai.schemas.simulation import SimulationRequest
    from gorm_ai.services.simulation import SimulationService
    from gorm_ai.services.task import TaskService

    async with task_session() as session:
        sim_name = request_data.get("name") or (
            f"Simulation {request_data.get('simulation_from')} – {request_data.get('simulation_to')}"
        )
        await TaskService(session).update_status(task_id, "started", started_at=datetime.now(UTC), name=sim_name)
        await session.commit()

    try:
        if isinstance(request_data.get("simulation_from"), str):
            request_data["simulation_from"] = date.fromisoformat(request_data["simulation_from"])
        if isinstance(request_data.get("simulation_to"), str):
            request_data["simulation_to"] = date.fromisoformat(request_data["simulation_to"])

        request = SimulationRequest(**request_data)

        async def _on_progress(progress: int, message: str) -> None:
            async with task_session() as s:
                await TaskService(s).update_progress(task_id, progress, message)
                await s.commit()

        async with task_session() as session:
            service = SimulationService(session)
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
