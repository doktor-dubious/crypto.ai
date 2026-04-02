"""Tool executor for the chat service.

Each tool runs a safe, parameterized query against the database and returns
aggregated summaries — never raw row-level data.  The results are passed back
to the LLM so it can compose a natural-language answer.
"""

from __future__ import annotations

import re
from datetime import date

import structlog
from sqlalchemy import text as sa_text, func, select, case, extract
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.customer import Customer
from gorm_ai.database.models.last_prediction import LastPrediction
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_financials import OutletFinancials
from gorm_ai.database.models.outlet_group import OutletGroup, OutletGroupMember
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.outlet_info import OutletInfo
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
    {
        "name": "get_database_schema",
        "description": (
            "Returns the database schema (table names, column names and types, "
            "foreign keys) and a summary of outlet_info keys for the customer. "
            "Call this BEFORE run_query so you know which tables and columns "
            "are available."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "Customer UUID — used to list outlet_info keys.",
                },
            },
            "required": ["customer_id"],
        },
    },
    {
        "name": "run_query",
        "description": (
            "Execute a READ-ONLY SQL query against the database and return "
            "up to 50 rows.  Use this for ad-hoc questions that the other "
            "tools cannot answer.  You MUST call get_database_schema first "
            "to know the available tables and columns.\n\n"
            "Rules:\n"
            "- Only SELECT statements are allowed.\n"
            "- You MUST provide customer_id — it will be enforced server-side.\n"
            "- Always filter by active = true unless explicitly asked about "
            "inactive records.\n"
            "- Prefer aggregated queries (GROUP BY, SUM, AVG, COUNT) over "
            "returning raw rows.\n"
            "- Maximum 50 rows returned."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "Customer UUID — query is scoped to this customer.",
                },
                "sql": {
                    "type": "string",
                    "description": "A read-only SELECT SQL query.",
                },
            },
            "required": ["customer_id", "sql"],
        },
    },
    {
        "name": "run_prediction",
        "description": (
            "Trigger a new prediction for a date range.  Returns a summary "
            "of the prediction results (total predicted demand, per-weekday "
            "breakdown, top/bottom outlets).  Use this when the user asks "
            "about future demand or forecasts for dates that haven't been "
            "predicted yet.\n\n"
            "The prediction engine, strategy, and worker are configured "
            "per-customer — you don't need to choose them."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "Customer UUID.",
                },
                "prediction_from": {
                    "type": "string",
                    "description": "Start date (YYYY-MM-DD).",
                },
                "prediction_to": {
                    "type": "string",
                    "description": "End date (YYYY-MM-DD).",
                },
                "outlet_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional outlet UUIDs. Omit for all outlets.",
                },
                "outlet_group_id": {
                    "type": "string",
                    "description": "Optional outlet group UUID.",
                },
            },
            "required": ["customer_id", "prediction_from", "prediction_to"],
        },
    },
]


# ── Tool executor ─────────────────────────────────────────────────────────────

class ToolExecutor:
    """Execute chat tools against the database, returning aggregated data."""

    def __init__(self, db: AsyncSession, allowed_customer_id: str | None = None) -> None:
        self.db = db
        self.allowed_customer_id = allowed_customer_id

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

    # ── get_database_schema ───────────────────────────────────────────────

    async def _tool_get_database_schema(
        self,
        customer_id: str,
    ) -> dict:
        schema = _get_schema_description()

        # Fetch outlet_info keys for this customer
        stmt = (
            select(OutletInfo.key, func.count().label("cnt"))
            .join(Outlet, Outlet.id == OutletInfo.outlet_id)
            .where(
                Outlet.customer_id == customer_id,
                Outlet.active.is_(True),
                OutletInfo.active.is_(True),
            )
            .group_by(OutletInfo.key)
            .order_by(func.count().desc())
        )
        rows = (await self.db.execute(stmt)).all()
        info_keys = [
            {"key": r.key, "outlet_count": r.cnt}
            for r in rows
        ]

        # Fetch outlet_group names
        grp_stmt = (
            select(OutletGroup.id, OutletGroup.name)
            .where(
                OutletGroup.customer_id == customer_id,
                OutletGroup.active.is_(True),
            )
        )
        grp_rows = (await self.db.execute(grp_stmt)).all()

        return {
            "schema": schema,
            "outlet_info_keys": info_keys,
            "outlet_groups": [
                {"id": r.id, "name": r.name} for r in grp_rows
            ],
            "note": (
                "All tables have: id (UUID PK), active (bool), "
                "created_at, updated_at. Always filter by active = true. "
                "Always filter by customer_id to respect data boundaries."
            ),
        }

    # ── run_query ─────────────────────────────────────────────────────────

    async def _tool_run_query(self, customer_id: str, sql: str) -> dict:
        # Enforce customer scope
        if self.allowed_customer_id and customer_id != self.allowed_customer_id:
            return {"error": "Access denied: wrong customer_id."}

        # Validate: only SELECT allowed
        cleaned = sql.strip().rstrip(";").strip()
        if not re.match(r"(?i)^\s*SELECT\b", cleaned):
            return {"error": "Only SELECT queries are allowed."}

        # Block dangerous keywords
        upper = cleaned.upper()
        for forbidden in [
            "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE",
            "CREATE", "GRANT", "REVOKE", "COPY", "EXECUTE", "DO ",
        ]:
            if re.search(rf"\b{forbidden}\b", upper):
                return {"error": f"Forbidden keyword: {forbidden}"}

        # Verify customer_id appears in the query (prevent cross-customer access)
        if customer_id not in cleaned:
            return {
                "error": (
                    "Query must filter by the provided customer_id. "
                    "Include a WHERE clause with customer_id = "
                    f"'{customer_id}' or join through a table that does."
                ),
            }

        # Add LIMIT if not present
        if "LIMIT" not in upper:
            cleaned += " LIMIT 50"

        try:
            # Use a savepoint so we don't corrupt the parent transaction
            async with self.db.begin_nested():
                result = await self.db.execute(sa_text(cleaned))
                columns = list(result.keys())
                rows_raw = result.fetchall()

            rows = []
            for row in rows_raw[:50]:
                row_dict = {}
                for i, col in enumerate(columns):
                    val = row[i]
                    if hasattr(val, "isoformat"):
                        val = val.isoformat()
                    elif isinstance(val, (bytes, memoryview)):
                        val = "<binary>"
                    row_dict[col] = val
                rows.append(row_dict)

            return {
                "columns": columns,
                "row_count": len(rows),
                "rows": rows,
            }
        except Exception as exc:
            log.error("run_query_error", error=str(exc), sql=cleaned[:200])
            return {"error": f"Query failed: {exc}"}

    # ── run_prediction ────────────────────────────────────────────────────

    async def _tool_run_prediction(
        self,
        customer_id: str,
        prediction_from: str,
        prediction_to: str,
        outlet_ids: list[str] | None = None,
        outlet_group_id: str | None = None,
    ) -> dict:
        if self.allowed_customer_id and customer_id != self.allowed_customer_id:
            return {"error": "Access denied: wrong customer_id."}

        from gorm_ai.schemas.prediction import PredictionRequest
        from gorm_ai.services.prediction import PredictionService

        # Load insights prediction settings from customer config
        result = await self.db.execute(
            select(
                CustomerConfiguration.insights_prediction_engine_id,
                CustomerConfiguration.insights_prediction_strategy_id,
                CustomerConfiguration.insights_worker,
            ).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        config_row = result.one_or_none()

        engine_slug = None
        strategy_id = None
        worker = None
        if config_row:
            if config_row[0]:
                # Resolve engine slug from ID
                from gorm_ai.database.models.prediction_engine import (
                    PredictionEngine as PEModel,
                )
                r = await self.db.execute(
                    select(PEModel.slug).where(PEModel.id == config_row[0])
                )
                engine_slug = r.scalar_one_or_none()
            strategy_id = config_row[1]
            worker = config_row[2]

        d_from = date.fromisoformat(prediction_from)
        d_to = date.fromisoformat(prediction_to)

        # Build prediction request
        req = PredictionRequest(
            customer_id=customer_id,
            prediction_from=d_from,
            prediction_to=d_to,
            outlet_ids=outlet_ids,
            outlet_group_id=outlet_group_id,
            engine=engine_slug,
            prediction_strategy_id=strategy_id,
        )

        try:
            service = PredictionService(self.db)
            response = await service.create_prediction(req)
            await self.db.commit()

            # Summarize results
            total_predicted = 0.0
            total_eo = 0.0
            outlet_count = 0
            outlet_summaries = []

            for op in response.outlets:
                outlet_count += 1
                op_total = sum(r.predicted_value for r in op.results)
                op_eo = sum(r.economic_optimal or 0 for r in op.results)
                total_predicted += op_total
                total_eo += op_eo
                outlet_summaries.append({
                    "outlet_id": op.outlet_id,
                    "total_predicted": round(op_total, 1),
                    "total_eo": round(op_eo, 1),
                    "days": len(op.results),
                })

            # Sort and take top/bottom 5
            outlet_summaries.sort(key=lambda x: x["total_predicted"], reverse=True)
            top5 = outlet_summaries[:5]
            bottom5 = outlet_summaries[-5:] if len(outlet_summaries) > 5 else []

            # Resolve outlet names for top/bottom
            all_ids = [o["outlet_id"] for o in top5 + bottom5]
            if all_ids:
                name_result = await self.db.execute(
                    select(Outlet.id, Outlet.name).where(Outlet.id.in_(all_ids))
                )
                name_map = {r.id: r.name for r in name_result.all()}
                for o in top5 + bottom5:
                    o["name"] = name_map.get(o["outlet_id"], "")

            horizon = (d_to - d_from).days + 1
            return {
                "prediction_id": response.id,
                "engine": response.engine,
                "date_from": prediction_from,
                "date_to": prediction_to,
                "horizon_days": horizon,
                "outlet_count": outlet_count,
                "total_predicted": round(total_predicted, 1),
                "total_economic_optimal": round(total_eo, 1),
                "avg_per_outlet_per_day": round(
                    total_predicted / max(outlet_count * horizon, 1), 2,
                ),
                "top_5_outlets": top5,
                "bottom_5_outlets": bottom5,
            }
        except Exception as exc:
            log.error("prediction_error", error=str(exc))
            return {"error": f"Prediction failed: {exc}"}


# ── Auto-generated schema description ─────────────────────────────────────────

_SCHEMA_TABLES = [
    {
        "table": "customers",
        "description": "Customer records",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("name", "VARCHAR(255)", "Customer name"),
            ("description", "TEXT", "Optional description"),
            ("notes", "TEXT", "Optional notes"),
            ("type", "SMALLINT", "Customer type"),
        ],
    },
    {
        "table": "outlets",
        "description": "Sales outlets / accounts / points of sale",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("customer_id", "UUID", "FK → customers.id"),
            ("ext_id", "VARCHAR(50)", "External ID used by customer"),
            ("ext_id_2", "INT", "Secondary external ID"),
            ("name", "VARCHAR(255)", "Outlet name"),
            ("description", "TEXT", "Optional description"),
            ("notes", "TEXT", "Optional notes"),
            ("address", "VARCHAR(255)", "Street address"),
            ("zip", "VARCHAR(20)", "Postal code"),
            ("city", "VARCHAR(100)", "City"),
            ("state", "VARCHAR(100)", "State / region"),
            ("country", "VARCHAR(100)", "Country"),
            ("start_date", "DATE", "When outlet started"),
            ("end_date", "DATE", "When outlet was deactivated"),
            ("scan", "BOOL", "Scan-based outlet"),
            ("season", "BOOL", "Seasonal outlet"),
            ("sublets", "BOOL", "Has sublets"),
        ],
    },
    {
        "table": "outlet_info",
        "description": "Key-value metadata for outlets (type, region, chain, etc.)",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("outlet_id", "UUID", "FK → outlets.id"),
            ("key", "VARCHAR(100)", "Metadata key name"),
            ("value", "TEXT", "Metadata value"),
        ],
    },
    {
        "table": "sales",
        "description": (
            "Daily sales data (TimescaleDB hypertable). "
            "IMPORTANT: The date column is called 'date', NOT 'sale_date'. "
            "Always JOIN with outlets table to get outlet name. "
            "If you need outlet names in results, include the JOIN in every "
            "subquery level that needs it, or join at the outermost level."
        ),
        "columns": [
            ("id", "UUID", "Part of composite PK"),
            ("date", "DATE", "Sale date — column name is 'date' (NOT sale_date)"),
            ("customer_id", "UUID", "FK → customers.id"),
            ("outlet_id", "UUID", "FK → outlets.id — JOIN outlets ON outlets.id = sales.outlet_id for name"),
            ("sold", "INT", "Units sold (core field)"),
            ("delivered", "INT", "Units delivered"),
            ("scan_sold", "INT", "Units sold via scan"),
            ("net_sold", "INT", "Net units sold"),
        ],
    },
    {
        "table": "outlet_financials",
        "description": "Cost/profit per unit per weekday per outlet",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("outlet_id", "UUID", "FK → outlets.id"),
            ("weekday", "SMALLINT", "1=Monday, 7=Sunday"),
            ("cost_per_unit", "FLOAT", "Cost per unit"),
            ("profit_per_unit", "FLOAT", "Profit per unit"),
        ],
    },
    {
        "table": "outlet_deliveries",
        "description": "Delivery config per weekday per outlet",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("outlet_id", "UUID", "FK → outlets.id"),
            ("weekday", "SMALLINT", "1=Monday, 7=Sunday"),
            ("open", "BOOL", "Outlet open on this day"),
            ("fixed", "FLOAT", "Fixed delivery quantity"),
            ("minimum", "FLOAT", "Minimum delivery"),
            ("maximum", "FLOAT", "Maximum delivery"),
            ("add", "FLOAT", "Fixed amount to add"),
            ("add_pct", "FLOAT", "Percentage to add"),
        ],
    },
    {
        "table": "outlet_group",
        "description": "Named groups of outlets",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("customer_id", "UUID", "FK → customers.id"),
            ("name", "VARCHAR(255)", "Group name"),
            ("description", "TEXT", "Description"),
        ],
    },
    {
        "table": "outlet_group_members",
        "description": "Association: which outlets belong to which groups",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("group_id", "UUID", "FK → outlet_group.id"),
            ("outlet_id", "UUID", "FK → outlets.id"),
        ],
    },
    {
        "table": "predictions",
        "description": "Prediction run metadata",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("customer_id", "UUID", "FK → customers.id"),
            ("date", "DATE", "Prediction date"),
            ("engine", "TEXT", "Engine used"),
            ("requested_engine", "TEXT", "Engine requested"),
            ("delay", "SMALLINT", "History cutoff days"),
        ],
    },
    {
        "table": "prediction_outlets",
        "description": "Per-outlet prediction results",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("prediction_id", "UUID", "FK → predictions.id"),
            ("outlet_id", "UUID", "FK → outlets.id"),
            ("predicted", "FLOAT", "P50 point forecast"),
            ("lower_bound", "FLOAT", "P10"),
            ("upper_bound", "FLOAT", "P90"),
            ("eo", "FLOAT", "Economic optimal (Newsvendor)"),
            ("cv", "FLOAT", "Coefficient of variation"),
            ("actual_sale", "FLOAT", "Actual sale at prediction time"),
            ("q20", "FLOAT", "P20 quantile"),
            ("q30", "FLOAT", "P30"), ("q40", "FLOAT", "P40"),
            ("q50", "FLOAT", "P50"), ("q60", "FLOAT", "P60"),
            ("q70", "FLOAT", "P70"), ("q80", "FLOAT", "P80"),
        ],
    },
    {
        "table": "last_prediction",
        "description": "Latest prediction per outlet per weekday (overwritten each run)",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("outlet_id", "UUID", "FK → outlets.id"),
            ("prediction_id", "UUID", "FK → predictions.id"),
            ("weekday", "SMALLINT", "1=Mon, 7=Sun"),
            ("predicted", "FLOAT", "P50"),
            ("economic_optimal", "FLOAT", "EO"),
            ("delivered", "FLOAT", "Delivered quantity"),
            ("lower_bound", "FLOAT", "P10"),
            ("upper_bound", "FLOAT", "P90"),
            ("cv", "FLOAT", "Coefficient of variation"),
        ],
    },
    {
        "table": "pads",
        "description": "Prediction Adjustment Dates — special event definitions",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("customer_id", "UUID", "FK → customers.id"),
            ("name", "TEXT", "PAD name (e.g. 'Christmas')"),
            ("historic_days", "INT", "0=all history"),
            ("allow_negative", "BOOL", "Allow negative adjustment"),
            ("boost", "FLOAT", "Fixed copy adjustment"),
            ("boost_pct", "FLOAT", "Percentage adjustment"),
        ],
    },
    {
        "table": "pad_dates",
        "description": "Specific dates belonging to a PAD",
        "columns": [
            ("id", "UUID", "Primary key"),
            ("pad_id", "UUID", "FK → pads.id"),
            ("date", "DATE", "The special date"),
        ],
    },
]


def _get_schema_description() -> str:
    """Build a human-readable schema description from the table definitions."""
    parts = []
    for tbl in _SCHEMA_TABLES:
        cols = "\n".join(
            f"    {c[0]:30s} {c[1]:15s} — {c[2]}" for c in tbl["columns"]
        )
        parts.append(f"### {tbl['table']}\n{tbl['description']}\n{cols}")
    return "\n\n".join(parts)
