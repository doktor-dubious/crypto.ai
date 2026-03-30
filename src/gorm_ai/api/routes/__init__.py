"""API routes package."""

from fastapi import APIRouter

from gorm_ai.api.routes import (
    analysis,
    configuration,
    currencies,
    customers,
    financial_dates,
    fine_tunes,
    finetune_examinations,
    import_templates,
    logs,
    optimization,
    outlet_groups,
    outlets,
    pads,
    predefined_pads,
    prediction_adjustments,
    prediction_engines,
    prediction_strategies,
    predictions,
    sales,
    sales_filters,
    simulation_filters,
    simulation_strategies,
    simulations,
    tasks,
)

api_router = APIRouter()

api_router.include_router(analysis.router, prefix="/analysis", tags=["analysis"])
api_router.include_router(configuration.router, prefix="/configuration", tags=["configuration"])
api_router.include_router(fine_tunes.router, prefix="/fine-tunes", tags=["fine-tunes"])
api_router.include_router(
    finetune_examinations.router, prefix="/finetune-examinations", tags=["finetune-examinations"]
)
api_router.include_router(logs.router, prefix="/logs", tags=["logs"])
api_router.include_router(currencies.router, prefix="/currencies", tags=["currencies"])
api_router.include_router(customers.router, prefix="/customers", tags=["customers"])
api_router.include_router(financial_dates.router, prefix="/financial-dates", tags=["financial-dates"])
api_router.include_router(import_templates.router, prefix="/import-templates", tags=["import-templates"])
api_router.include_router(optimization.router, prefix="/optimization", tags=["optimization"])
api_router.include_router(outlets.router, prefix="/outlets", tags=["outlets"])
api_router.include_router(outlet_groups.router, prefix="/outlet-groups", tags=["outlet-groups"])
api_router.include_router(
    prediction_adjustments.router, prefix="/prediction-adjustments", tags=["prediction-adjustments"]
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
    simulation_filters.router, prefix="/simulation-filters", tags=["simulation-filters"]
)
api_router.include_router(
    simulation_strategies.router, prefix="/simulation-strategies", tags=["simulation-strategies"]
)
api_router.include_router(simulations.router, prefix="/simulations", tags=["simulations"])
api_router.include_router(sales_filters.router, prefix="/sales-filters", tags=["sales-filters"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])

__all__ = ["api_router"]
