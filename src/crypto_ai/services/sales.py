"""Sales service for business logic."""

from collections import defaultdict
from datetime import date

from sqlalchemy import func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models import Sales
from crypto_ai.database.models.outlet import Outlet
from crypto_ai.database.models.outlet_financials import OutletFinancials
from crypto_ai.database.models.sales_filter import SalesFilter
from crypto_ai.schemas.sales import SalesBulkImport, SalesCreate, SalesQuery, SalesUpdate


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

    async def get_by_date_range_bulk(
        self,
        customer_id: str,
        outlet_ids: list[str],
        end_date: date,
        start_date: date | None = None,
        apply_sales_filter: bool = False,
    ) -> dict[str, list[tuple[date, int]]]:
        """Fetch sales for multiple outlets in a single query.

        Returns a dict mapping outlet_id → list of (date, sold) tuples,
        sorted by date ascending. Outlets with no data will be absent from
        the result. Only the columns needed for prediction are fetched to
        avoid the overhead of instantiating full ORM objects.
        """
        query = select(Sales.outlet_id, Sales.date, Sales.sold).where(
            Sales.customer_id == customer_id,
            Sales.outlet_id.in_(outlet_ids),
            Sales.date <= end_date,
            Sales.active.is_(True),
        )
        if start_date is not None:
            query = query.where(Sales.date >= start_date)

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

        query = query.order_by(Sales.outlet_id, Sales.date)

        result = await self.session.execute(query)
        rows = result.all()

        grouped: dict[str, list[tuple[date, int]]] = defaultdict(list)
        for outlet_id, row_date, sold in rows:
            grouped[outlet_id].append((row_date, sold))
        return dict(grouped)

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

    async def get_date_range(self, customer_id: str) -> tuple[date | None, date | None]:
        """Return (min_date, max_date) of sales records for a customer."""
        result = await self.session.execute(
            select(func.min(Sales.date), func.max(Sales.date)).where(
                Sales.customer_id == customer_id,
                Sales.active.is_(True),
            )
        )
        row = result.one()
        return row[0], row[1]

    async def get_aggregated(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> list[dict]:
        """Aggregate sales by date across multiple outlets.

        Returns list of dicts with keys: date, delivered, sold, returned.
        """
        query = (
            select(
                Sales.date,
                func.sum(Sales.delivered).label("delivered"),
                func.sum(Sales.sold).label("sold"),
            )
            .where(
                Sales.customer_id == customer_id,
                Sales.outlet_id.in_(outlet_ids),
                Sales.date >= start_date,
                Sales.date <= end_date,
                Sales.active.is_(True),
            )
            .group_by(Sales.date)
            .order_by(Sales.date)
        )

        result = await self.session.execute(query)
        rows = result.all()

        return [
            {
                "date": row.date,
                "delivered": int(row.delivered) if row.delivered is not None else None,
                "sold": int(row.sold),
                "returned": int(row.delivered) - int(row.sold) if row.delivered is not None else None,
            }
            for row in rows
        ]

    async def get_efficiency(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> list[dict]:
        """Compute efficiency metrics per date across outlets.

        Returns list of dicts with: date, delivered, sold, returned,
        return_pct, sold_out_pct, outlet_count, sold_out_count.

        sold_out = outlets where sold >= delivered on that date.
        """
        from sqlalchemy import case

        query = (
            select(
                Sales.date,
                func.sum(Sales.delivered).label("delivered"),
                func.sum(Sales.sold).label("sold"),
                func.count().label("outlet_count"),
                func.sum(
                    case(
                        (
                            (Sales.delivered.is_not(None)) & (Sales.sold >= Sales.delivered),
                            1,
                        ),
                        else_=0,
                    )
                ).label("sold_out_count"),
            )
            .where(
                Sales.customer_id == customer_id,
                Sales.outlet_id.in_(outlet_ids),
                Sales.date >= start_date,
                Sales.date <= end_date,
                Sales.active.is_(True),
            )
            .group_by(Sales.date)
            .order_by(Sales.date)
        )

        result = await self.session.execute(query)
        rows = result.all()

        out = []
        for row in rows:
            delivered = int(row.delivered) if row.delivered is not None else None
            sold = int(row.sold)
            returned = delivered - sold if delivered is not None else None
            outlet_count = int(row.outlet_count)
            sold_out_count = int(row.sold_out_count)

            return_pct = round(returned / delivered * 100, 2) if delivered else None
            sold_out_pct = round(sold_out_count / outlet_count * 100, 2) if outlet_count else None

            out.append({
                "date": row.date,
                "delivered": delivered,
                "sold": sold,
                "returned": returned,
                "return_pct": return_pct,
                "sold_out_pct": sold_out_pct,
                "outlet_count": outlet_count,
                "sold_out_count": sold_out_count,
            })
        return out

    async def _load_financials_map(
        self,
        outlet_ids: list[str],
    ) -> dict[str, dict[int, tuple[float | None, float | None]]]:
        """Load outlet financials keyed by outlet_id -> weekday -> (cost, profit)."""
        result = await self.session.execute(
            select(OutletFinancials).where(
                OutletFinancials.outlet_id.in_(outlet_ids),
                OutletFinancials.active.is_(True),
            )
        )
        fins = result.scalars().all()
        out: dict[str, dict[int, tuple[float | None, float | None]]] = defaultdict(dict)
        for f in fins:
            out[f.outlet_id][f.weekday] = (f.cost_per_unit, f.profit_per_unit)
        return dict(out)

    async def get_financials_per_date(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
        default_cost: float,
        default_profit: float,
    ) -> list[dict]:
        """Compute revenue/cost/profit aggregated per date."""
        # Fetch raw sales rows (lightweight columns only)
        query = select(
            Sales.outlet_id, Sales.date, Sales.sold, Sales.delivered,
        ).where(
            Sales.customer_id == customer_id,
            Sales.outlet_id.in_(outlet_ids),
            Sales.date >= start_date,
            Sales.date <= end_date,
            Sales.active.is_(True),
        ).order_by(Sales.date)

        result = await self.session.execute(query)
        rows = result.all()

        fins = await self._load_financials_map(outlet_ids)

        # Aggregate per date
        date_agg: dict[date, dict] = {}
        for outlet_id, row_date, sold, delivered in rows:
            if row_date not in date_agg:
                date_agg[row_date] = {"revenue": 0.0, "cost": 0.0, "profit": 0.0, "outlet_count": 0}
            agg = date_agg[row_date]

            # weekday 1=Monday..7=Sunday from Python's isoweekday()
            weekday = row_date.isoweekday()
            fin = fins.get(outlet_id, {}).get(weekday)
            cpu = fin[0] if fin and fin[0] is not None else default_cost
            ppu = fin[1] if fin and fin[1] is not None else default_profit

            returned = (delivered - sold) if delivered is not None and delivered > sold else 0
            revenue = ppu * sold
            cost = cpu * returned
            agg["revenue"] += revenue
            agg["cost"] += cost
            agg["profit"] += revenue - cost
            agg["outlet_count"] += 1

        return [
            {
                "date": d,
                "revenue": round(v["revenue"], 2),
                "cost": round(v["cost"], 2),
                "profit": round(v["profit"], 2),
                "avg_profit": round(v["profit"] / v["outlet_count"], 2) if v["outlet_count"] else 0,
                "outlet_count": v["outlet_count"],
            }
            for d, v in sorted(date_agg.items())
        ]

    async def get_financials_per_outlet(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
        default_cost: float,
        default_profit: float,
    ) -> list[dict]:
        """Compute revenue/cost/profit per outlet over the period."""
        query = select(
            Sales.outlet_id, Sales.date, Sales.sold, Sales.delivered,
        ).where(
            Sales.customer_id == customer_id,
            Sales.outlet_id.in_(outlet_ids),
            Sales.date >= start_date,
            Sales.date <= end_date,
            Sales.active.is_(True),
        )

        result = await self.session.execute(query)
        rows = result.all()

        fins = await self._load_financials_map(outlet_ids)

        # Aggregate per outlet
        outlet_agg: dict[str, dict] = {}
        for outlet_id, row_date, sold, delivered in rows:
            if outlet_id not in outlet_agg:
                outlet_agg[outlet_id] = {"revenue": 0.0, "cost": 0.0, "profit": 0.0, "days": 0}
            agg = outlet_agg[outlet_id]

            weekday = row_date.isoweekday()
            fin = fins.get(outlet_id, {}).get(weekday)
            cpu = fin[0] if fin and fin[0] is not None else default_cost
            ppu = fin[1] if fin and fin[1] is not None else default_profit

            returned = (delivered - sold) if delivered is not None and delivered > sold else 0
            revenue = ppu * sold
            cost = cpu * returned
            agg["revenue"] += revenue
            agg["cost"] += cost
            agg["profit"] += revenue - cost
            agg["days"] += 1

        # Fetch outlet names
        outlet_result = await self.session.execute(
            select(Outlet.id, Outlet.ext_id, Outlet.name).where(Outlet.id.in_(list(outlet_agg.keys())))
        )
        outlet_info = {r.id: (r.ext_id, r.name) for r in outlet_result.all()}

        return [
            {
                "outlet_id": oid,
                "ext_id": outlet_info.get(oid, ("", ""))[0],
                "name": outlet_info.get(oid, ("", "Unknown"))[1],
                "revenue": round(v["revenue"], 2),
                "cost": round(v["cost"], 2),
                "profit": round(v["profit"], 2),
                "avg_profit": round(v["profit"] / v["days"], 2) if v["days"] else 0,
                "days": v["days"],
            }
            for oid, v in outlet_agg.items()
        ]

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
