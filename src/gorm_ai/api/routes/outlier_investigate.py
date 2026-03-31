"""API route for AI-powered outlier investigation."""

from collections import Counter

import anthropic
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from gorm_ai.api.deps import DbSession
from gorm_ai.config import get_settings
from gorm_ai.database.models.outlet import Outlet

router = APIRouter()

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


class InvestigateRequest(BaseModel):
    """Request to investigate a recurring outlier date."""

    customer_id: str
    outlet_ids: list[str]
    month: int
    day: int
    years: list[int]
    direction: str  # "positive" | "negative"


@router.post("/investigate")
async def investigate_outlier(
    data: InvestigateRequest,
    session: DbSession,
) -> StreamingResponse:
    """Investigate what may have caused a recurring sales outlier."""
    settings = get_settings()
    if not settings.claude_api:
        raise HTTPException(
            status_code=503,
            detail="Anthropic API key not configured",
        )

    # Determine customer location from outlet addresses
    result = await session.execute(
        select(Outlet.country, Outlet.state, Outlet.city).where(
            Outlet.id.in_(data.outlet_ids),
            Outlet.active.is_(True),
        )
    )
    rows = result.all()

    countries = Counter(
        r.country for r in rows if r.country
    )
    states = Counter(r.state for r in rows if r.state)
    cities = Counter(r.city for r in rows if r.city)

    # Build location description
    location_parts = []
    if countries:
        top_country = countries.most_common(1)[0][0]
        location_parts.append(top_country)
    if states:
        top_states = [s for s, _ in states.most_common(3)]
        location_parts.append(
            f"primarily in {', '.join(top_states)}"
        )
    if cities and len(cities) <= 5:
        top_cities = [c for c, _ in cities.most_common(5)]
        location_parts.append(
            f"cities: {', '.join(top_cities)}"
        )

    location = ", ".join(location_parts) if location_parts else "unknown location"
    direction_desc = (
        "abnormally high (spike)" if data.direction == "positive"
        else "abnormally low (dip)"
    )
    month_name = MONTH_NAMES[data.month] if 1 <= data.month <= 12 else str(data.month)
    years_str = ", ".join(str(y) for y in sorted(data.years))
    date_str = f"{month_name} {data.day}"

    prompt = (
        f"On {date_str} in the years {years_str}, sales were "
        f"{direction_desc} for retail/distribution outlets "
        f"located in {location}.\n\n"
        "What events, holidays, observances, weather patterns, "
        "or other conditions could explain this recurring sales "
        "anomaly on this specific date?\n\n"
        "Consider:\n"
        "- National and regional holidays or observances\n"
        "- Recurring cultural or sporting events\n"
        "- Typical weather patterns for this region and time of year\n"
        "- Industry-specific patterns (retail, distribution)\n"
        "- Election cycles if applicable\n"
        "- School schedules (breaks, start dates)\n"
        "- Recurring promotional events "
        "(e.g. Black Friday for late November)\n\n"
        f"Be specific about which events fall on or near "
        f"{date_str}. If the anomaly is a dip, focus on events "
        "that would reduce foot traffic or close businesses. "
        "If it's a spike, focus on events that drive increased "
        "demand.\n\n"
        "Provide a concise analysis, 3-5 most likely "
        "explanations ranked by probability."
    )

    client = anthropic.Anthropic(api_key=settings.claude_api)

    async def generate():
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield text

    return StreamingResponse(
        generate(),
        media_type="text/plain",
    )
