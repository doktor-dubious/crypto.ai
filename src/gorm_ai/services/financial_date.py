"""Financial date service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models import FinancialDate, OutletGroupMember
from gorm_ai.database.models.financial_date import OutletFinancialDate
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_financials import OutletFinancials
from gorm_ai.schemas.financial_date import FinancialDateCreate, FinancialDateUpdate


class FinancialDateService:
    """Service for financial date operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: FinancialDateCreate) -> FinancialDate:
        """Create a new financial date with outlet overrides."""
        financial_date = FinancialDate(
            customer_id=data.customer_id,
            name=data.name,
            description=data.description,
            date=data.date,
            method=data.method,
            copy_from_weekday=data.copy_from_weekday if data.method == 0 else None,
        )
        self.session.add(financial_date)
        await self.session.flush()
        await self.session.refresh(financial_date)

        # Create OutletFinancialDate records for all outlets in the group
        if data.outlet_group_id:
            outlet_result = await self.session.execute(
                select(Outlet.id)
                .join(OutletGroupMember, OutletGroupMember.outlet_id == Outlet.id)
                .where(
                    OutletGroupMember.group_id == data.outlet_group_id,
                    OutletGroupMember.active.is_(True),
                    Outlet.active.is_(True),
                )
            )
            outlet_ids = [row[0] for row in outlet_result.all()]

            if data.method == 0 and data.copy_from_weekday is not None:
                # Copy mode: fetch weekday financials for each outlet
                fin_result = await self.session.execute(
                    select(OutletFinancials).where(
                        OutletFinancials.outlet_id.in_(outlet_ids),
                        OutletFinancials.weekday == data.copy_from_weekday,
                        OutletFinancials.active.is_(True),
                    )
                )
                fin_map = {f.outlet_id: f for f in fin_result.scalars().all()}

                for outlet_id in outlet_ids:
                    fin = fin_map.get(outlet_id)
                    self.session.add(OutletFinancialDate(
                        financial_date_id=financial_date.id,
                        outlet_id=outlet_id,
                        cost_per_unit=fin.cost_per_unit if fin else None,
                        profit_per_unit=fin.profit_per_unit if fin else None,
                    ))
            else:
                # Fixed mode: use provided values for all outlets
                for outlet_id in outlet_ids:
                    self.session.add(OutletFinancialDate(
                        financial_date_id=financial_date.id,
                        outlet_id=outlet_id,
                        cost_per_unit=data.cost_per_unit,
                        profit_per_unit=data.profit_per_unit,
                    ))

            await self.session.flush()
            await self.session.refresh(financial_date)

        return financial_date

    async def list_by_customer(self, customer_id: str) -> list[FinancialDate]:
        """List all financial dates for a customer."""
        result = await self.session.execute(
            select(FinancialDate)
            .where(
                FinancialDate.customer_id == customer_id,
                FinancialDate.active.is_(True),
            )
            .order_by(FinancialDate.date.desc())
        )
        return list(result.scalars().all())

    async def get(self, financial_date_id: str) -> FinancialDate | None:
        """Get a financial date by ID."""
        result = await self.session.execute(
            select(FinancialDate).where(
                FinancialDate.id == financial_date_id,
                FinancialDate.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def update(
        self, financial_date_id: str, data: FinancialDateUpdate
    ) -> FinancialDate | None:
        """Update a financial date."""
        financial_date = await self.get(financial_date_id)
        if not financial_date:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(financial_date, field, value)

        await self.session.flush()
        await self.session.refresh(financial_date)
        return financial_date

    async def delete(self, financial_date_id: str) -> bool:
        """Soft delete a financial date."""
        financial_date = await self.get(financial_date_id)
        if not financial_date:
            return False

        financial_date.active = False
        await self.session.flush()
        return True
