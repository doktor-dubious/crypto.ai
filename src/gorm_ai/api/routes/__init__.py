"""API routes package."""

from fastapi import APIRouter

from gorm_ai.api.routes import (
    configuration,
    customers,
    draw_adjustments,
    outlet_groups,
    outlets,
    pads,
    predictions,
    sales,
    simulations,
)

api_router = APIRouter()

api_router.include_router(configuration.router, prefix="/configuration", tags=["configuration"])
api_router.include_router(customers.router, prefix="/customers", tags=["customers"])
api_router.include_router(outlets.router, prefix="/outlets", tags=["outlets"])
api_router.include_router(outlet_groups.router, prefix="/outlet-groups", tags=["outlet-groups"])
api_router.include_router(
    draw_adjustments.router, prefix="/draw-adjustments", tags=["draw-adjustments"]
)
api_router.include_router(pads.router, prefix="/pads", tags=["pads"])
api_router.include_router(sales.router, prefix="/sales", tags=["sales"])
api_router.include_router(predictions.router, prefix="/predictions", tags=["predictions"])
api_router.include_router(simulations.router, prefix="/simulations", tags=["simulations"])

__all__ = ["api_router"]
