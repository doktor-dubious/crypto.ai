"""Pydantic schemas for request/response validation."""

from gorm_ai.schemas.configuration import ConfigurationResponse, ConfigurationUpdate
from gorm_ai.schemas.customer import (
    CustomerCreate,
    CustomerResponse,
    CustomerUpdate,
)
from gorm_ai.schemas.customer_configuration import (
    CustomerConfigurationCreate,
    CustomerConfigurationResponse,
    CustomerConfigurationUpdate,
)
from gorm_ai.schemas.draw_adjustment import (
    AdjustmentType,
    DrawAdjustmentCreate,
    DrawAdjustmentResponse,
    DrawAdjustmentUpdate,
)
from gorm_ai.schemas.outlet import (
    OutletCreate,
    OutletDeliveryCreate,
    OutletDeliveryResponse,
    OutletInfoCreate,
    OutletInfoResponse,
    OutletResponse,
    OutletUpdate,
)
from gorm_ai.schemas.outlet_group import (
    OutletGroupCreate,
    OutletGroupMemberCreate,
    OutletGroupResponse,
    OutletGroupUpdate,
)
from gorm_ai.schemas.prediction import (
    PredictionRequest,
    PredictionResponse,
    PredictionResult,
    PredictionTaskStatus,
)
from gorm_ai.schemas.sales import (
    SalesBulkImport,
    SalesCreate,
    SalesQuery,
    SalesResponse,
    SalesUpdate,
)

__all__ = [
    "AdjustmentType",
    "ConfigurationResponse",
    "ConfigurationUpdate",
    "CustomerConfigurationCreate",
    "CustomerConfigurationResponse",
    "CustomerConfigurationUpdate",
    "CustomerCreate",
    "CustomerResponse",
    "CustomerUpdate",
    "DrawAdjustmentCreate",
    "DrawAdjustmentResponse",
    "DrawAdjustmentUpdate",
    "OutletCreate",
    "OutletDeliveryCreate",
    "OutletDeliveryResponse",
    "OutletGroupCreate",
    "OutletGroupMemberCreate",
    "OutletGroupResponse",
    "OutletGroupUpdate",
    "OutletInfoCreate",
    "OutletInfoResponse",
    "OutletResponse",
    "OutletUpdate",
    "PredictionRequest",
    "PredictionResponse",
    "PredictionResult",
    "PredictionTaskStatus",
    "SalesBulkImport",
    "SalesCreate",
    "SalesQuery",
    "SalesResponse",
    "SalesUpdate",
]
