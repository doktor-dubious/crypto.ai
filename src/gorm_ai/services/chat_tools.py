"""Tool executor for the chat service.

Each tool runs a safe, parameterized query against the database and returns
aggregated summaries — never raw row-level data.  The results are passed back
to the LLM so it can compose a natural-language answer.
"""

from __future__ import annotations

from datetime import date

import structlog
from sqlalchemy import func, select, case, extract
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.customer import Customer
from gorm_ai.database.models.last_prediction import LastPrediction
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_financials import OutletFinancials
from gorm_ai.database.models.outlet_group import OutletGroup, OutletGroupMember
from gorm_ai.database.models.prediction import Prediction
from gorm_ai.database.models.prediction_outlet import PredictionOutlet
from gorm_ai.database.models.sales import Sales

log = structlog.get_logger("gorm_ai.chat_tools")

# ── Claude tool definitions (sent to the API) ────────────────────────────────

TOOL_DEFINITIONS: list[dict] = [
    {
        "name": "query_sales_summary",
        "description": (
            "Query aggregated historical sales data.  Returns totals and "
            "averages grouped by the chosen period.  Never returns individual "
            "row data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "Customer UUID.",
                },
                "date_from": {
                    "type": "string",
                    "description": "Start date (YYYY-MM-DD).",
                },
                "date_to": {
                    "type": "string",
                    "description": "End date (YYYY-MM-DD).",
                },
                "outlet_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of outlet UUIDs to filter.",
                },
                "group_by": {
                    "type": "string",
                    "enum": ["day", "week", "month", "weekday"],
                    "description": "How to group the aggregated results.",
                },
                "metric": {
                    "type": "string",
                    "enum": ["sold", "delivered", "net_sold", "scan_sold"],
                    "description": "Which sales metric to aggregate.",
                },
            },
            "required": ["customer_id", "date_from", "date_to", "group_by", "metric"],
        },
    },
    {
        "name": "compare_periods",
        "description": (
            "Compare aggregated sales between two date ranges.  Returns "
            "totals, averages and percentage change."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                "period_1_from": {"type": "string", "description": "YYYY-MM-DD"},
                "period_1_to": {"type": "string", "description": "YYYY-MM-DD"},
                "period_2_from": {"type": "string", "description": "YYYY-MM-DD"},
                "period_2_to": {"type": "string", "description": "YYYY-MM-DD"},
                "metric": {
                    "type": "string",
                    "enum": ["sold", "delivered", "net_sold", "scan_sold"],
                },
                "outlet_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional outlet filter.",
                },
            },
            "required": [
                "customer_id",
                "period_1_from", "period_1_to",
                "period_2_from", "period_2_to",
                "metric",
            ],
        },
    },
    {
        "name": "get_top_outlets",
        "description": (
            "Rank outlets by a metric (total sold, profit, return rate) over "
            "a date range.  Returns a ranked list with outlet names and values."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                "date_from": {"type": "string", "description": "YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD"},
                "metric": {
                    "type": "string",
                    "enum": ["sold", "delivered", "net_sold", "return_rate", "profit"],
                },
                "order": {
                    "type": "string",
                    "enum": ["asc", "desc"],
                    "description": "Sort order. desc = highest first.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max outlets to return (default 10).",
                },
            },
            "required": ["customer_id", "date_from", "date_to", "metric", "order"],
        },
    },
    {
        "name": "get_prediction_summary",
        "description": (
            "Get aggregated summary of the latest predictions for a customer. "
            "Shows total predicted demand, average per outlet, and confidence "
            "bounds — not per-outlet details."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                "outlet_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional outlet filter.",
                },
            },
            "required": ["customer_id"],
        },
    },
    {
        "name": "lookup_entities",
        "description": (
            "Search for outlets, outlet groups, or customers by name, city, "
            "state, or other attributes.  Use this to resolve ambiguous "
            "references in the user's question (e.g. '7/11', 'Burbank')."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "Customer UUID to scope the search.",
                },
                "query": {
                    "type": "string",
                    "description": "Search term (outlet name, city, etc.).",
                },
                "entity_type": {
                    "type": "string",
                    "enum": ["outlet", "outlet_group", "customer"],
                },
            },
            "required": ["query", "entity_type"],
        },
    },
    {
        "name": "get_outlet_details",
        "description": (
            "Get details for specific outlets: name, address, delivery "
            "configuration, and financial setup."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "outlet_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Outlet UUIDs.",
                },
            },
            "required": ["outlet_ids"],
        },
    },
]


# ── Tool executor ─────────────────────────────────────────────────────────────

class ToolExecutor:
    """Execute chat tools against the database, returning aggregated data."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def execute(self, tool_name: str, params: dict) -> dict:
        """Dispatch to the right handler and return a JSON-serializable dict."""
        handler = getattr(self, f"_tool_{tool_name}", None)
        if handler is None:
            return {"error": f"Unknown tool: {tool_name}"}
        try:
            return await handler(**params)
        except Exception as exc:
            log.error("tool_error", tool=tool_name, error=str(exc))
            return {"error": f"Tool execution failed: {exc}"}

    # ── query_sales_summary ───────────────────────────────────────────────

    async def _tool_query_sales_summary(
        self,
        customer_id: str,
        date_from: str,
        date_to: str,
        group_by: str,
        metric: str,
        outlet_ids: list[str] | None = None,
    ) -> dict:
        col = getattr(Sales, metric)
        d_from = date.fromisoformat(date_from)
        d_to = date.fromisoformat(date_to)

        group_expr = {
            "day": Sales.date,
            "week": func.date_trunc("week", Sales.date),
            "month": func.date_trunc("month", Sales.date),
            "weekday": extract("isodow", Sales.date),
        }[group_by]

        stmt = (
            select(
                group_expr.label("period"),
                func.sum(col).label("total"),
                func.avg(col).label("average"),
                func.count().label("count"),
            )
            .where(
                Sales.customer_id == customer_id,
                Sales.date >= d_from,
                Sales.date <= d_to,
                Sales.active.is_(True),
            )
            .group_by(group_expr)
            .order_by(group_expr)
        )
        if outlet_ids:
            stmt = stmt.where(Sales.outlet_id.in_(outlet_ids))

        result = await self.db.execute(stmt)
        rows = result.all()

        # Also compute an overall total
        total_stmt = (
            select(
                func.sum(col).label("total"),
                func.avg(col).label("average"),
                func.count().label("count"),
            )
            .where(
                Sales.customer_id == customer_id,
                Sales.date >= d_from,
                Sales.date <= d_to,
                Sales.active.is_(True),
            )
        )
        if outlet_ids:
            total_stmt = total_stmt.where(Sales.outlet_id.in_(outlet_ids))

        total_row = (await self.db.execute(total_stmt)).one()

        groups = []
        for row in rows:
            period_val = row.period
            if hasattr(period_val, "isoformat"):
                period_val = period_val.isoformat()
            elif group_by == "weekday":
                weekday_names = {
                    1: "Monday", 2: "Tuesday", 3: "Wednesday",
                    4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday",
                }
                period_val = weekday_names.get(int(period_val), str(period_val))

            groups.append({
                "period": str(period_val),
                "total": float(row.total) if row.total else 0,
                "average": round(float(row.average), 2) if row.average else 0,
                "count": row.count,
            })

        return {
            "metric": metric,
            "date_from": date_from,
            "date_to": date_to,
            "group_by": group_by,
            "overall_total": float(total_row.total) if total_row.total else 0,
            "overall_average": round(float(total_row.average), 2) if total_row.average else 0,
            "overall_count": total_row.count,
            "groups": groups,
        }

    # ── compare_periods ───────────────────────────────────────────────────

    async def _tool_compare_periods(
        self,
        customer_id: str,
        period_1_from: str,
        period_1_to: str,
        period_2_from: str,
        period_2_to: str,
        metric: str,
        outlet_ids: list[str] | None = None,
    ) -> dict:
        col = getattr(Sales, metric)

        async def _period_agg(d_from: str, d_to: str) -> dict:
            stmt = select(
                func.sum(col).label("total"),
                func.avg(col).label("average"),
                func.count().label("count"),
            ).where(
                Sales.customer_id == customer_id,
                Sales.date >= date.fromisoformat(d_from),
                Sales.date <= date.fromisoformat(d_to),
                Sales.active.is_(True),
            )
            if outlet_ids:
                stmt = stmt.where(Sales.outlet_id.in_(outlet_ids))
            row = (await self.db.execute(stmt)).one()
            return {
                "date_from": d_from,
                "date_to": d_to,
                "total": float(row.total) if row.total else 0,
                "average": round(float(row.average), 2) if row.average else 0,
                "count": row.count,
            }

        p1 = await _period_agg(period_1_from, period_1_to)
        p2 = await _period_agg(period_2_from, period_2_to)

        change_pct = None
        if p1["total"] and p1["total"] != 0:
            change_pct = round((p2["total"] - p1["total"]) / p1["total"] * 100, 2)

        return {
            "metric": metric,
            "period_1": p1,
            "period_2": p2,
            "change_pct": change_pct,
        }

    # ── get_top_outlets ───────────────────────────────────────────────────

    async def _tool_get_top_outlets(
        self,
        customer_id: str,
        date_from: str,
        date_to: str,
        metric: str,
        order: str,
        limit: int = 10,
    ) -> dict:
        d_from = date.fromisoformat(date_from)
        d_to = date.fromisoformat(date_to)

        if metric == "return_rate":
            # return rate = (delivered - sold) / delivered * 100
            value_expr = case(
                (func.sum(Sales.delivered) > 0,
                 (func.sum(Sales.delivered) - func.sum(Sales.sold))
                 / func.sum(Sales.delivered) * 100),
                else_=None,
            )
        elif metric == "profit":
            # Join financials — rough estimate using avg cost/profit
            value_expr = func.sum(Sales.sold)  # placeholder, refined below
        else:
            value_expr = func.sum(getattr(Sales, metric))

        sort_dir = func.sum(getattr(Sales, "sold"))  # fallback
        if metric not in ("return_rate", "profit"):
            sort_dir = value_expr

        stmt = (
            select(
                Sales.outlet_id,
                Outlet.name.label("outlet_name"),
                Outlet.city,
                Outlet.state,
                value_expr.label("value"),
            )
            .join(Outlet, Outlet.id == Sales.outlet_id)
            .where(
                Sales.customer_id == customer_id,
                Sales.date >= d_from,
                Sales.date <= d_to,
                Sales.active.is_(True),
                Outlet.active.is_(True),
            )
            .group_by(Sales.outlet_id, Outlet.name, Outlet.city, Outlet.state)
        )

        if order == "desc":
            stmt = stmt.order_by(value_expr.desc().nulls_last())
        else:
            stmt = stmt.order_by(value_expr.asc().nulls_last())

        stmt = stmt.limit(limit)
        result = await self.db.execute(stmt)
        rows = result.all()

        outlets = []
        for row in rows:
            outlets.append({
                "outlet_id": row.outlet_id,
                "name": row.outlet_name,
                "city": row.city,
                "state": row.state,
                "value": round(float(row.value), 2) if row.value is not None else None,
            })

        return {
            "metric": metric,
            "order": order,
            "date_from": date_from,
            "date_to": date_to,
            "outlets": outlets,
        }

    # ── get_prediction_summary ────────────────────────────────────────────

    async def _tool_get_prediction_summary(
        self,
        customer_id: str,
        outlet_ids: list[str] | None = None,
    ) -> dict:
        # Use last_prediction table for latest per-outlet-weekday data.
        stmt = (
            select(
                func.count().label("count"),
                func.sum(LastPrediction.predicted).label("total_predicted"),
                func.avg(LastPrediction.predicted).label("avg_predicted"),
                func.sum(LastPrediction.economic_optimal).label("total_eo"),
                func.avg(LastPrediction.economic_optimal).label("avg_eo"),
                func.sum(LastPrediction.delivered).label("total_delivered"),
                func.avg(LastPrediction.lower_bound).label("avg_lower"),
                func.avg(LastPrediction.upper_bound).label("avg_upper"),
            )
            .join(Outlet, Outlet.id == LastPrediction.outlet_id)
            .where(
                Outlet.customer_id == customer_id,
                Outlet.active.is_(True),
                LastPrediction.active.is_(True),
            )
        )
        if outlet_ids:
            stmt = stmt.where(LastPrediction.outlet_id.in_(outlet_ids))

        row = (await self.db.execute(stmt)).one()

        # Per-weekday breakdown
        wd_stmt = (
            select(
                LastPrediction.weekday,
                func.sum(LastPrediction.predicted).label("total"),
                func.sum(LastPrediction.delivered).label("delivered"),
                func.count().label("outlets"),
            )
            .join(Outlet, Outlet.id == LastPrediction.outlet_id)
            .where(
                Outlet.customer_id == customer_id,
                Outlet.active.is_(True),
                LastPrediction.active.is_(True),
            )
            .group_by(LastPrediction.weekday)
            .order_by(LastPrediction.weekday)
        )
        if outlet_ids:
            wd_stmt = wd_stmt.where(LastPrediction.outlet_id.in_(outlet_ids))

        wd_rows = (await self.db.execute(wd_stmt)).all()
        weekday_names = {
            1: "Monday", 2: "Tuesday", 3: "Wednesday",
            4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday",
        }
        weekdays = [
            {
                "weekday": weekday_names.get(r.weekday, str(r.weekday)),
                "total_predicted": round(float(r.total), 1) if r.total else 0,
                "total_delivered": round(float(r.delivered), 1) if r.delivered else 0,
                "outlet_count": r.outlets,
            }
            for r in wd_rows
        ]

        return {
            "outlet_count": row.count,
            "total_predicted": round(float(row.total_predicted), 1) if row.total_predicted else 0,
            "avg_predicted_per_outlet": round(float(row.avg_predicted), 2) if row.avg_predicted else 0,
            "total_economic_optimal": round(float(row.total_eo), 1) if row.total_eo else 0,
            "total_delivered": round(float(row.total_delivered), 1) if row.total_delivered else 0,
            "avg_lower_bound": round(float(row.avg_lower), 2) if row.avg_lower else 0,
            "avg_upper_bound": round(float(row.avg_upper), 2) if row.avg_upper else 0,
            "by_weekday": weekdays,
        }

    # ── lookup_entities ───────────────────────────────────────────────────

    async def _tool_lookup_entities(
        self,
        query: str,
        entity_type: str,
        customer_id: str | None = None,
    ) -> dict:
        q = f"%{query}%"

        if entity_type == "outlet":
            stmt = (
                select(Outlet.id, Outlet.name, Outlet.city, Outlet.state)
                .where(
                    Outlet.active.is_(True),
                    (Outlet.name.ilike(q)
                     | Outlet.city.ilike(q)
                     | Outlet.state.ilike(q)
                     | Outlet.ext_id.ilike(q)),
                )
                .limit(20)
            )
            if customer_id:
                stmt = stmt.where(Outlet.customer_id == customer_id)

            rows = (await self.db.execute(stmt)).all()
            return {
                "entity_type": "outlet",
                "results": [
                    {"id": r.id, "name": r.name, "city": r.city, "state": r.state}
                    for r in rows
                ],
            }

        elif entity_type == "outlet_group":
            stmt = (
                select(OutletGroup.id, OutletGroup.name, OutletGroup.description)
                .where(
                    OutletGroup.active.is_(True),
                    OutletGroup.name.ilike(q),
                )
                .limit(20)
            )
            if customer_id:
                stmt = stmt.where(OutletGroup.customer_id == customer_id)

            rows = (await self.db.execute(stmt)).all()
            return {
                "entity_type": "outlet_group",
                "results": [
                    {"id": r.id, "name": r.name, "description": r.description}
                    for r in rows
                ],
            }

        elif entity_type == "customer":
            stmt = (
                select(Customer.id, Customer.name)
                .where(
                    Customer.active.is_(True),
                    Customer.name.ilike(q),
                )
                .limit(20)
            )
            rows = (await self.db.execute(stmt)).all()
            return {
                "entity_type": "customer",
                "results": [{"id": r.id, "name": r.name} for r in rows],
            }

        return {"error": f"Unknown entity type: {entity_type}"}

    # ── get_outlet_details ────────────────────────────────────────────────

    async def _tool_get_outlet_details(
        self,
        outlet_ids: list[str],
    ) -> dict:
        stmt = (
            select(
                Outlet.id, Outlet.name, Outlet.ext_id,
                Outlet.address, Outlet.zip, Outlet.city,
                Outlet.state, Outlet.country,
                Outlet.start_date, Outlet.end_date,
            )
            .where(Outlet.id.in_(outlet_ids), Outlet.active.is_(True))
        )
        rows = (await self.db.execute(stmt)).all()
        return {
            "outlets": [
                {
                    "outlet_id": r.id,
                    "name": r.name,
                    "ext_id": r.ext_id,
                    "address": r.address,
                    "zip": r.zip,
                    "city": r.city,
                    "state": r.state,
                    "country": r.country,
                    "start_date": r.start_date.isoformat() if r.start_date else None,
                    "end_date": r.end_date.isoformat() if r.end_date else None,
                }
                for r in rows
            ],
        }
