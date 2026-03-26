"""Database models."""

# isort:skip_file
# Import Sales first since it uses a different base class (TimescaleDB hypertable)
from gorm_ai.database.models.sales import Sales
from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.covariate import Covariate, CovariateOutlet
from gorm_ai.database.models.last_prediction import LastPrediction
from gorm_ai.database.models.currency import Currency
from gorm_ai.database.models.customer import Customer
from gorm_ai.database.models.finetune_progress import FinetuneProgress
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.import_template import ImportTemplate, ImportTemplateElement
from gorm_ai.database.models.prediction_adjustment import PredictionAdjustment
from gorm_ai.database.models.financial_date import FinancialDate, OutletFinancialDate
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_delivery import OutletDelivery
from gorm_ai.database.models.outlet_financials import OutletFinancials
from gorm_ai.database.models.outlet_group import OutletGroup, OutletGroupMember
from gorm_ai.database.models.outlet_info import OutletInfo
from gorm_ai.database.models.pad import Pad, PadDate
from gorm_ai.database.models.predefined_pad import PredefinedPad, PredefinedPadDate
from gorm_ai.database.models.prediction import Prediction
from gorm_ai.database.models.prediction_engine import PredictionEngine
from gorm_ai.database.models.prediction_engine_parameter import PredictionEngineParameter
from gorm_ai.database.models.prediction_export_template import PredictionExportTemplate, PredictionExportTemplateElement
from gorm_ai.database.models.prediction_outlet import PredictionOutlet
from gorm_ai.database.models.prediction_strategy import PredictionStrategy
from gorm_ai.database.models.sales_filter import SalesFilter
from gorm_ai.database.models.simulation import Simulation
from gorm_ai.database.models.simulation_date import SimulationDate
from gorm_ai.database.models.simulation_filter import SimulationFilter
from gorm_ai.database.models.simulation_strategy import SimulationStrategy
from gorm_ai.database.models.task_record import TaskRecord

__all__ = [
    "Configuration",
    "Covariate",
    "CovariateOutlet",
    "Currency",
    "LastPrediction",
    "Customer",
    "FinetuneProgress",
    "ImportTemplate",
    "ImportTemplateElement",
    "CustomerConfiguration",
    "PredictionAdjustment",
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
    "PredefinedPad",
    "PredefinedPadDate",
    "Prediction",
    "PredictionEngine",
    "PredictionEngineParameter",
    "PredictionExportTemplate",
    "PredictionExportTemplateElement",
    "PredictionOutlet",
    "PredictionStrategy",
    "Sales",
    "SalesFilter",
    "Simulation",
    "SimulationDate",
    "SimulationFilter",
    "SimulationStrategy",
    "TaskRecord",
]
