"""AI narrative for a single cohort audit result.

Streams a Claude-generated diagnosis for one cohort (e.g. one delivery
route) given its precomputed audit findings. Mirrors the streaming
pattern in `outlier_investigate.py` and shares the same per-customer
token-accounting tables.
"""

from collections import Counter

import anthropic
import structlog
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from gorm_ai.api.deps import DbSession
from gorm_ai.config import get_settings
from gorm_ai.database.models.customer import Customer
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.schemas.cohort_audit import CohortResult
from gorm_ai.services.llm_usage import record_anthropic_usage

router = APIRouter()
log = structlog.get_logger("gorm_ai.llm")

WEEKDAY_NAMES = [
    "", "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
]


class CohortInvestigateRequest(BaseModel):
    """Investigate one cohort's audit findings with Claude.

    The caller passes the already-computed `CohortResult` rather than
    asking us to re-run the audit — the audit is the data path, this
    endpoint is just narrative. Customer-level context (name, location)
    is filled in server-side.
    """

    customer_id: str
    cohort_key: str  # e.g. "route"
    cohort: CohortResult
    sequenced: bool = False
    shared_driver: bool = False
    start_date: str  # ISO date — the audit window for prompt context
    end_date: str


def _format_location(
    countries: Counter, states: Counter, cities: Counter,
) -> str:
    parts = []
    if countries:
        parts.append(countries.most_common(1)[0][0])
    if states:
        top_states = [s for s, _ in states.most_common(3)]
        parts.append(f"primarily in {', '.join(top_states)}")
    if cities and len(cities) <= 5:
        top_cities = [c for c, _ in cities.most_common(5)]
        parts.append(f"cities: {', '.join(top_cities)}")
    return ", ".join(parts) if parts else "unknown location"


def _build_prompt(
    req: CohortInvestigateRequest,
    customer_name: str,
    location: str,
    outlet_address_by_id: dict[str, str],
) -> str:
    c = req.cohort
    cohort_label = f"{req.cohort_key} {c.cohort_value}"

    tcs_str = f"{c.tcs:.3f}" if c.tcs is not None else "n/a"
    p_str = f"{c.tcs_p_value:.3f}" if c.tcs_p_value is not None else "n/a"
    top_wd = (
        WEEKDAY_NAMES[c.top_weekday]
        if c.top_weekday is not None else "no clear pattern"
    )

    # Top 5 most-skipped outlets
    top_outlets_lines = []
    for o in c.outlets[:5]:
        if o.skip_count == 0:
            break
        addr = outlet_address_by_id.get(o.outlet_id, "")
        rate_pct = o.skip_rate * 100
        line = (
            f"  - ext_id={o.ext_id} \"{o.outlet_name}\""
            f"{' at ' + addr if addr else ''}: "
            f"skipped {o.skip_count}/{o.active_open_days} expected days "
            f"({rate_pct:.1f}%)"
        )
        top_outlets_lines.append(line)
    top_outlets_block = (
        "\n".join(top_outlets_lines) if top_outlets_lines
        else "  (none)"
    )

    # Inferred tail (if sequenced)
    tail_block = ""
    if req.sequenced and c.inferred_tail_outlets:
        tail_lines = []
        for oid in c.inferred_tail_outlets:
            o = next(
                (x for x in c.outlets if x.outlet_id == oid), None,
            )
            if o:
                tail_lines.append(
                    f"  {len(tail_lines) + 1}. ext_id={o.ext_id} "
                    f"\"{o.outlet_name}\" "
                    f"(skip rate {o.skip_rate * 100:.1f}%)"
                )
        if tail_lines:
            conf = c.sequence_confidence or "unknown"
            tail_block = (
                f"\n## Inferred route tail (confidence: {conf})\n"
                "Outlets most likely visited last in the route, derived "
                "from pairwise dominance in skip co-occurrence:\n"
                + "\n".join(tail_lines)
                + "\n"
            )

    # Weekday distribution
    wd_pairs = [
        f"{WEEKDAY_NAMES[i + 1][:3]}={n}"
        for i, n in enumerate(c.weekday_distribution) if n > 0
    ]
    weekday_block = (
        " ".join(wd_pairs) if wd_pairs else "no events"
    )

    # Recent skip events
    sorted_events = sorted(
        c.skip_events, key=lambda e: e.date, reverse=True,
    )[:5]
    event_lines = []
    for ev in sorted_events:
        line = (
            f"  - {ev.date.isoformat()} "
            f"({WEEKDAY_NAMES[ev.weekday][:3]}): "
            f"{ev.skipped_count} outlet(s) zero-sale"
        )
        event_lines.append(line)
    events_block = (
        "\n".join(event_lines) if event_lines else "  (none)"
    )

    characteristics = []
    if req.sequenced:
        characteristics.append("outlets are visited in a linear sequence")
    if req.shared_driver:
        characteristics.append("a single driver/operator services them")
    char_str = (
        "; ".join(characteristics)
        if characteristics else "no special structure asserted"
    )

    return f"""You are diagnosing delivery operations for a publication. Below \
is a statistical audit of one cohort — {cohort_label} — at {customer_name} \
({location}). A "skip" here is an abnormal zero-sale event on a day the \
outlet normally sells.

# Audit window
{req.start_date} → {req.end_date}

# Cohort characteristics asserted by the user
{char_str}

# Headline statistics
- Outlets in cohort: {c.outlet_count}
- Skip events (distinct dates with ≥1 zero-sale): {c.skip_event_count}
- Total skipped outlet-day observations: {c.total_skip_observations}
- Overall skip rate: {c.overall_skip_rate * 100:.2f}%
- Tail-Concentration Score (Kendall tau-b): {tcs_str}, p-value {p_str}
  (higher = skips cluster on the same outlets repeatedly)
- No-report days (missing rows on expected delivery days, ambiguous): {c.no_report_count}
- Top weekday for skip events: {top_wd}
- Weekday breakdown: {weekday_block}

# Top affected outlets (by skip count)
{top_outlets_block}
{tail_block}
# Most recent skip events
{events_block}

# Your task

Write a 3–5 sentence operations diagnosis aimed at someone who has to act on \
this. Cover:
1. The most likely root cause, ranked if there are competing explanations. \
Possible causes include: driver shortening the route (chronic same-outlet \
skipping near a route tail), specific outlet-level issues (refused delivery, \
wrong address, closed business), or a mix.
2. The single clearest piece of evidence supporting that diagnosis — cite \
the specific numbers.
3. The single most useful next investigative step.

Be concrete and concise. Cite outlet ext_ids or addresses by name when they \
help. Avoid hedging language ("could", "perhaps") unless the data is \
genuinely ambiguous — if it is, say so plainly."""


@router.post("/cohort-investigate")
async def cohort_investigate(
    data: CohortInvestigateRequest,
    session: DbSession,
) -> StreamingResponse:
    """Generate an AI narrative diagnosing one cohort's skip pattern."""
    settings = get_settings()
    if not settings.claude_api:
        raise HTTPException(
            status_code=503,
            detail="Anthropic API key not configured",
        )

    # Customer name
    cust_result = await session.execute(
        select(Customer.name).where(Customer.id == data.customer_id)
    )
    customer_name = cust_result.scalar() or "Unknown customer"

    # Pull address context for the outlets we'll mention in the prompt.
    mentioned_oids: set[str] = set(
        o.outlet_id for o in data.cohort.outlets[:5] if o.skip_count > 0
    )
    if data.cohort.inferred_tail_outlets:
        mentioned_oids.update(data.cohort.inferred_tail_outlets)

    outlet_address_by_id: dict[str, str] = {}
    location = "unknown location"
    if data.cohort.outlets:
        cohort_oids = [o.outlet_id for o in data.cohort.outlets]
        result = await session.execute(
            select(
                Outlet.id, Outlet.address, Outlet.city,
                Outlet.state, Outlet.country,
            ).where(Outlet.id.in_(cohort_oids))
        )
        rows = result.all()

        for r in rows:
            if r.id in mentioned_oids:
                parts = [p for p in (r.address, r.city, r.state) if p]
                if parts:
                    outlet_address_by_id[r.id] = ", ".join(parts)

        # Aggregate location from cohort outlets (compact summary).
        countries = Counter(r.country for r in rows if r.country)
        states = Counter(r.state for r in rows if r.state)
        cities = Counter(r.city for r in rows if r.city)
        location = _format_location(countries, states, cities)

    prompt = _build_prompt(
        data, customer_name, location, outlet_address_by_id,
    )

    model = "claude-sonnet-4-6"
    model_tag = "Sonnet 4.6"
    llm = log.bind(provider="Claude", model_tag=model_tag)
    llm.info("cohort_investigate.prompt", text=prompt)

    client = anthropic.Anthropic(api_key=settings.claude_api)
    customer_id = data.customer_id

    async def generate():
        response_parts: list[str] = []
        usage_info = None
        try:
            with client.messages.stream(
                model=model,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    response_parts.append(text)
                    yield text
                final = stream.get_final_message()
                if final and final.usage:
                    usage_info = final.usage
        except Exception as exc:
            llm.error("cohort_investigate.error", error=str(exc))
            raise
        finally:
            full_response = "".join(response_parts)
            resp_kwargs: dict = {"text": full_response}
            if usage_info:
                resp_kwargs["input_tokens"] = usage_info.input_tokens
                resp_kwargs["output_tokens"] = usage_info.output_tokens
                await record_anthropic_usage(
                    customer_id,
                    model,
                    usage_info.input_tokens,
                    usage_info.output_tokens,
                )
            llm.info("cohort_investigate.response", **resp_kwargs)

    return StreamingResponse(generate(), media_type="text/plain")
