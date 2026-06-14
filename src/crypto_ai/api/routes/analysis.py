"""Analysis API routes for sales data insights."""

from fastapi import APIRouter

from crypto_ai.api.deps import AnalysisServiceDep
from crypto_ai.schemas.analysis import (
    AnalysisRequest,
    DataQualityResponse,
    DeliveryPerformanceResponse,
    OutlierResponse,
    PatternsResponse,
    SegmentationResponse,
)

router = APIRouter()


@router.post("/data-quality", response_model=DataQualityResponse)
async def get_data_quality(
    data: AnalysisRequest,
    service: AnalysisServiceDep,
) -> DataQualityResponse:
    """Analyze data quality: missing data, zero-sales, discrepancies, level shifts."""
    result = await service.get_data_quality(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    return DataQualityResponse(**result)


@router.post("/outliers", response_model=OutlierResponse)
async def get_outliers(
    data: AnalysisRequest,
    service: AnalysisServiceDep,
) -> OutlierResponse:
    """Detect recurring and non-recurring outliers in sales and delivery data."""
    result = await service.get_outliers(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    return OutlierResponse(**result)


@router.post("/patterns", response_model=PatternsResponse)
async def get_patterns(
    data: AnalysisRequest,
    service: AnalysisServiceDep,
) -> PatternsResponse:
    """Analyze trends, changepoints, seasonality, weekday effects, and divergent outlets."""
    result = await service.get_patterns(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    return PatternsResponse(**result)


@router.post("/delivery-performance", response_model=DeliveryPerformanceResponse)
async def get_delivery_performance(
    data: AnalysisRequest,
    service: AnalysisServiceDep,
) -> DeliveryPerformanceResponse:
    """Analyze delivery performance: returns, sold-outs, weekday efficiency, fixed accounts."""
    result = await service.get_delivery_performance(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    return DeliveryPerformanceResponse(**result)


@router.post("/segmentation", response_model=SegmentationResponse)
async def get_segmentation(
    data: AnalysisRequest,
    service: AnalysisServiceDep,
) -> SegmentationResponse:
    """Segment outlets by seasonal profile, predictability, and correlation clusters."""
    result = await service.get_segmentation(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    return SegmentationResponse(**result)
