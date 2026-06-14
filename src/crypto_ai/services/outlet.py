"""Outlet service for business logic."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from crypto_ai.database.models import (
    Outlet,
    OutletDelivery,
    OutletFinancials,
    OutletInfo,
    Pad,
    PadDate,
    Prediction,
    PredictionOutlet,
)
from crypto_ai.database.models.covariate import Covariate, CovariateOutlet
from crypto_ai.database.models.last_prediction import LastPrediction
from crypto_ai.database.models.sales import Sales
from crypto_ai.schemas.outlet import (
    DeliveryAnalyticsResponse,
    DeliveryAnalyticsWeekday,
    OutletConstraintWeekday,
    OutletConstraintsResponse,
    OutletConstraintsUpdate,
    OutletCreate,
    OutletDeliveryCreate,
    OutletInfoCreate,
    OutletUpdate,
)


class OutletService:
    """Service for outlet operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: OutletCreate) -> Outlet:
        """Create a new outlet."""
        outlet_data = data.model_dump(exclude={"info", "deliveries"})
        outlet = Outlet(**outlet_data)
        self.session.add(outlet)
        await self.session.flush()

        # Add info records
        if data.info:
            for info_data in data.info:
                info = OutletInfo(outlet_id=outlet.id, **info_data.model_dump())
                self.session.add(info)

        # Add delivery records
        if data.deliveries:
            for delivery_data in data.deliveries:
                delivery = OutletDelivery(outlet_id=outlet.id, **delivery_data.model_dump())
                self.session.add(delivery)

        await self.session.flush()
        await self.session.refresh(outlet)
        return outlet

    async def get(self, outlet_id: str) -> Outlet | None:
        """Get an outlet by ID."""
        result = await self.session.execute(
            select(Outlet)
            .where(Outlet.id == outlet_id, Outlet.active.is_(True))
            .options(selectinload(Outlet.info), selectinload(Outlet.deliveries))
        )
        return result.scalar_one_or_none()

    async def get_by_ext_id(self, ext_id: str, customer_id: str | None = None) -> Outlet | None:
        """Get an outlet by external ID."""
        query = select(Outlet).where(Outlet.ext_id == ext_id, Outlet.active.is_(True))
        if customer_id:
            query = query.where(Outlet.customer_id == customer_id)
        query = query.options(selectinload(Outlet.info), selectinload(Outlet.deliveries))
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_all(
        self,
        customer_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
        include_inactive: bool = False,
    ) -> list[Outlet]:
        """Get all outlets with optional customer filter."""
        query = select(Outlet)
        if not include_inactive:
            query = query.where(Outlet.active.is_(True))
        if customer_id:
            query = query.where(Outlet.customer_id == customer_id)
        query = (
            query.options(selectinload(Outlet.info), selectinload(Outlet.deliveries))
            .order_by(Outlet.name)
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def update(self, outlet_id: str, data: OutletUpdate) -> Outlet | None:
        """Update an outlet."""
        outlet = await self.get(outlet_id)
        if not outlet:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(outlet, field, value)

        await self.session.flush()
        await self.session.refresh(outlet)
        return outlet

    async def delete(self, outlet_id: str, hard_delete: bool = False) -> bool:
        """Delete an outlet (soft delete by default)."""
        outlet = await self.get(outlet_id)
        if not outlet:
            return False

        if hard_delete:
            await self.session.delete(outlet)
        else:
            outlet.active = False
            await self.session.flush()

        return True

    async def add_info(self, outlet_id: str, data: OutletInfoCreate) -> OutletInfo | None:
        """Add info record to outlet."""
        outlet = await self.get(outlet_id)
        if not outlet:
            return None

        info = OutletInfo(outlet_id=outlet_id, **data.model_dump())
        self.session.add(info)
        await self.session.flush()
        await self.session.refresh(info)
        return info

    async def delete_info(self, outlet_id: str, info_id: str) -> bool:
        """Soft-delete an outlet info record."""
        result = await self.session.execute(
            select(OutletInfo).where(
                OutletInfo.id == info_id,
                OutletInfo.outlet_id == outlet_id,
                OutletInfo.active.is_(True),
            )
        )
        info = result.scalar_one_or_none()
        if not info:
            return False
        info.active = False
        await self.session.flush()
        return True

    async def add_delivery(
        self, outlet_id: str, data: OutletDeliveryCreate
    ) -> OutletDelivery | None:
        """Add delivery record to outlet."""
        outlet = await self.get(outlet_id)
        if not outlet:
            return None

        delivery = OutletDelivery(outlet_id=outlet_id, **data.model_dump())
        self.session.add(delivery)
        await self.session.flush()
        await self.session.refresh(delivery)
        return delivery

    async def get_deliveries(self, outlet_id: str) -> list[OutletDelivery]:
        """Get all deliveries for an outlet."""
        result = await self.session.execute(
            select(OutletDelivery).where(
                OutletDelivery.outlet_id == outlet_id,
                OutletDelivery.active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def get_constraints(self, outlet_id: str) -> OutletConstraintsResponse | None:
        """Get delivery constraints and financials per weekday."""
        outlet = await self.session.get(Outlet, outlet_id)
        if not outlet or not outlet.active:
            return None

        del_result = await self.session.execute(
            select(OutletDelivery).where(
                OutletDelivery.outlet_id == outlet_id,
                OutletDelivery.active.is_(True),
            )
        )
        deliveries_by_wd = {d.weekday: d for d in del_result.scalars().all()}

        fin_result = await self.session.execute(
            select(OutletFinancials).where(
                OutletFinancials.outlet_id == outlet_id,
                OutletFinancials.active.is_(True),
            )
        )
        financials_by_wd = {f.weekday: f for f in fin_result.scalars().all()}

        weekdays = []
        for wd in range(1, 8):
            dl = deliveries_by_wd.get(wd)
            fin = financials_by_wd.get(wd)
            weekdays.append(
                OutletConstraintWeekday(
                    weekday=wd,
                    open=dl.open if dl else False,
                    cost_per_unit=fin.cost_per_unit if fin else None,
                    profit_per_unit=fin.profit_per_unit if fin else None,
                    fixed=dl.fixed if dl else None,
                    minimum=dl.minimum if dl else None,
                    maximum=dl.maximum if dl else None,
                    add=dl.add if dl else None,
                    add_pct=dl.add_pct if dl else None,
                )
            )

        return OutletConstraintsResponse(outlet_id=outlet_id, weekdays=weekdays)

    async def update_constraints(
        self, outlet_id: str, data: OutletConstraintsUpdate
    ) -> OutletConstraintsResponse | None:
        """Update delivery constraints and financials per weekday (upsert)."""
        outlet = await self.session.get(Outlet, outlet_id)
        if not outlet or not outlet.active:
            return None

        # Fetch existing records
        del_result = await self.session.execute(
            select(OutletDelivery).where(
                OutletDelivery.outlet_id == outlet_id,
                OutletDelivery.active.is_(True),
            )
        )
        deliveries_by_wd = {d.weekday: d for d in del_result.scalars().all()}

        fin_result = await self.session.execute(
            select(OutletFinancials).where(
                OutletFinancials.outlet_id == outlet_id,
                OutletFinancials.active.is_(True),
            )
        )
        financials_by_wd = {f.weekday: f for f in fin_result.scalars().all()}

        for wd_data in data.weekdays:
            wd = wd_data.weekday

            # Upsert delivery
            dl = deliveries_by_wd.get(wd)
            if dl:
                dl.open = wd_data.open
                dl.fixed = wd_data.fixed
                dl.minimum = wd_data.minimum
                dl.maximum = wd_data.maximum
                dl.add = wd_data.add
                dl.add_pct = wd_data.add_pct
            else:
                dl = OutletDelivery(
                    outlet_id=outlet_id,
                    weekday=wd,
                    open=wd_data.open,
                    fixed=wd_data.fixed,
                    minimum=wd_data.minimum,
                    maximum=wd_data.maximum,
                    add=wd_data.add,
                    add_pct=wd_data.add_pct,
                )
                self.session.add(dl)

            # Upsert financials
            fin = financials_by_wd.get(wd)
            if fin:
                fin.cost_per_unit = wd_data.cost_per_unit
                fin.profit_per_unit = wd_data.profit_per_unit
            else:
                fin = OutletFinancials(
                    outlet_id=outlet_id,
                    weekday=wd,
                    cost_per_unit=wd_data.cost_per_unit,
                    profit_per_unit=wd_data.profit_per_unit,
                )
                self.session.add(fin)

        await self.session.flush()
        return await self.get_constraints(outlet_id)

    async def get_delivery_analytics(self, outlet_id: str) -> DeliveryAnalyticsResponse | None:
        """Get delivery analytics per weekday for an outlet."""
        outlet = await self.session.get(Outlet, outlet_id)
        if not outlet or not outlet.active:
            return None

        # Fetch last_prediction records keyed by weekday
        lp_result = await self.session.execute(
            select(LastPrediction).where(LastPrediction.outlet_id == outlet_id)
        )
        last_predictions: dict[int, LastPrediction] = {
            lp.weekday: lp for lp in lp_result.scalars().all()
        }

        # Fetch weekday ridge corrections from covariate_outlet as fallback
        # (used when last_prediction.weekday_correction is null — e.g. pre-052 rows)
        cov_result = await self.session.execute(
            select(CovariateOutlet.weekday, CovariateOutlet.coefficient)
            .join(Covariate, Covariate.id == CovariateOutlet.covariate_id)
            .where(
                CovariateOutlet.outlet_id == outlet_id,
                Covariate.type == "weekday",
                CovariateOutlet.weekday.isnot(None),
            )
        )
        covariate_corrections: dict[int, float] = {
            int(row.weekday): float(row.coefficient) for row in cov_result.all()
        }

        # Compute PAD effect per weekday using prediction_outlet history
        # Subquery: all active PAD dates for this customer
        pad_date_subq = (
            select(PadDate.date)
            .join(Pad, Pad.id == PadDate.pad_id)
            .where(
                Pad.customer_id == outlet.customer_id,
                Pad.active.is_(True),
                PadDate.active.is_(True),
            )
            .scalar_subquery()
        )

        pad_avg_result = await self.session.execute(
            select(
                func.extract("isodow", Prediction.date).label("wd"),
                func.avg(PredictionOutlet.predicted).label("pad_avg"),
            )
            .join(Prediction, Prediction.id == PredictionOutlet.prediction_id)
            .where(
                PredictionOutlet.outlet_id == outlet_id,
                Prediction.customer_id == outlet.customer_id,
                Prediction.date.in_(pad_date_subq),
                PredictionOutlet.predicted.isnot(None),
            )
            .group_by(func.extract("isodow", Prediction.date))
        )
        pad_avg_by_wd: dict[int, float] = {
            int(row.wd): float(row.pad_avg) for row in pad_avg_result.all()
        }

        baseline_avg_result = await self.session.execute(
            select(
                func.extract("isodow", Prediction.date).label("wd"),
                func.avg(PredictionOutlet.predicted).label("baseline_avg"),
            )
            .join(Prediction, Prediction.id == PredictionOutlet.prediction_id)
            .where(
                PredictionOutlet.outlet_id == outlet_id,
                Prediction.customer_id == outlet.customer_id,
                Prediction.date.notin_(pad_date_subq),
                PredictionOutlet.predicted.isnot(None),
            )
            .group_by(func.extract("isodow", Prediction.date))
        )
        baseline_avg_by_wd: dict[int, float] = {
            int(row.wd): float(row.baseline_avg) for row in baseline_avg_result.all()
        }

        # Fetch outlet_financials keyed by weekday
        fin_result = await self.session.execute(
            select(OutletFinancials).where(
                OutletFinancials.outlet_id == outlet_id,
                OutletFinancials.active.is_(True),
            )
        )
        financials_by_wd: dict[int, OutletFinancials] = {
            f.weekday: f for f in fin_result.scalars().all()
        }

        # Fetch outlet_deliveries keyed by weekday
        del_result = await self.session.execute(
            select(OutletDelivery).where(
                OutletDelivery.outlet_id == outlet_id,
                OutletDelivery.active.is_(True),
            )
        )
        deliveries_by_wd: dict[int, OutletDelivery] = {
            d.weekday: d for d in del_result.scalars().all()
        }

        weekdays = []
        for wd in range(1, 8):  # 1=Monday ... 7=Sunday (ISO weekday)
            sales_result = await self.session.execute(
                select(Sales)
                .where(
                    Sales.outlet_id == outlet_id,
                    Sales.active.is_(True),
                    func.extract("isodow", Sales.date) == wd,
                )
                .order_by(Sales.date.desc())
                .limit(8)
            )
            sales = list(sales_result.scalars().all())

            # Reverse so oldest is first (index 0) and most recent is last
            sales_chrono = list(reversed(sales))
            dates = [s.date.isoformat() for s in sales_chrono]
            sold_history = [s.sold for s in sales_chrono]
            delivered_history = [s.delivered for s in sales_chrono]
            returned_history = [
                (s.delivered - s.sold) if s.delivered is not None else None
                for s in sales_chrono
            ]

            # Trimmed mean of last 4 sold values
            last_4 = [s.sold for s in sales[:4]]
            if len(last_4) >= 4:
                vals = sorted(last_4)
                raw_prediction: float | None = (vals[1] + vals[2]) / 2.0
            elif last_4:
                raw_prediction = sum(last_4) / len(last_4)
            else:
                raw_prediction = None

            lp = last_predictions.get(wd)
            dl = deliveries_by_wd.get(wd)
            fin = financials_by_wd.get(wd)
            pad_avg = pad_avg_by_wd.get(wd)
            baseline_avg = baseline_avg_by_wd.get(wd)
            if pad_avg is not None and baseline_avg is not None and baseline_avg != 0:
                pad_effect: float | None = pad_avg - baseline_avg
                pad_effect_pct: float | None = pad_effect / baseline_avg * 100
            else:
                pad_effect = None
                pad_effect_pct = None

            weekdays.append(
                DeliveryAnalyticsWeekday(
                    weekday=wd,
                    dates=dates,
                    sold_history=sold_history,
                    delivered_history=delivered_history,
                    returned_history=returned_history,
                    raw_prediction=raw_prediction,
                    lower_bound=lp.lower_bound if lp else None,
                    upper_bound=lp.upper_bound if lp else None,
                    predicted=lp.predicted if lp else None,
                    cv=lp.cv if lp else None,
                    economic_optimal=lp.economic_optimal if lp else None,
                    delivered=lp.delivered if lp else None,
                    pad_effect=pad_effect,
                    pad_effect_pct=pad_effect_pct,
                    weekday_correction=(
                        lp.weekday_correction if lp and lp.weekday_correction is not None
                        else covariate_corrections.get(wd)
                    ),
                    cost_per_unit=fin.cost_per_unit if fin else None,
                    profit_per_unit=fin.profit_per_unit if fin else None,
                    open=dl.open if dl else False,
                    fixed=lp.fixed if lp else None,
                    minimum=lp.minimum if lp else None,
                    maximum=lp.maximum if lp else None,
                    add=lp.add if lp else None,
                    add_pct=lp.add_pct if lp else None,
                )
            )

        return DeliveryAnalyticsResponse(outlet_id=outlet_id, weekdays=weekdays)
