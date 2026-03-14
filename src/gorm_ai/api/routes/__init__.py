"""API routes package."""

from fastapi import APIRouter

from gorm_ai.api.routes import (
    configuration,
    currencies,
    customers,
    draw_adjustments,
    outlet_groups,
    outlets,
    pads,
    predefined_pads,
    prediction_engines,
    prediction_strategies,
    predictions,
    sales,
    sales_filters,
    simulation_strategies,
    simulations,
    tasks,
)

api_router = APIRouter()

api_router.include_router(configuration.router, prefix="/configuration", tags=["configuration"])
api_router.include_router(currencies.router, prefix="/currencies", tags=["currencies"])
api_router.include_router(customers.router, prefix="/customers", tags=["customers"])
api_router.include_router(outlets.router, prefix="/outlets", tags=["outlets"])
api_router.include_router(outlet_groups.router, prefix="/outlet-groups", tags=["outlet-groups"])
api_router.include_router(
    draw_adjustments.router, prefix="/draw-adjustments", tags=["draw-adjustments"]
)
api_router.include_router(pads.router, prefix="/pads", tags=["pads"])
api_router.include_router(predefined_pads.router, prefix="/predefined-pads", tags=["predefined-pads"])
api_router.include_router(prediction_engines.router, prefix="/prediction-engines", tags=["prediction-engines"])
api_router.include_router(sales.router, prefix="/sales", tags=["sales"])
api_router.include_router(
    prediction_strategies.router, prefix="/prediction-strategies", tags=["prediction-strategies"]
)
api_router.include_router(predictions.router, prefix="/predictions", tags=["predictions"])
api_router.include_router(
    simulation_strategies.router, prefix="/simulation-strategies", tags=["simulation-strategies"]
)
api_router.include_router(simulations.router, prefix="/simulations", tags=["simulations"])
api_router.include_router(sales_filters.router, prefix="/sales-filters", tags=["sales-filters"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])

__all__ = ["api_router"]
