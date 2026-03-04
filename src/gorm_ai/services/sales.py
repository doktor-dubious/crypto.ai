"""Sales service for business logic."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models import Sales
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
        start_date: date,
        end_date: date,
    ) -> list[Sales]:
        """Get sales data for a specific date range."""
        query = select(Sales).where(
            Sales.customer_id == customer_id,
            Sales.date >= start_date,
            Sales.date <= end_date,
            Sales.active.is_(True),
        )

        if outlet_id:
            query = query.where(Sales.outlet_id == outlet_id)

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
