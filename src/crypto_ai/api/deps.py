"""Dependency injection for API routes."""

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.connection import get_session
from crypto_ai.services.analysis import AnalysisService
from crypto_ai.services.binance_import import BinanceImportService
from crypto_ai.services.coin import CoinService
from crypto_ai.services.kline import KlineService
from crypto_ai.services.kline_simulation_record import KlineSimulationRecordService
from crypto_ai.services.cohort_audit import CohortAuditService
from crypto_ai.services.configuration import ConfigurationService
from crypto_ai.services.configuration_covariate import ConfigurationCovariateService
from crypto_ai.services.customer import CustomerService
from crypto_ai.services.customer_configuration import CustomerConfigurationService
from crypto_ai.services.elasticity import ElasticityService
from crypto_ai.services.elasticity_events import ElasticityEventService
from crypto_ai.services.financial_date import FinancialDateService
from crypto_ai.services.health_check import HealthCheckService
from crypto_ai.services.import_template import ImportTemplateService
from crypto_ai.services.outlet import OutletService
from crypto_ai.services.outlet_group import OutletGroupService
from crypto_ai.services.pad import PadService
from crypto_ai.services.predefined_pad import PredefinedPadService
from crypto_ai.services.prediction import PredictionService
from crypto_ai.services.prediction_adjustment import PredictionAdjustmentService
from crypto_ai.services.prediction_engine import PredictionEngineService
from crypto_ai.services.prediction_engine_parameter import PredictionEngineParameterService
from crypto_ai.services.prediction_strategy import PredictionStrategyService
from crypto_ai.services.price_history import PriceHistoryService
from crypto_ai.services.sales import SalesService
from crypto_ai.services.sales_filter import SalesFilterService
from crypto_ai.services.simulation_filter import SimulationFilterService
from crypto_ai.services.simulation_strategy import SimulationStrategyService
from crypto_ai.services.task import TaskService
from crypto_ai.services.user_customer import UserCustomerService


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get database session."""
    async for session in get_session():
        yield session


# Type aliases for dependency injection
DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_analysis_service(session: DbSession) -> AnalysisService:
    """Get analysis service."""
    return AnalysisService(session)


def get_cohort_audit_service(session: DbSession) -> CohortAuditService:
    """Get cohort audit service."""
    return CohortAuditService(session)


def get_health_check_service(session: DbSession) -> HealthCheckService:
    """Get health check service."""
    return HealthCheckService(session)


def get_customer_service(session: DbSession) -> CustomerService:
    """Get customer service."""
    return CustomerService(session)


def get_coin_service(session: DbSession) -> CoinService:
    """Get coin service."""
    return CoinService(session)


def get_kline_service(session: DbSession) -> KlineService:
    """Get kline service."""
    return KlineService(session)


def get_kline_simulation_record_service(session: DbSession) -> KlineSimulationRecordService:
    """Get kline simulation record service."""
    return KlineSimulationRecordService(session)


def get_binance_import_service(session: DbSession) -> BinanceImportService:
    """Get Binance import service."""
    return BinanceImportService(session)


def get_outlet_service(session: DbSession) -> OutletService:
    """Get outlet service."""
    return OutletService(session)


def get_sales_service(session: DbSession) -> SalesService:
    """Get sales service."""
    return SalesService(session)


def get_prediction_service(session: DbSession) -> PredictionService:
    """Get prediction service."""
    return PredictionService(session)


def get_configuration_covariate_service(session: DbSession) -> ConfigurationCovariateService:
    """Get configuration covariate service."""
    return ConfigurationCovariateService(session)


def get_configuration_service(session: DbSession) -> ConfigurationService:
    """Get configuration service."""
    return ConfigurationService(session)


def get_customer_configuration_service(session: DbSession) -> CustomerConfigurationService:
    """Get customer configuration service."""
    return CustomerConfigurationService(session)


def get_financial_date_service(session: DbSession) -> FinancialDateService:
    """Get financial date service."""
    return FinancialDateService(session)


def get_outlet_group_service(session: DbSession) -> OutletGroupService:
    """Get outlet group service."""
    return OutletGroupService(session)


def get_prediction_adjustment_service(session: DbSession) -> PredictionAdjustmentService:
    """Get prediction adjustment service."""
    return PredictionAdjustmentService(session)


def get_pad_service(session: DbSession) -> PadService:
    """Get pad service."""
    return PadService(session)


def get_predefined_pad_service(session: DbSession) -> PredefinedPadService:
    """Get predefined pad service."""
    return PredefinedPadService(session)


def get_sales_filter_service(session: DbSession) -> SalesFilterService:
    """Get sales filter service."""
    return SalesFilterService(session)


def get_task_service(session: DbSession) -> TaskService:
    """Get task service."""
    return TaskService(session)


def get_price_history_service(session: DbSession) -> PriceHistoryService:
    """Get price history service."""
    return PriceHistoryService(session)


def get_elasticity_service(session: DbSession) -> ElasticityService:
    """Get elasticity analytics service."""
    return ElasticityService(session)


def get_elasticity_event_service(session: DbSession) -> ElasticityEventService:
    """Get event-based elasticity service."""
    return ElasticityEventService(session)


def get_prediction_engine_service(session: DbSession) -> PredictionEngineService:
    """Get prediction engine service."""
    return PredictionEngineService(session)


def get_prediction_engine_parameter_service(session: DbSession) -> PredictionEngineParameterService:
    """Get prediction engine parameter service."""
    return PredictionEngineParameterService(session)


def get_prediction_strategy_service(session: DbSession) -> PredictionStrategyService:
    """Get prediction strategy service."""
    return PredictionStrategyService(session)


def get_import_template_service(session: DbSession) -> ImportTemplateService:
    """Get import template service."""
    return ImportTemplateService(session)


def get_simulation_filter_service(session: DbSession) -> SimulationFilterService:
    """Get simulation filter service."""
    return SimulationFilterService(session)


def get_simulation_strategy_service(session: DbSession) -> SimulationStrategyService:
    """Get simulation strategy service."""
    return SimulationStrategyService(session)


def get_user_customer_service(session: DbSession) -> UserCustomerService:
    """Get user-customer service."""
    return UserCustomerService(session)


# Type aliases for service injection
AnalysisServiceDep = Annotated[AnalysisService, Depends(get_analysis_service)]
CohortAuditServiceDep = Annotated[CohortAuditService, Depends(get_cohort_audit_service)]
HealthCheckServiceDep = Annotated[HealthCheckService, Depends(get_health_check_service)]
ConfigurationCovariateServiceDep = Annotated[
    ConfigurationCovariateService, Depends(get_configuration_covariate_service)
]
ConfigurationServiceDep = Annotated[ConfigurationService, Depends(get_configuration_service)]
FinancialDateServiceDep = Annotated[FinancialDateService, Depends(get_financial_date_service)]
CustomerConfigurationServiceDep = Annotated[
    CustomerConfigurationService, Depends(get_customer_configuration_service)
]
CustomerServiceDep = Annotated[CustomerService, Depends(get_customer_service)]
CoinServiceDep = Annotated[CoinService, Depends(get_coin_service)]
KlineServiceDep = Annotated[KlineService, Depends(get_kline_service)]
KlineSimulationRecordServiceDep = Annotated[
    KlineSimulationRecordService, Depends(get_kline_simulation_record_service)
]
BinanceImportServiceDep = Annotated[BinanceImportService, Depends(get_binance_import_service)]
PredictionAdjustmentServiceDep = Annotated[
    PredictionAdjustmentService, Depends(get_prediction_adjustment_service)
]
PadServiceDep = Annotated[PadService, Depends(get_pad_service)]
PredefinedPadServiceDep = Annotated[PredefinedPadService, Depends(get_predefined_pad_service)]
OutletGroupServiceDep = Annotated[OutletGroupService, Depends(get_outlet_group_service)]
OutletServiceDep = Annotated[OutletService, Depends(get_outlet_service)]
PredictionServiceDep = Annotated[PredictionService, Depends(get_prediction_service)]
ImportTemplateServiceDep = Annotated[ImportTemplateService, Depends(get_import_template_service)]
SalesFilterServiceDep = Annotated[SalesFilterService, Depends(get_sales_filter_service)]
SalesServiceDep = Annotated[SalesService, Depends(get_sales_service)]
TaskServiceDep = Annotated[TaskService, Depends(get_task_service)]
PriceHistoryServiceDep = Annotated[PriceHistoryService, Depends(get_price_history_service)]
ElasticityServiceDep = Annotated[ElasticityService, Depends(get_elasticity_service)]
ElasticityEventServiceDep = Annotated[
    ElasticityEventService, Depends(get_elasticity_event_service)
]
PredictionEngineServiceDep = Annotated[PredictionEngineService, Depends(get_prediction_engine_service)]
PredictionEngineParameterServiceDep = Annotated[
    PredictionEngineParameterService, Depends(get_prediction_engine_parameter_service)
]
PredictionStrategyServiceDep = Annotated[PredictionStrategyService, Depends(get_prediction_strategy_service)]
SimulationFilterServiceDep = Annotated[
    SimulationFilterService, Depends(get_simulation_filter_service)
]
SimulationStrategyServiceDep = Annotated[SimulationStrategyService, Depends(get_simulation_strategy_service)]
SalesFilterServiceDep = Annotated[SalesFilterService, Depends(get_sales_filter_service)]
UserCustomerServiceDep = Annotated[UserCustomerService, Depends(get_user_customer_service)]
