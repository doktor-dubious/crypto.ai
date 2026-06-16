"""Database models."""

# isort:skip_file
# Import Sales first since it uses a different base class (TimescaleDB hypertable)
from crypto_ai.database.models.sales import Sales
from crypto_ai.database.models.configuration import Configuration
from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.kline import Kline
from crypto_ai.database.models.kline_simulation import KlineSimulation
from crypto_ai.database.models.kline_simulation_prediction import KlineSimulationPrediction
from crypto_ai.database.models.kline_strategy import KlineStrategy, KlineStrategyParameter
from crypto_ai.database.models.covariate import Covariate, CovariateOutlet
from crypto_ai.database.models.last_prediction import LastPrediction
from crypto_ai.database.models.currency import Currency
from crypto_ai.database.models.customer import Customer
from crypto_ai.database.models.finetune_examination import FinetuneExamination
from crypto_ai.database.models.finetune_progress import FinetuneProgress
from crypto_ai.database.models.fine_tune import FineTune
from crypto_ai.database.models.finetune_log import FinetuneLog
from crypto_ai.database.models.configuration_covariate import ConfigurationCovariate
from crypto_ai.database.models.customer_configuration import CustomerConfiguration
from crypto_ai.database.models.import_log import ImportLog
from crypto_ai.database.models.import_template import ImportTemplate, ImportTemplateElement
from crypto_ai.database.models.llm import Llm
from crypto_ai.database.models.llm_submodel import LlmSubmodel
from crypto_ai.database.models.prediction_adjustment import PredictionAdjustment
from crypto_ai.database.models.financial_date import FinancialDate, OutletFinancialDate
from crypto_ai.database.models.optimization_run import OptimizationRun
from crypto_ai.database.models.outlet import Outlet
from crypto_ai.database.models.outlet_delivery import OutletDelivery
from crypto_ai.database.models.outlet_financials import OutletFinancials
from crypto_ai.database.models.outlet_group import OutletGroup, OutletGroupMember
from crypto_ai.database.models.outlet_info import OutletInfo
from crypto_ai.database.models.pad import Pad, PadDate
from crypto_ai.database.models.price_history import PriceHistory
from crypto_ai.database.models.predefined_pad import PredefinedPad, PredefinedPadDate
from crypto_ai.database.models.prediction import Prediction
from crypto_ai.database.models.prediction_engine import PredictionEngine
from crypto_ai.database.models.prediction_engine_parameter import PredictionEngineParameter
from crypto_ai.database.models.prediction_export_template import PredictionExportTemplate, PredictionExportTemplateElement
from crypto_ai.database.models.prediction_outlet import PredictionOutlet
from crypto_ai.database.models.prediction_strategy import PredictionStrategy
from crypto_ai.database.models.sales_filter import SalesFilter
from crypto_ai.database.models.simulation import Simulation
from crypto_ai.database.models.simulation_date import SimulationDate
from crypto_ai.database.models.simulation_filter import SimulationFilter
from crypto_ai.database.models.simulation_strategy import SimulationStrategy
from crypto_ai.database.models.task_record import TaskRecord
from crypto_ai.database.models.chat import ChatMessage, ChatSession
from crypto_ai.database.models.token import Token, TokenLlm, TokenModel
from crypto_ai.database.models.user_customer import UserCustomer

__all__ = [
    "ChatMessage",
    "ChatSession",
    "Coin",
    "Kline",
    "KlineSimulation",
    "KlineSimulationPrediction",
    "KlineStrategy",
    "KlineStrategyParameter",
    "Configuration",
    "ConfigurationCovariate",
    "Covariate",
    "CovariateOutlet",
    "Currency",
    "LastPrediction",
    "Customer",
    "FinetuneExamination",
    "FinetuneProgress",
    "FineTune",
    "FinetuneLog",
    "ImportLog",
    "ImportTemplate",
    "ImportTemplateElement",
    "CustomerConfiguration",
    "PredictionAdjustment",
    "FinancialDate",
    "OutletFinancialDate",
    "OptimizationRun",
    "Outlet",
    "OutletDelivery",
    "OutletFinancials",
    "OutletGroup",
    "OutletGroupMember",
    "OutletInfo",
    "Pad",
    "PadDate",
    "PredefinedPad",
    "PriceHistory",
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
    "Llm",
    "LlmSubmodel",
    "Token",
    "TokenLlm",
    "TokenModel",
    "UserCustomer",
]
