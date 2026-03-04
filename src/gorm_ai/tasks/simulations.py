"""Simulation Celery tasks."""

import asyncio
from datetime import date

from gorm_ai.tasks.celery_app import celery_app


@celery_app.task(bind=True, name="gorm_ai.tasks.simulations.run_simulation_task")
def run_simulation_task(self, request_data: dict) -> dict:
    """Run a simulation task asynchronously."""
    return asyncio.run(_run_simulation_async(request_data))


async def _run_simulation_async(request_data: dict) -> dict:
    from gorm_ai.database.connection import async_session_factory
    from gorm_ai.schemas.simulation import SimulationRequest
    from gorm_ai.services.simulation import SimulationService

    if isinstance(request_data.get("simulation_from"), str):
        request_data["simulation_from"] = date.fromisoformat(request_data["simulation_from"])
    if isinstance(request_data.get("simulation_to"), str):
        request_data["simulation_to"] = date.fromisoformat(request_data["simulation_to"])

    request = SimulationRequest(**request_data)

    async with async_session_factory() as session:
        service = SimulationService(session)
        result = await service.run_simulation(request)
        await session.commit()

    return result.model_dump(mode="json")
