"""Dependency injection for API routes."""

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.connection import get_session
from gorm_ai.services.configuration import ConfigurationService
from gorm_ai.services.financial_date import FinancialDateService
from gorm_ai.services.customer import CustomerService
from gorm_ai.services.customer_configuration import CustomerConfigurationService
from gorm_ai.services.outlet import OutletService
from gorm_ai.services.outlet_group import OutletGroupService
from gorm_ai.services.pad import PadService
from gorm_ai.services.predefined_pad import PredefinedPadService
from gorm_ai.services.prediction import PredictionService
from gorm_ai.services.prediction_adjustment import PredictionAdjustmentService
from gorm_ai.services.prediction_engine import PredictionEngineService
from gorm_ai.services.prediction_engine_parameter import PredictionEngineParameterService
from gorm_ai.services.prediction_strategy import PredictionStrategyService
from gorm_ai.services.sales import SalesService
from gorm_ai.services.sales_filter import SalesFilterService
from gorm_ai.services.import_template import ImportTemplateService
from gorm_ai.services.simulation_strategy import SimulationStrategyService
from gorm_ai.services.task import TaskService


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get database session."""
    async for session in get_session():
        yield session


# Type aliases for dependency injection
DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_customer_service(session: DbSession) -> CustomerService:
    """Get customer service."""
    return CustomerService(session)


def get_outlet_service(session: DbSession) -> OutletService:
    """Get outlet service."""
    return OutletService(session)


def get_sales_service(session: DbSession) -> SalesService:
    """Get sales service."""
    return SalesService(session)


def get_prediction_service(session: DbSession) -> PredictionService:
    """Get prediction service."""
    return PredictionService(session)


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


def get_simulation_strategy_service(session: DbSession) -> SimulationStrategyService:
    """Get simulation strategy service."""
    return SimulationStrategyService(session)


# Type aliases for service injection
ConfigurationServiceDep = Annotated[ConfigurationService, Depends(get_configuration_service)]
FinancialDateServiceDep = Annotated[FinancialDateService, Depends(get_financial_date_service)]
CustomerConfigurationServiceDep = Annotated[
    CustomerConfigurationService, Depends(get_customer_configuration_service)
]
CustomerServiceDep = Annotated[CustomerService, Depends(get_customer_service)]
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
PredictionEngineServiceDep = Annotated[PredictionEngineService, Depends(get_prediction_engine_service)]
PredictionEngineParameterServiceDep = Annotated[
    PredictionEngineParameterService, Depends(get_prediction_engine_parameter_service)
]
PredictionStrategyServiceDep = Annotated[PredictionStrategyService, Depends(get_prediction_strategy_service)]
SimulationStrategyServiceDep = Annotated[SimulationStrategyService, Depends(get_simulation_strategy_service)]
SalesFilterServiceDep = Annotated[SalesFilterService, Depends(get_sales_filter_service)]
