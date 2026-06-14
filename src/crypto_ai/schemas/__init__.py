"""Pydantic schemas for request/response validation."""

from crypto_ai.schemas.configuration import ConfigurationResponse, ConfigurationUpdate
from crypto_ai.schemas.customer import (
    CustomerCreate,
    CustomerResponse,
    CustomerUpdate,
)
from crypto_ai.schemas.customer_configuration import (
    CustomerConfigurationCreate,
    CustomerConfigurationResponse,
    CustomerConfigurationUpdate,
)
from crypto_ai.schemas.outlet import (
    OutletCreate,
    OutletDeliveryCreate,
    OutletDeliveryResponse,
    OutletInfoCreate,
    OutletInfoResponse,
    OutletResponse,
    OutletUpdate,
)
from crypto_ai.schemas.outlet_group import (
    OutletGroupCreate,
    OutletGroupMemberCreate,
    OutletGroupResponse,
    OutletGroupUpdate,
)
from crypto_ai.schemas.prediction import (
    PredictionRequest,
    PredictionResponse,
    PredictionResult,
    PredictionTaskStatus,
)
from crypto_ai.schemas.prediction_adjustment import (
    AdjustmentType,
    PredictionAdjustmentCreate,
    PredictionAdjustmentResponse,
    PredictionAdjustmentUpdate,
)
from crypto_ai.schemas.sales import (
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
    "PredictionAdjustmentCreate",
    "PredictionAdjustmentResponse",
    "PredictionAdjustmentUpdate",
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
