"""API route for scalping-strategy analysis (Trading → Strategies → Scalping).

Pure kline analysis over an explicit scope, one endpoint for the three
strategy families; ``strategy`` selects the entry-signal builder and
``params`` carries its knobs as "name:value,name:value".
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import DbSession
from crypto_ai.schemas.kline_simulation import ScalpAnalysisResponse
from crypto_ai.services.scalp_analysis import ScalpAnalysisService

router = APIRouter()


@router.get("", response_model=ScalpAnalysisResponse)
async def scalp_analysis(
    session: DbSession,
    coin_id: Annotated[str, Query()],
    quote_asset: Annotated[str, Query()],
    interval: Annotated[str, Query()],
    start_date: Annotated[date, Query()],
    end_date: Annotated[date, Query()],
    strategy: Annotated[str, Query()],
    indicator: Annotated[str, Query()] = "ema",
    threshold: Annotated[float, Query(ge=-5.0, le=10.0)] = 1.0,
    hold_bars: Annotated[int, Query(ge=1, le=96)] = 6,
    fee_bps: Annotated[float, Query(ge=0.0, le=100.0)] = 4.0,
    side: Annotated[str, Query()] = "both",
    sl_mode: Annotated[str, Query()] = "none",
    sl_value: Annotated[float, Query(ge=0.05, le=50.0)] = 2.0,
    tp_mode: Annotated[str, Query()] = "none",
    tp_value: Annotated[float, Query(ge=0.05, le=100.0)] = 3.0,
    params: Annotated[str | None, Query()] = None,
    vol_gate: Annotated[str, Query()] = "off",
    vol_level: Annotated[float, Query(ge=0.1, le=5.0)] = 1.0,
) -> ScalpAnalysisResponse:
    """Backtest one scalping strategy over an explicit kline scope."""
    if side not in ("long", "short", "both"):
        raise HTTPException(status_code=400, detail=f"Unknown side: {side}")
    if start_date >= end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    param_map: dict[str, float] = {}
    if params:
        try:
            for pair in params.split(","):
                if not pair.strip():
                    continue
                key, val = pair.split(":")
                param_map[key.strip()] = float(val)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Malformed params: {params!r}")

    scope = {
        "coin_id": coin_id, "quote_asset": quote_asset, "interval": interval,
        "start_date": start_date, "end_date": end_date,
    }
    result = await ScalpAnalysisService(session).analyze(
        scope, strategy, indicator=indicator,
        threshold=threshold, hold_bars=hold_bars, fee_bps=fee_bps, side=side,
        sl_mode=sl_mode, sl_value=sl_value, tp_mode=tp_mode, tp_value=tp_value,
        params=param_map or None, vol_gate=vol_gate, vol_level=vol_level,
    )
    if result is None or result.get("error"):
        detail = (result or {}).get("error", "Analysis failed")
        raise HTTPException(status_code=400, detail=detail)
    return ScalpAnalysisResponse(**result)
