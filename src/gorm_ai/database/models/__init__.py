"""Database models."""

# Import Sales first since it uses a different base class
from gorm_ai.database.models.sales import Sales
from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.customer import Customer
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.draw_adjustment import DrawAdjustment
from gorm_ai.database.models.financial_date import FinancialDate, OutletFinancialDate
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_delivery import OutletDelivery
from gorm_ai.database.models.outlet_financials import OutletFinancials
from gorm_ai.database.models.outlet_group import OutletGroup, OutletGroupMember
from gorm_ai.database.models.outlet_info import OutletInfo
from gorm_ai.database.models.pad import Pad, PadDate
from gorm_ai.database.models.prediction_strategy import PredictionStrategy
from gorm_ai.database.models.sales_filter import SalesFilter
from gorm_ai.database.models.prediction_engine import PredictionEngine

__all__ = [
    "Configuration",
    "Customer",
    "CustomerConfiguration",
    "DrawAdjustment",
    "FinancialDate",
    "OutletFinancialDate",
    "Outlet",
    "OutletDelivery",
    "OutletFinancials",
    "OutletGroup",
    "OutletGroupMember",
    "OutletInfo",
    "Pad",
    "PadDate",
    "PredictionEngine",
    "PredictionStrategy",
    "Sales",
    "SalesFilter",
]
