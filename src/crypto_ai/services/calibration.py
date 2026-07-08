"""Calibration service for crypto model orchestration.

Computes ensemble weights for a set of forecasting engines by running a
**rolling-origin walk-forward backtest** over kline series and weighting each
engine by the inverse of its out-of-sample error.

This is the crypto analog of the retail calibration service: instead of
per-outlet sales series it scores engines over ``(coin_id, quote_asset,
interval)`` kline close-price series, one-step-ahead — exactly how the blend is
used in ``KlineSimulationService``.

Why rolling-origin: the engines are zero-shot foundation models; at each origin
we feed only the closes *before* that origin and score the one-step forecast
against the held-out actual, averaging across origins to reduce variance. Why
inverse-error weighting rather than joint optimization: convex-combination
weights fit on the backtest overfit (the "forecast combination puzzle"); a
consistently more accurate engine simply gets more weight.

Fold ids ``"{series_idx}:{origin_idx}"`` are **deterministic and
engine-independent** (fixed origin constants, deterministic series ordering), so
the orchestration aggregator can compare engines on the folds all of them
completed rather than letting a fragile engine be averaged over only its easy
survivors.
"""

import logging
import math
from datetime import date, timedelta
from typing import Literal

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.kline import Kline
from crypto_ai.prediction.engine import QUANTILE_LEVELS
from crypto_ai.prediction.registry import EngineRegistry
from crypto_ai.schemas.prediction import PredictionEngine as PredictionEngineEnum

logger = logging.getLogger(__name__)

# mase  — MAE scaled by the training series' naive (lag-1) MAE
# smase — MAE scaled by the *seasonal* naive MAE (m per interval, below)
# crps  — mean pinball loss over the nine quantile levels, normalized by the
#         test window's mean |actual| (wQL, the GIFT-Eval convention)
MetricType = Literal["mase", "smase", "mae", "mape", "rmse", "crps"]

# One-step-ahead walk-forward, matching how the blend runs in production. All
# fold geometry is FIXED (engine-independent) so fold ids align across engines.
_HORIZON = 1
_MAX_ORIGINS = 24        # last N one-step folds scored per series
_MIN_TRAIN = 128         # context (closes) required before the first scored fold
_MAX_KEYS = 40           # cap on per-pair keys scored (highest-volume coins)
_MAX_POOLED_SERIES = 40  # cap on series pooled for the "pooled" grain
_CHUNK = 256             # folds per batched engine call

# Synthetic daily index anchor: these zero-shot models forecast the value
# sequence, not the calendar, so a contiguous daily index just preserves order.
_ANCHOR = date(2000, 1, 1)

# Bars per dominant cycle, used only for the smase seasonal-naive denominator.
_SEASON_BY_INTERVAL: dict[str, int] = {
    "1m": 60, "3m": 20, "5m": 12, "15m": 96, "30m": 48,
    "1h": 24, "2h": 12, "4h": 6, "6h": 4, "8h": 3, "12h": 2,
    "1d": 7, "3d": 1, "1w": 1, "1M": 1,
}


def _season_for(interval: str) -> int:
    """Seasonal period for the smase denominator, keyed by kline interval
    (e.g. 24 for hourly = one day, 7 for daily = one week). Defaults to 1
    (plain naive) for intervals with no obvious short cycle."""
    return _SEASON_BY_INTERVAL.get(interval, 1)


class CalibrationService:
    """Scores forecasting engines over kline series via rolling-origin backtest."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.engine_registry = EngineRegistry()

    # -- universe ------------------------------------------------------------

    async def _universe(
        self, coin_ids: list[str], quote_asset: str, interval: str,
    ) -> list[str]:
        """Resolve the list of coin_ids to calibrate over.

        An explicit ``coin_ids`` is used as-is; an empty list means every active
        coin that has klines for this ``(quote_asset, interval)``.
        """
        if coin_ids:
            return list(coin_ids)
        rows = (
            await self.session.execute(
                select(Kline.coin_id)
                .where(
                    Kline.quote_asset == quote_asset,
                    Kline.interval == interval,
                    Kline.active.is_(True),
                )
                .distinct()
            )
        ).scalars().all()
        return sorted(rows)

    async def _fetch_closes(
        self, coin_id: str, quote_asset: str, interval: str,
    ) -> list[float]:
        """Ordered close-price series for one (coin, quote, interval)."""
        rows = (
            await self.session.execute(
                select(Kline.close)
                .where(
                    Kline.coin_id == coin_id,
                    Kline.quote_asset == quote_asset,
                    Kline.interval == interval,
                    Kline.active.is_(True),
                )
                .order_by(Kline.open_time)
            )
        ).scalars().all()
        return [float(c) for c in rows]

    # -- scoring -------------------------------------------------------------

    async def score_engine_keys(
        self,
        coin_ids: list[str],
        quote_asset: str,
        interval: str,
        grain: str | None,
        engine_slug: str,
        metric: MetricType = "mase",
        params: dict[str, str] | None = None,
    ) -> dict[str, dict[str, float]]:
        """Score ONE engine at the chosen grain, returning per-fold scores
        ``{key: {fold_id: score}}``.

        Keys are ``"__pooled__"`` for the pooled grain, or ``"coin_id:quote_asset"``
        for the pair grain. Lower score = better; a fold the engine couldn't
        forecast is absent. This is the distributable unit of work — it runs
        only one engine's inference, so it can execute on a worker that
        advertises that model.
        """
        grain = (grain or "pooled").lower()
        engine_enum = PredictionEngineEnum(engine_slug)
        season = _season_for(interval)

        coins = await self._universe(coin_ids, quote_asset, interval)

        # Fetch each pair's close series once, keyed by "coin:quote".
        series_by_key: dict[str, list[float]] = {}
        for cid in coins:
            closes = await self._fetch_closes(cid, quote_asset, interval)
            if len(closes) >= _MIN_TRAIN + _HORIZON:
                series_by_key[f"{cid}:{quote_asset}"] = closes
        if not series_by_key:
            return {}

        if grain == "pooled":
            # Deterministic series order — fold ids must mean the same
            # (series, origin) for every engine in the group.
            ordered_keys = sorted(series_by_key)
            if len(ordered_keys) > _MAX_POOLED_SERIES:
                stride = len(ordered_keys) / _MAX_POOLED_SERIES
                ordered_keys = [ordered_keys[int(i * stride)] for i in range(_MAX_POOLED_SERIES)]
            series_list = [series_by_key[k] for k in ordered_keys]
            scores = await self._score_engine_over_series(
                engine_enum, series_list, metric, season, params,
            )
            return {"__pooled__": scores}

        # Pair grain: cap to the highest-volume (longest-history) pairs.
        keys = sorted(series_by_key, key=lambda k: len(series_by_key[k]), reverse=True)
        if len(keys) > _MAX_KEYS:
            keys = keys[:_MAX_KEYS]
        out: dict[str, dict[str, float]] = {}
        for key in keys:
            out[key] = await self._score_engine_over_series(
                engine_enum, [series_by_key[key]], metric, season, params,
            )
        return out

    async def _score_engine_over_series(
        self,
        engine_enum: PredictionEngineEnum,
        series_list: list[list[float]],
        metric: MetricType,
        season: int,
        params: dict[str, str] | None = None,
    ) -> dict[str, float]:
        """Per-fold one-step errors for ONE engine across close series.

        Returns ``{fold_id: score}`` with ``fold_id = "{series_idx}:{origin_idx}"``.
        All origins of a series are forecast in a single batched engine call.
        """
        if not series_list:
            return {}
        engine = self.engine_registry.get_engine(engine_enum)
        if params:
            try:
                engine.apply_parameters({str(k): str(v) for k, v in params.items()})
            except Exception as e:
                logger.warning("apply_parameters failed for %s: %s", engine_enum.value, e)

        scores: dict[str, float] = {}
        for series_idx, values_list in enumerate(series_list):
            values = np.asarray(values_list, dtype=float)
            n = len(values)
            origins = self._build_origins(n, _HORIZON, _MAX_ORIGINS, _MIN_TRAIN)
            if not origins:
                continue

            # One item per origin — context = closes strictly before the origin.
            items: list[dict] = []
            for train_end, _ in origins:
                ctx = values[:train_end]
                hist = [
                    {"date": _ANCHOR + timedelta(days=j), "value": float(v)}
                    for j, v in enumerate(ctx)
                ]
                items.append({
                    "historical_data": hist,
                    "covariates": None,
                    "pad_dates": None,
                    # No covariates on klines; disables the residual-Ridge path
                    # (which at horizon=1 collapses the forecast onto prev close).
                    "covariate_handling": "none",
                })

            results: list = []
            for c in range(0, len(items), _CHUNK):
                chunk = items[c:c + _CHUNK]
                try:
                    batch = await engine.predict_batch(
                        chunk, horizon=_HORIZON, prediction_from=_ANCHOR,
                    )
                except Exception as e:
                    logger.warning("Engine %s failed in batch: %s", engine_enum.value, e)
                    batch = [None] * len(chunk)
                results.extend(batch)

            for origin_idx, ((train_end, test_end), res) in enumerate(zip(origins, results)):
                if not res:
                    continue
                pred = res[0].predicted_value
                if pred is None or not math.isfinite(float(pred)):
                    continue
                qv = res[0].quantiles
                actual = values[train_end:test_end]
                quantiles = (
                    np.asarray([qv], dtype=float) if qv else None
                )
                score = self._compute_metric(
                    actual, np.array([float(pred)]), metric,
                    scale_series=values[:train_end], quantiles=quantiles, season=season,
                )
                if math.isfinite(score):
                    scores[f"{series_idx}:{origin_idx}"] = score
        return scores

    # -- pure primitives (shared with the retail heritage; kept verbatim) ----

    @staticmethod
    def _build_origins(
        n: int, horizon: int, max_origins: int, min_train: int
    ) -> list[tuple[int, int]]:
        """Build rolling-origin (train_end, test_end) index pairs.

        Walks backward from the end in non-overlapping steps of ``horizon`` so
        each origin yields a distinct h-step-ahead test window, trained only on
        data preceding it. Returned earliest-origin-first.
        """
        origins: list[tuple[int, int]] = []
        test_end = n
        while test_end - horizon >= min_train and len(origins) < max_origins:
            train_end = test_end - horizon
            origins.append((train_end, test_end))
            test_end -= horizon
        origins.reverse()
        return origins

    def _compute_metric(
        self,
        actual: np.ndarray,
        predicted: np.ndarray,
        metric: MetricType,
        scale_series: np.ndarray | None = None,
        quantiles: np.ndarray | None = None,
        season: int = 1,
    ) -> float:
        """Compute error metric. Lower is better.

        ``quantiles`` is the (horizon × 9) forecast quantile matrix (crps only);
        ``season`` is the seasonal period for the smase denominator.
        """
        if len(actual) == 0:
            return float("inf")

        actual = np.asarray(actual, dtype=float)
        predicted = np.asarray(predicted, dtype=float)

        if metric in ("mase", "smase"):
            m = season if metric == "smase" else 1
            mae_naive = 1.0
            if scale_series is not None and len(scale_series) > 1:
                scale = np.asarray(scale_series, dtype=float)
                if m >= len(scale):
                    m = 1
                naive_errors = np.abs(scale[m:] - scale[:-m])
                if len(naive_errors) > 0:
                    mae_naive = float(np.mean(naive_errors))
            elif len(actual) > 1:
                mae_naive = float(np.mean(np.abs(np.diff(actual))))
            mae = float(np.mean(np.abs(actual - predicted)))
            return mae / max(mae_naive, 1e-10)

        elif metric == "crps":
            if quantiles is None or len(quantiles) < len(actual):
                q = np.tile(predicted.reshape(-1, 1), (1, len(QUANTILE_LEVELS)))
            else:
                q = np.asarray(quantiles, dtype=float)[: len(actual)]
            denom = float(np.mean(np.abs(actual)))
            if denom <= 1e-10:
                return float("inf")
            errors = actual.reshape(-1, 1) - q
            levels = np.asarray(QUANTILE_LEVELS, dtype=float).reshape(1, -1)
            pinball = np.where(errors >= 0, levels * errors, (levels - 1) * errors)
            return 2.0 * float(np.mean(pinball)) / denom

        elif metric == "mae":
            return float(np.mean(np.abs(actual - predicted)))

        elif metric == "mape":
            nonzero_mask = np.abs(actual) > 1e-10
            if np.any(nonzero_mask):
                mape = np.mean(
                    np.abs((actual[nonzero_mask] - predicted[nonzero_mask]) / actual[nonzero_mask])
                )
                return float(mape)
            return float("inf")

        elif metric == "rmse":
            return float(np.sqrt(np.mean((actual - predicted) ** 2)))

        raise ValueError(f"Unknown metric: {metric}")

    @staticmethod
    def _inverse_error_weights(avg_scores: dict[str, float]) -> dict[str, float]:
        """Convert per-engine errors to weights with ``w_i ∝ 1 / error_i``.

        A consistently more accurate engine (lower error) receives more weight.
        Engines that never produced a finite score get zero weight; if no engine
        scored, fall back to uniform weights.
        """
        finite = {s: v for s, v in avg_scores.items() if math.isfinite(v)}
        if not finite:
            n = len(avg_scores)
            return {s: 1.0 / n for s in avg_scores} if n else {}

        median_err = float(np.median(list(finite.values())))
        eps = 1e-6 * (1.0 + median_err)

        raw: dict[str, float] = {}
        for slug, score in avg_scores.items():
            raw[slug] = 1.0 / (score + eps) if math.isfinite(score) else 0.0

        total = sum(raw.values())
        if total <= 0:
            n = len(avg_scores)
            return {s: 1.0 / n for s in avg_scores} if n else {}
        return {slug: r / total for slug, r in raw.items()}
