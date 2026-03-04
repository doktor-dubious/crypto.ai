"""Sales service for business logic."""

from datetime import date

from sqlalchemy import not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models import Sales
from gorm_ai.database.models.sales_filter import SalesFilter
from gorm_ai.schemas.sales import SalesBulkImport, SalesCreate, SalesQuery, SalesUpdate


class SalesService:
    """Service for sales operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: SalesCreate) -> Sales:
        """Create a new sales record."""
        sales = Sales(**data.model_dump())
        self.session.add(sales)
        await self.session.flush()
        await self.session.refresh(sales)
        return sales

    async def bulk_import(self, data: SalesBulkImport) -> list[Sales]:
        """Bulk import sales records."""
        sales_records = []
        for record in data.records:
            sales = Sales(**record.model_dump())
            self.session.add(sales)
            sales_records.append(sales)
        await self.session.flush()
        for sales in sales_records:
            await self.session.refresh(sales)
        return sales_records

    async def get(self, sales_id: str) -> Sales | None:
        """Get a sales record by ID."""
        result = await self.session.execute(
            select(Sales).where(Sales.id == sales_id, Sales.active.is_(True))
        )
        return result.scalar_one_or_none()

    async def query(self, params: SalesQuery) -> list[Sales]:
        """Query sales records with filters."""
        query = select(Sales).where(Sales.active.is_(True))

        if params.customer_id:
            query = query.where(Sales.customer_id == params.customer_id)
        if params.outlet_id:
            query = query.where(Sales.outlet_id == params.outlet_id)
        if params.start_date:
            query = query.where(Sales.date >= params.start_date)
        if params.end_date:
            query = query.where(Sales.date <= params.end_date)

        query = query.order_by(Sales.date.desc()).limit(params.limit).offset(params.offset)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def get_by_date_range(
        self,
        customer_id: str,
        outlet_id: str | None,
        end_date: date,
        start_date: date | None = None,
        apply_sales_filter: bool = False,
    ) -> list[Sales]:
        """Get sales data up to end_date. start_date is optional; omit to fetch all history.

        When apply_sales_filter=True, dates covered by any active SalesFilter record for
        the customer are excluded. Use this for prediction training data; leave False when
        fetching actuals for comparison.
        """
        query = select(Sales).where(
            Sales.customer_id == customer_id,
            Sales.date <= end_date,
            Sales.active.is_(True),
        )
        if start_date is not None:
            query = query.where(Sales.date >= start_date)

        if outlet_id:
            query = query.where(Sales.outlet_id == outlet_id)

        if apply_sales_filter:
            filtered_out = (
                select(SalesFilter.id)
                .where(
                    SalesFilter.customer_id == customer_id,
                    SalesFilter.active.is_(True),
                    SalesFilter.from_date <= Sales.date,
                    SalesFilter.to_date >= Sales.date,
                )
                .correlate(Sales)
                .exists()
            )
            query = query.where(not_(filtered_out))

        query = query.order_by(Sales.date)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def update(self, sales_id: str, data: SalesUpdate) -> Sales | None:
        """Update a sales record."""
        sales = await self.get(sales_id)
        if not sales:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(sales, field, value)

        await self.session.flush()
        await self.session.refresh(sales)
        return sales

    async def delete(self, sales_id: str, hard_delete: bool = False) -> bool:
        """Delete a sales record (soft delete by default)."""
        sales = await self.get(sales_id)
        if not sales:
            return False

        if hard_delete:
            await self.session.delete(sales)
        else:
            sales.active = False
            await self.session.flush()

        return True
