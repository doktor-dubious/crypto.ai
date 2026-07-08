"""API routes for standalone swing/crest analysis (Trading → Trend Swings).

The analysis is pure kline data — a simulation is never required. Scope is
passed explicitly (coin/pair/timeframe/date-range); ``confirm_sim_id``
optionally borrows a simulation's stored P(up) forecasts for the
model-confirmation entry filter (the one genuinely model-dependent feature).
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import DbSession
from crypto_ai.schemas.kline_simulation import SwingAnalysisResponse, SwingOptimizeResponse
from crypto_ai.services.swing_analysis import SwingAnalysisService

router = APIRouter()


def _parse_weights(weights: str | None) -> dict[str, float]:
    """'volume:200,streak:50' → {key: multiplier}; 100 = equal-weight baseline."""
    out: dict[str, float] = {}
    if weights:
        try:
            for pair in weights.split(","):
                if not pair.strip():
                    continue
                key, pct = pair.split(":")
                out[key.strip()] = float(pct) / 100.0
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Malformed weights: {weights!r}")
    return out


@router.get("", response_model=SwingAnalysisResponse)
async def swing_analysis(
    session: DbSession,
    coin_id: Annotated[str, Query()],
    quote_asset: Annotated[str, Query()],
    interval: Annotated[str, Query()],
    start_date: Annotated[date, Query()],
    end_date: Annotated[date, Query()],
    threshold: Annotated[float, Query(ge=0.0, le=5.0)] = 1.0,
    hold_bars: Annotated[int, Query(ge=1, le=96)] = 6,
    fee_bps: Annotated[float, Query(ge=0.0, le=100.0)] = 8.0,
    side: Annotated[str, Query()] = "long",
    confirm_sim_id: Annotated[str | None, Query()] = None,
    signals: Annotated[str | None, Query()] = None,
    sl_mode: Annotated[str, Query()] = "none",
    sl_value: Annotated[float, Query(ge=0.05, le=50.0)] = 2.0,
    tp_mode: Annotated[str, Query()] = "none",
    tp_value: Annotated[float, Query(ge=0.05, le=100.0)] = 3.0,
    weights: Annotated[str | None, Query()] = None,
) -> SwingAnalysisResponse:
    """Signal-composite swing backtest over an explicit kline scope."""
    if side not in ("long", "short", "both"):
        raise HTTPException(status_code=400, detail=f"Unknown side: {side}")
    if start_date >= end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    enabled = {s.strip() for s in signals.split(",") if s.strip()} if signals else None
    scope = {
        "coin_id": coin_id, "quote_asset": quote_asset, "interval": interval,
        "start_date": start_date, "end_date": end_date,
    }
    result = await SwingAnalysisService(session).analyze(
        scope, confirm_sim_id=confirm_sim_id,
        threshold=threshold, hold_bars=hold_bars, fee_bps=fee_bps, side=side,
        signals=enabled, sl_mode=sl_mode, sl_value=sl_value,
        tp_mode=tp_mode, tp_value=tp_value,
        weights=_parse_weights(weights) or None,
    )
    if result is None or result.get("error"):
        raise HTTPException(status_code=400, detail=(result or {}).get("error", "Analysis failed"))
    return SwingAnalysisResponse(**result)


@router.get("/optimize", response_model=SwingOptimizeResponse)
async def swing_optimize(
    session: DbSession,
    coin_id: Annotated[str, Query()],
    quote_asset: Annotated[str, Query()],
    interval: Annotated[str, Query()],
    start_date: Annotated[date, Query()],
    end_date: Annotated[date, Query()],
    fee_bps: Annotated[float, Query(ge=0.0, le=100.0)] = 4.0,
    confirm_sim_id: Annotated[str | None, Query()] = None,
) -> SwingOptimizeResponse:
    """Bounded knob sweep over an explicit scope; tuned on the first half,
    judged on the untouched second half."""
    if start_date >= end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    scope = {
        "coin_id": coin_id, "quote_asset": quote_asset, "interval": interval,
        "start_date": start_date, "end_date": end_date,
    }
    result = await SwingAnalysisService(session).optimize(
        scope, confirm_sim_id=confirm_sim_id, fee_bps=fee_bps,
    )
    if result is None or result.get("error"):
        detail = (result or {}).get("error", "Optimization failed")
        raise HTTPException(status_code=400, detail=detail)
    return SwingOptimizeResponse(**result)
