"""Service for running AI model simulations on kline data."""

from datetime import UTC, datetime, date, timedelta
from typing import Awaitable, Callable
import math
import time
import structlog
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

# Callback signature: (progress 0-100, message) -> awaitable
ProgressCb = Callable[[int, str], Awaitable[None]]
# Returns True when the caller has requested a graceful stop.
StopCb = Callable[[], bool]
# Forecasts processed per batched engine call between progress updates. Smaller
# chunks give smoother progress at a negligible per-call overhead (the model is
# compiled once for the context size, then cached).
_CHUNK = 50

# TimesFM (and peers) emit quantiles at these deciles, increasing P10..P90.
_QUANTILE_LEVELS = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)


class VolForecastError(Exception):
    """A user-requested volatility forecast could not be produced.

    The user explicitly opted into ``forecast_vol``; rather than silently
    persist a no-vol run mislabeled "success" (which the backtest then quietly
    serves as a band-width proxy), this propagates to fail the whole run with a
    visible reason.
    """


class ModelDegradedError(Exception):
    """The requested model could not run and the engine fell back to another.

    ``is_available()`` only checks that the backing library imports; the model
    weights load lazily at first predict, so a load failure (missing/uncached
    weights, OOM) slips past that gate and the engine silently degrades to the
    statistical fallback — which produces point forecasts with no quantile
    bands, so the backtest can't run. Rather than persist that as "success",
    this propagates to mark the run "degraded" with a visible reason.
    """


def _fmt_eta(seconds: float) -> str:
    """Compact time-remaining: '45s', '12m', '1h 05m'."""
    s = max(0, int(seconds))
    if s < 90:
        return f"{s}s"
    if s < 5400:
        return f"{(s + 30) // 60}m"
    return f"{s // 3600}h {(s % 3600) // 60:02d}m"


def _prob_up_from_quantiles(prev_close: float | None, quantiles: list[float] | None) -> float | None:
    """Modeled probability the next close exceeds the last observed close.

    Locate prev_close within the predicted quantile ladder to read off the CDF
    F(prev_close); the up-probability is 1 - F. Resolution is limited to the
    deciles, so the result is effectively clamped to [0.1, 0.9].
    """
    if prev_close is None or not quantiles or len(quantiles) < 2:
        return None
    q = quantiles
    levels = _QUANTILE_LEVELS
    if prev_close <= q[0]:
        cdf = levels[0]
    elif prev_close >= q[-1]:
        cdf = levels[-1]
    else:
        cdf = levels[-1]
        for i in range(1, len(q)):
            if prev_close <= q[i]:
                lo_q, hi_q = q[i - 1], q[i]
                lo_l, hi_l = levels[i - 1], levels[i]
                cdf = hi_l if hi_q == lo_q else lo_l + (prev_close - lo_q) / (hi_q - lo_q) * (hi_l - lo_l)
                break
    return max(0.0, min(1.0, 1.0 - cdf))

from crypto_ai.database.models.kline import Kline
from crypto_ai.database.models.prediction_engine import PredictionEngine as PredictionEngineModel
from crypto_ai.database.models.prediction_engine_parameter import PredictionEngineParameter
from crypto_ai.prediction.registry import EngineRegistry
from crypto_ai.schemas.prediction import PredictionEngine as PredictionEngineEnum

log = structlog.get_logger()


class KlineSimulationService:
    """Service for simulating AI models on kline price data."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.engine_registry = EngineRegistry()

    async def run_simulation(
        self,
        coin_id: str,
        quote_asset: str,
        interval: str,
        start_date: date,
        end_date: date,
        model_names: list[str],
        on_progress: ProgressCb | None = None,
        should_stop: StopCb | None = None,
        include_full_predictions: bool = False,
        forecast_vol: bool = False,
        strategy: str = "price",
        parameters: dict | None = None,
        horizon: int = 1,
        covariate_mode: str = "off",
    ) -> dict:
        """Run simulation of AI models on kline data.

        Args:
            coin_id: The coin to simulate
            quote_asset: Quote asset (e.g., USDT)
            interval: Timeframe (e.g., 1h, 15m, 1d)
            start_date: Start date for simulation
            end_date: End date for simulation
            model_names: List of model names to test
            horizon: Bars per forecast step. 1 = classic next-bar walk-forward.
                H>1 scores the model on H-bar-ahead moves over consecutive
                NON-overlapping windows — "call the local trend, forgive the
                wiggles" — which is statistically easier when any drift exists
                (signal grows ~H, noise ~sqrt(H)). Price strategy only.
            covariate_mode: How the swing-signal series (volume/range/trade
                z-scores, taker tilt, streak, stretch, wicks) reach the model.
                "off": not at all. "native": through the engine's real
                model-side covariate API — only TimesFM/Chronos-2 qualify (the
                shared per-window residual-Ridge fallback degenerates at
                horizon 1, so other engines are refused up-front). "external":
                a trailing Ridge fitted on the walk-forward's OWN pooled
                (signals → next-step residual) history — strictly past-only,
                refit periodically — applied on top of the engine's plain
                forecasts, so it works with EVERY engine.

        Returns:
            Dictionary with simulation results for each model
        """
        start_time = time.time()

        if covariate_mode not in ("off", "native", "external"):
            raise ValueError(f"Unknown covariate_mode: {covariate_mode}")

        # Fail fast if any requested engine isn't installed on this server. We
        # refuse to run rather than let an engine silently fall back to the
        # statistical engine (which produces no quantiles, breaking the backtest).
        for model_name in model_names:
            # An "orch:<group_id>" token is a calibrated orchestration group run
            # as a single blended model. Refuse a non-ready group (its empty
            # composition would silently degrade to nothing) and require every
            # member engine to be installed here.
            if model_name.startswith("orch:"):
                # External covariates adjust the blended output post-hoc, so
                # they compose with orchestration; native cannot (member
                # engines blend through the residual-Ridge path, which
                # degenerates at horizon 1).
                if covariate_mode == "native":
                    raise ValueError(
                        "Native signal covariates are not supported for orchestration "
                        "groups. Use covariate mode 'external' (works with any model), "
                        "or run a single native-covariate model (timesfm, chronos2)."
                    )
                group = await self._resolve_orch_group(model_name)
                for slug in (group.model_composition or {}).keys():
                    enum = self._get_engine_enum(slug)
                    if not enum or not self.engine_registry.get_engine(enum).is_available():
                        raise ValueError(
                            f"Orchestration group '{group.name}' includes model '{slug}', "
                            "which is not installed on this server. Run the simulation on a "
                            "worker that carries every member model."
                        )
                continue
            engine_enum = self._get_engine_enum(model_name)
            if not engine_enum:
                raise ValueError(f"Unknown model: {model_name}")
            if not self.engine_registry.get_engine(engine_enum).is_available():
                raise ValueError(
                    f"Engine '{model_name}' is not installed on this server, so the "
                    "simulation was not run. Pick a model that's installed."
                )
            engine_obj = self.engine_registry.get_engine(engine_enum)
            if covariate_mode == "native" and not engine_obj.supports_native_covariates:
                raise ValueError(
                    f"Engine '{model_name}' has no native covariate API — its fallback "
                    "(residual Ridge) degenerates at horizon 1 and would corrupt the "
                    "forecast. Use a native-covariate model (timesfm, chronos2), or "
                    "switch the strategy's covariate mode to 'external', which works "
                    "with any engine."
                )

        # Fetch kline data for the date range
        # Convert dates to datetime at start and end of day in UTC
        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=UTC)
        end_dt = datetime.combine(end_date, datetime.max.time(), tzinfo=UTC)

        # Walk-forward backtest: each kline inside [start_dt, end_dt] is forecast
        # one step ahead using only the history that precedes it. We therefore
        # fetch ALL klines up to end_dt — including data BEFORE start_dt — so the
        # first simulated point has real prior context.
        stmt = select(Kline).where(
            and_(
                Kline.coin_id == coin_id,
                Kline.quote_asset == quote_asset,
                Kline.interval == interval,
                Kline.open_time <= end_dt,
                Kline.active.is_(True),
            )
        ).order_by(Kline.open_time)

        result = await self.session.execute(stmt)
        klines = result.scalars().all()
        fetch_time = time.time() - start_time

        # Raise (rather than return an error dict) so the task layer marks the
        # run "failure" with the message on the error column — a returned dict
        # would be persisted as a "success" whose error is buried in the result.
        if not klines:
            raise RuntimeError("No kline data found up to the specified end date")

        # First index inside the requested simulation window; everything before
        # it is available as historical context.
        sim_start_idx = next(
            (i for i, k in enumerate(klines) if k.open_time >= start_dt),
            len(klines),
        )
        sim_count = len(klines) - sim_start_idx

        if sim_count < 1:
            raise RuntimeError("No kline data found within the simulation date range")

        # Run each model and collect results
        results = {
            "coin_id": coin_id,
            "quote_asset": quote_asset,
            "interval": interval,
            "date_range": {"start": str(start_date), "end": str(end_date)},
            "data_points": len(klines),
            "history_points": sim_start_idx,
            "train_points": sim_start_idx,  # context available before the window
            "test_points": sim_count,  # points forecast one-step-ahead
            "timing": {"data_fetch_sec": round(fetch_time, 3)},
            "models": {},
        }

        # Forecasting volatility roughly doubles the per-model work (a second
        # one-step walk-forward over the realized-vol series). Not used for the
        # kline (binary up/down) strategy.
        vol_on = forecast_vol and strategy != "kline"
        # Horizon only applies to the price path; H>1 steps in non-overlapping
        # windows, so the number of forecasts shrinks by ~H.
        horizon = max(1, int(horizon)) if strategy != "kline" else 1
        results["horizon"] = horizon
        results["covariate_mode"] = covariate_mode
        # Legacy boolean the UI's older runs used; kept for display back-compat.
        results["use_covariates"] = covariate_mode != "off"
        per_model_work = max(1, sim_count // horizon) * (2 if vol_on else 1)
        total_work = max(1, len(model_names) * per_model_work)
        for model_idx, model_name in enumerate(model_names):
            done_base = model_idx * per_model_work
            model_start = time.time()

            async def _model_cb(
                done: int, total: int,
                mname: str = model_name, base: int = done_base, t0: float = model_start,
            ) -> None:
                if on_progress is None:
                    return
                pct = min(99, int((base + done) / total_work * 100))
                if done <= 0:
                    # Fired before the first batch: large-context models on CPU
                    # can take many minutes per batch, so make it visible that
                    # inference has started (vs sitting on "Loading klines…").
                    msg = f"{mname}: starting {total} forecasts…"
                else:
                    remaining = (time.time() - t0) / done * (total - done)
                    msg = f"{mname}: {done}/{total} forecasts · ~{_fmt_eta(remaining)} left"
                await on_progress(pct, msg)

            # An orchestration group runs as a blended engine over its calibrated
            # members; its per-model params are baked into the BlendingEngine, so
            # no catalog/strategy params are applied here.
            if model_name.startswith("orch:"):
                try:
                    group = await self._resolve_orch_group(model_name)
                    blend_engine = self._build_blending_engine(group)
                    model_result = await self._run_model_simulation(
                        model_name, klines, sim_start_idx,
                        on_progress=_model_cb, should_stop=should_stop,
                        include_full_predictions=include_full_predictions,
                        forecast_vol=vol_on,
                        engine_override=blend_engine,
                        blend_key=f"{coin_id}:{quote_asset}",
                        horizon=horizon,
                        covariate_mode=covariate_mode,
                    )
                    results["models"][model_name] = model_result
                except (VolForecastError, ModelDegradedError):
                    raise
                except Exception as e:
                    log.error(f"Error running orchestration model {model_name}: {e}")
                    results["models"][model_name] = {"error": str(e)}
                if should_stop is not None and should_stop():
                    results["stopped"] = True
                    break
                continue

            # Effective params: the engine's own selected catalog params form the
            # base; the strategy's params (passed in) override on name conflicts.
            engine_params = await self._engine_catalog_params(model_name)
            effective_params = {**engine_params, **(parameters or {})}

            try:
                if strategy == "kline":
                    model_result = await self._run_kline_strategy(
                        model_name, klines, sim_start_idx,
                        on_progress=_model_cb, should_stop=should_stop,
                        include_full_predictions=include_full_predictions,
                        parameters=effective_params,
                    )
                else:
                    model_result = await self._run_model_simulation(
                        model_name, klines, sim_start_idx,
                        on_progress=_model_cb, should_stop=should_stop,
                        include_full_predictions=include_full_predictions,
                        forecast_vol=vol_on,
                        parameters=effective_params,
                        horizon=horizon,
                        covariate_mode=covariate_mode,
                    )
                results["models"][model_name] = model_result
            except (VolForecastError, ModelDegradedError):
                # Vol forecast failed, or the engine silently degraded to a
                # fallback. Fail the whole run with a visible reason rather than
                # storing a "success" that isn't what was requested.
                raise
            except Exception as e:
                log.error(f"Error running model {model_name}: {e}")
                results["models"][model_name] = {"error": str(e)}

            if should_stop is not None and should_stop():
                results["stopped"] = True
                break

        # If every requested model failed (and the run wasn't gracefully
        # stopped mid-way), surface it as a failed run rather than a "success"
        # whose per-model errors are buried in the analysis tab. The task layer
        # maps this exception to status="failure" with the message on the
        # top-level error column, which is what the Error tab reads.
        if not results.get("stopped"):
            model_results = results["models"]
            errored = {
                name: r["error"]
                for name, r in model_results.items()
                if isinstance(r, dict) and r.get("error")
            }
            if model_results and len(errored) == len(model_results):
                if len(errored) == 1:
                    raise RuntimeError(next(iter(errored.values())))
                joined = "; ".join(f"{name}: {err}" for name, err in errored.items())
                raise RuntimeError(f"All models failed — {joined}")

        # Run-level scores = the best model's skill, so the master table can
        # rank a whole simulation by its most promising model. Price and vol
        # are SEPARATE columns (they're different, incomparable metrics):
        # score/score_t = directional return IC (every run computes it);
        # score_vol/score_vol_t = vol-forecast corr (only forecast_vol runs).
        def _best(key: str) -> float | None:
            vals = [
                m[key]
                for m in results["models"].values()
                if isinstance(m, dict) and isinstance(m.get(key), (int, float))
            ]
            return max(vals) if vals else None

        results["score"] = _best("score")
        results["score_t"] = _best("score_t")
        results["score_vol"] = _best("score_vol")
        results["score_vol_t"] = _best("score_vol_t")

        total_time = time.time() - start_time
        model_time = total_time - fetch_time
        results["timing"]["model_analysis_sec"] = round(model_time, 3)
        results["timing"]["total_sec"] = round(total_time, 3)

        log.info(f"Simulation completed in {total_time:.2f}s (fetch: {fetch_time:.2f}s, models: {model_time:.2f}s)")

        return results

    async def _engine_catalog_params(self, model_name: str) -> dict[str, str]:
        """The engine's own selected catalog parameters (name→value), keyed by slug.

        These are the defaults set on the model itself (the ai-models page); a
        strategy's parameters override them at run time.
        """
        engine = (
            await self.session.execute(
                select(PredictionEngineModel).where(
                    PredictionEngineModel.slug == model_name,
                    PredictionEngineModel.active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if not engine:
            return {}
        rows = (
            await self.session.execute(
                select(PredictionEngineParameter).where(
                    PredictionEngineParameter.prediction_engine_id == engine.id,
                    PredictionEngineParameter.prediction_strategy_id.is_(None),
                    PredictionEngineParameter.active.is_(True),
                    PredictionEngineParameter.selected.is_(True),
                )
            )
        ).scalars().all()
        return {p.name: p.value for p in rows}

    async def _run_model_simulation(
        self,
        model_name: str,
        klines: list,
        sim_start_idx: int,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
        should_stop: StopCb | None = None,
        include_full_predictions: bool = False,
        forecast_vol: bool = False,
        parameters: dict | None = None,
        engine_override=None,
        blend_key: str | None = None,
        horizon: int = 1,
        covariate_mode: str = "off",
    ) -> dict:
        """Walk-forward backtest for a single model.

        With ``horizon=1`` (default): every kline at index ``gi >=
        sim_start_idx`` is forecast one step ahead using only the closes that
        precede it (capped at the engine's max context), then compared to the
        actual. With ``horizon=H>1``: origins step in NON-overlapping H-bar
        windows; each forecast targets the close H bars ahead and is scored on
        the H-bar move — the "local trend" rather than the next wiggle.
        Overlap is avoided so each scored row is an independent period and the
        fee-aware backtest's per-row returns compound correctly.

        ``engine_override`` runs a pre-built engine (e.g. a BlendingEngine for an
        orchestration group) instead of resolving one from the model slug;
        ``blend_key`` is stamped on each item so a BlendingEngine can pick the
        right per-pair weight vector.
        """
        try:
            if engine_override is not None:
                engine = engine_override
                engine_enum = None
            else:
                engine_enum = self._get_engine_enum(model_name)
                if not engine_enum:
                    return {"error": f"Unknown model: {model_name}"}

                try:
                    engine = self.engine_registry.get_engine(engine_enum)
                except ValueError as e:
                    return {"error": f"Model {model_name} not available: {str(e)}"}

                if parameters:
                    try:
                        engine.apply_parameters({str(k): str(v) for k, v in parameters.items()})
                    except Exception as e:
                        log.warning(f"apply_parameters failed for {model_name}: {e}")

                # Point a fine-tuned engine at this coin/pair/timeframe's checkpoint.
                self._configure_finetuned_engine(engine, klines)

            capabilities = engine.get_capabilities()
            ctx_len = capabilities.max_history_length or 1024
            min_hist = max(2, capabilities.min_history_length)
            # Optional strategy parameter capping the per-forecast context. The
            # engine default can be enormous (Chronos-2: 8192 bars), which on
            # CPU makes each forecast 10x+ slower for marginal accuracy — e.g.
            # context_length=1024 of 4h bars is still ~half a year of history.
            ctx_param = (parameters or {}).get("context_length")
            if ctx_param:
                try:
                    ctx_len = max(min_hist, min(ctx_len, int(float(ctx_param))))
                except (TypeError, ValueError):
                    log.warning(f"Ignoring invalid context_length parameter: {ctx_param!r}")

            closes = [float(k.close) for k in klines]
            n = len(klines)

            # Per-bar realized range-volatility (Parkinson-style): ln(high/low).
            # A clean, non-overlapping, strictly-positive vol proxy from OHLC.
            def _range_vol(k) -> float:
                h = float(k.high); lo = float(k.low)
                return math.log(h / lo) if (h > 0 and lo > 0 and h >= lo) else 0.0
            rv = [_range_vol(k) for k in klines]

            def _real_dt(k) -> datetime:
                return (
                    k.open_time
                    if isinstance(k.open_time, datetime)
                    else datetime.fromtimestamp(k.open_time / 1000, tz=UTC)
                )

            # The engines/preprocessor are date-keyed and SUM values sharing a
            # date. Intraday klines must therefore be fed with unique, ordered
            # date keys — we use a synthetic daily index per context window
            # purely to preserve order; these zero-shot models forecast the
            # value sequence, not the calendar.
            base_date = date(2000, 1, 1)

            # ``usable_idx`` holds forecast ORIGINS (first bar of each window);
            # the scored bar is the window's last bar, origin + horizon - 1.
            # Only the indices are collected here — the per-bar context items
            # are materialized lazily per chunk below. Building them all
            # up-front is O(bars x context) dicts (a year of 5m bars with a
            # 4096-value context is tens of GB) and has OOM-killed the worker.
            horizon = max(1, int(horizon))
            usable_idx: list[int] = [
                gi for gi in range(sim_start_idx, n - horizon + 1, horizon)
                if min(gi, ctx_len) >= min_hist  # bars of prior history available
            ]

            # Swing-signal covariates (volume/range/trade z-scores, taker tilt,
            # streak, stretch, wicks). "native": fed through the engine's real
            # model-side covariate API (gated in run_simulation). "external":
            # consumed AFTER the walk-forward by the trailing-Ridge adjustment.
            # These are past-only series — the forecast window's value is the
            # last observed one (lagged), which is exact at horizon 1.
            cov_series: dict | None = None
            if covariate_mode != "off":
                import numpy as np

                from crypto_ai.services.swing_analysis import signal_covariate_series

                cov_series = signal_covariate_series(
                    np.array([float(k.open) for k in klines]),
                    np.array([float(k.high) for k in klines]),
                    np.array([float(k.low) for k in klines]),
                    np.array(closes),
                    np.array([float(k.volume) for k in klines]),
                    np.array([float(k.number_of_trades) for k in klines]),
                    np.array([float(k.taker_buy_base_asset_volume) for k in klines]),
                )
                cov_series = {
                    name: np.nan_to_num(arr, nan=0.0) for name, arr in cov_series.items()
                }

            def _make_item(gi: int) -> dict:
                lo = max(0, gi - ctx_len)
                ctx = closes[lo:gi]
                hist = [
                    {"date": base_date + timedelta(days=j), "value": v}
                    for j, v in enumerate(ctx)
                ]
                # Without covariates: covariate_handling="none" disables the
                # engines' residual-Ridge adjustment, which at horizon=1 fits on
                # a single residual point and collapses the point forecast onto
                # the last close (predicted == prev_close, direction always 0).
                # With covariates: handling="native" (real model-side API only —
                # gated upstream) and active_covariate_types={2} so the engine
                # adds ONLY these date-keyed features (no weekday one-hots or
                # PAD, meaningless on the synthetic daily index).
                item = {
                    "historical_data": hist,
                    "covariates": None,
                    "pad_dates": None,
                    "covariate_handling": "none",
                }
                if cov_series is not None and covariate_mode == "native":
                    n_ctx = len(ctx)
                    item["covariates"] = {
                        name: {
                            **{
                                base_date + timedelta(days=j): float(arr[lo + j])
                                for j in range(n_ctx)
                            },
                            # Forecast window: last observed value, lagged.
                            **{
                                base_date + timedelta(days=n_ctx + k): float(arr[gi - 1])
                                for k in range(horizon)
                            },
                        }
                        for name, arr in cov_series.items()
                    }
                    item["covariate_handling"] = "native"
                    item["active_covariate_types"] = {2}
                if blend_key is not None:
                    item["_blend_key"] = blend_key
                return item

            if not usable_idx:
                return {
                    "error": (
                        f"Insufficient history: need at least {min_hist} points "
                        "before the simulation range"
                    )
                }

            total = len(usable_idx)
            total_steps = total * (2 if forecast_vol else 1)
            log.info(
                f"Walk-forward {model_name}: {total} forecasts at horizon {horizon} "
                f"(context<= {ctx_len}){' +volatility' if forecast_vol else ''}"
            )
            if on_progress is not None:
                # Announce inference start — the first batch can take minutes
                # on CPU and would otherwise leave the task on "Loading klines…".
                await on_progress(0, total_steps)

            # Process in chunks so progress can be reported and a graceful stop
            # honoured between batched engine calls. Each item is an independent
            # forecast; contexts are built (and freed) one chunk at a time so
            # memory stays O(chunk x context) regardless of the date range.
            predictions: list[float] = []
            step_quantiles: list[list[float] | None] = []
            stopped = False
            for c in range(0, total, _CHUNK):
                chunk = [_make_item(gi) for gi in usable_idx[c:c + _CHUNK]]
                try:
                    batch_results = await engine.predict_batch(
                        chunk, horizon=horizon, prediction_from=base_date
                    )
                except Exception as e:
                    log.error(f"Engine prediction failed: {e}", exc_info=True)
                    return {"error": f"Prediction failed: {str(e)}"}

                for res in batch_results:
                    # Score the window's LAST step (the H-bar-ahead forecast);
                    # at horizon=1 this is the familiar next-bar step.
                    step = res[min(horizon, len(res)) - 1] if res else None
                    q = step.quantiles if (step and step.quantiles) else None
                    if step and step.predicted_value is not None:
                        predictions.append(float(step.predicted_value))
                    elif q and len(q) >= 5:
                        predictions.append(float(q[4]))
                    else:
                        # A 0.0 stand-in would score as an extreme "down" call
                        # and silently corrupt every metric — fail instead.
                        return {"error": "Engine returned no forecast (no point value or quantiles) for a bar"}
                    step_quantiles.append([float(x) for x in q] if q else None)

                if on_progress is not None:
                    await on_progress(len(predictions), total_steps)
                if should_stop is not None and should_stop():
                    stopped = True
                    break

            # On a graceful stop, only score the points we actually forecast.
            scored = len(predictions)
            usable_idx = usable_idx[:scored]
            step_quantiles = step_quantiles[:scored]

            # Scored bar = the window's last bar; the move is measured from the
            # last close known at forecast time (the bar before the origin).
            target_idx = [gi + horizon - 1 for gi in usable_idx]
            actuals = [closes[ti] for ti in target_idx]
            prev_closes = [closes[gi - 1] for gi in usable_idx]
            times = [_real_dt(klines[ti]) for ti in target_idx]

            # The engine has now loaded and run. If it degraded to a fallback
            # algorithm (weights couldn't load — past the import-only pre-run
            # gate), fail the run instead of persisting a fallback forecast that
            # has no quantile bands and can't be backtested.
            self._guard_not_degraded(engine, model_name)

            # External covariate mode: adjust the engine's plain forecasts with
            # a trailing Ridge fitted on this run's own past (signals → next-step
            # residual) pairs. Strictly causal — each bar is adjusted using only
            # residuals whose target bar closed before that bar's forecast
            # origin. Mutates predictions/step_quantiles in place.
            ext_cov_info: dict | None = None
            if covariate_mode == "external" and cov_series is not None and predictions:
                ext_cov_info = self._external_covariate_adjust(
                    predictions, step_quantiles, actuals, prev_closes,
                    usable_idx, cov_series, parameters,
                )

            # Genuine volatility forecast: a SECOND one-step walk-forward, this
            # time over the realized range-vol series, on the same scored bars.
            pred_vol_list: list[float | None] = [None] * len(usable_idx)
            realized_vol_list: list[float | None] = [None] * len(usable_idx)
            vol_metrics = None
            if forecast_vol and usable_idx and not stopped:
                try:
                    vol_preds = await self._predict_series(
                        engine, rv, usable_idx, ctx_len, min_hist, base_date,
                        should_stop=should_stop, on_progress=on_progress,
                        done_offset=total, total_steps=total_steps,
                        horizon=horizon,
                    )
                except Exception as e:
                    log.error(f"Volatility forecast failed: {e}", exc_info=True)
                    raise VolForecastError(f"Volatility forecast failed: {e}") from e
                # A graceful user stop can legitimately cut the vol series short;
                # any other shortfall means the forecast didn't complete and must
                # not pass as a finished run with NULL pred_vol.
                vol_stopped = should_stop is not None and should_stop()
                if not vol_stopped and len(vol_preds) < len(usable_idx):
                    raise VolForecastError(
                        f"Volatility forecast incomplete: {len(vol_preds)} of "
                        f"{len(usable_idx)} bars forecast"
                    )
                for i in range(len(usable_idx)):
                    realized_vol_list[i] = rv[target_idx[i]]
                    if i < len(vol_preds):
                        pred_vol_list[i] = max(0.0, vol_preds[i])
                k = len(vol_preds)
                vol_metrics = self._vol_metrics(realized_vol_list[:k], pred_vol_list[:k])

            metrics = self._walk_forward_metrics(actuals, predictions, prev_closes)
            predictions_sample = self._analyze_predictions(times, actuals, predictions)

            model_result = {
                "status": "stopped" if stopped else "success",
                "metrics": metrics,
                "score": self._model_score(metrics),
                "score_t": self._model_score_t(metrics),
                "horizon": horizon,
                "covariate_mode": covariate_mode,
                # Legacy boolean older UI builds read; True for either mode.
                "use_covariates": covariate_mode != "off",
                "test_count": len(actuals),
                "engine": engine.__class__.__name__,
                "actual_engine": engine.get_actual_slug() or (engine_enum.value if engine_enum else model_name),
                "context_length": ctx_len,
                "predictions_sample": predictions_sample,
            }
            if ext_cov_info is not None:
                model_result["external_covariates"] = ext_cov_info
            if vol_metrics is not None:
                model_result["vol_metrics"] = vol_metrics
                # Vol skill is its own column — never merged with the price
                # score, so sorting each column compares like with like.
                if vol_metrics.get("corr") is not None:
                    model_result["score_vol"] = round(float(vol_metrics["corr"]), 4)
                if vol_metrics.get("corr_t") is not None:
                    model_result["score_vol_t"] = round(float(vol_metrics["corr_t"]), 2)

            # Full per-timestamp rows for durable persistence (stripped from the
            # stored result JSON by the caller). Only built when requested.
            if include_full_predictions:
                rows = []
                for i, (t, a, p, prev, q) in enumerate(zip(times, actuals, predictions, prev_closes, step_quantiles)):
                    rows.append({
                        "timestamp": t.isoformat(),
                        "actual": a,
                        "predicted": p,
                        "error": a - p,
                        "pct_error": abs(a - p) / a * 100 if a else 0.0,
                        "prev_close": prev,
                        "quantiles": q,
                        # Modeled P(next close > last observed close).
                        "prob_up": _prob_up_from_quantiles(prev, q),
                        # Did the actual land inside the model's 80% band [P10, P90]?
                        "in_interval": (q[0] <= a <= q[-1]) if q else None,
                        # Genuine one-step volatility forecast vs realized (or None).
                        "pred_vol": pred_vol_list[i],
                        "realized_vol": realized_vol_list[i],
                    })
                model_result["_predictions"] = rows

            return model_result
        except (VolForecastError, ModelDegradedError):
            raise  # fail the whole run, not a model-level error dict
        except Exception as e:
            log.error(f"Error in model simulation: {e}", exc_info=True)
            return {"error": str(e)}

    async def _run_kline_strategy(
        self,
        model_name: str,
        klines: list,
        sim_start_idx: int,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
        should_stop: StopCb | None = None,
        include_full_predictions: bool = False,
        parameters: dict | None = None,
    ) -> dict:
        """Forecast the bar's SHAPE, not its price.

        The chart is reduced to a binary up/down sequence — 1 if the close rose
        vs the previous bar, else 0 (…0011010111…) — and the model forecasts the
        next symbol from the preceding ones. The forecast (a value in [0,1]) is
        the modeled probability the next bar is up; the call is "up" when it's
        ≥ 0.5. We keep the real prices so direction accuracy and the fee-aware
        backtest still work; price-error metrics (MAE/MAPE/…) are not meaningful
        here and should be read as direction accuracy instead.
        """
        try:
            engine_enum = self._get_engine_enum(model_name)
            if not engine_enum:
                return {"error": f"Unknown model: {model_name}"}
            try:
                engine = self.engine_registry.get_engine(engine_enum)
            except ValueError as e:
                return {"error": f"Model {model_name} not available: {str(e)}"}

            if parameters:
                try:
                    engine.apply_parameters({str(k): str(v) for k, v in parameters.items()})
                except Exception as e:
                    log.warning(f"apply_parameters failed for {model_name}: {e}")

            # Point a fine-tuned engine at this coin/pair/timeframe's checkpoint.
            self._configure_finetuned_engine(engine, klines)

            capabilities = engine.get_capabilities()
            ctx_len = capabilities.max_history_length or 1024
            min_hist = max(2, capabilities.min_history_length)

            closes = [float(k.close) for k in klines]
            n = len(klines)

            def _real_dt(k) -> datetime:
                return (
                    k.open_time
                    if isinstance(k.open_time, datetime)
                    else datetime.fromtimestamp(k.open_time / 1000, tz=UTC)
                )

            base_date = date(2000, 1, 1)

            # Binary up/down series: 1 if the close rose vs the previous bar.
            updown = [0.0] * n
            for i in range(1, n):
                updown[i] = 1.0 if closes[i] > closes[i - 1] else 0.0

            # Same usability rule as the price path: need >= min_hist of prior
            # (binary) history, and a previous close to compare against.
            usable_idx = [
                gi for gi in range(max(sim_start_idx, 1), n)
                if len(updown[max(0, gi - ctx_len):gi]) >= min_hist
            ]
            if not usable_idx:
                return {
                    "error": (
                        f"Insufficient history: need at least {min_hist} bars "
                        "before the simulation range"
                    )
                }

            total = len(usable_idx)
            log.info(f"Kline (up/down) forecast {model_name}: {total} one-step forecasts")

            f = await self._predict_series(
                engine, updown, usable_idx, ctx_len, min_hist, base_date,
                should_stop=should_stop, on_progress=on_progress,
                done_offset=0, total_steps=total,
            )
            scored = len(f)
            stopped = scored < total
            usable_idx = usable_idx[:scored]
            f = [min(1.0, max(0.0, x)) for x in f]

            actuals = [closes[gi] for gi in usable_idx]
            prev_closes = [closes[gi - 1] for gi in usable_idx]
            times = [_real_dt(klines[gi]) for gi in usable_idx]

            # Fail rather than persist a silently-degraded fallback forecast.
            self._guard_not_degraded(engine, model_name)

            # Encode the directional call as a tiny synthetic "price" so the
            # existing direction columns and backtest light up: above prev when
            # the model leans up (f>0.5), below when it leans down.
            _edge = 0.02
            predictions = [prev_closes[i] * (1 + (f[i] - 0.5) * _edge) for i in range(scored)]

            metrics = self._walk_forward_metrics(actuals, predictions, prev_closes)
            model_result = {
                "status": "stopped" if stopped else "success",
                "metrics": metrics,
                "score": self._model_score(metrics),
                "score_t": self._model_score_t(metrics),
                "test_count": len(actuals),
                "engine": engine.__class__.__name__,
                "actual_engine": engine.get_actual_slug() or (engine_enum.value if engine_enum else model_name),
                "context_length": ctx_len,
                "predictions_sample": self._analyze_predictions(times, actuals, predictions),
                "kline_strategy": True,
            }

            if include_full_predictions:
                rows = []
                for i, (t, a, p, prev) in enumerate(zip(times, actuals, predictions, prev_closes)):
                    rows.append({
                        "timestamp": t.isoformat(),
                        "actual": a,
                        "predicted": p,
                        "error": a - p,
                        "pct_error": abs(a - p) / a * 100 if a else 0.0,
                        "prev_close": prev,
                        "quantiles": None,
                        # The model's forecasted probability the next bar is up.
                        "prob_up": f[i],
                        "in_interval": None,
                        "pred_vol": None,
                        "realized_vol": None,
                    })
                model_result["_predictions"] = rows

            return model_result
        except ModelDegradedError:
            raise  # fail the whole run, not a model-level error dict
        except Exception as e:
            log.error(f"Error in kline strategy: {e}", exc_info=True)
            return {"error": str(e)}

    async def _predict_series(
        self,
        engine,
        values: list[float],
        idxs: list[int],
        ctx_len: int,
        min_hist: int,
        base_date: date,
        should_stop: StopCb | None = None,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
        done_offset: int = 0,
        total_steps: int = 0,
        horizon: int = 1,
    ) -> list[float]:
        """Walk-forward over an arbitrary value series.

        For each ORIGIN index gi in ``idxs`` forecast ``horizon`` steps from the
        preceding ``ctx_len`` values and return the last step's point forecast
        (the value at gi + horizon - 1). Used for the volatility series; mirrors
        the price loop but returns plain point forecasts.
        """
        horizon = max(1, int(horizon))

        # Contexts are materialized lazily per chunk — building every item
        # up-front is O(bars x context) memory and has OOM-killed the worker
        # on long ranges / short timeframes.
        def _make_item(gi: int) -> dict:
            ctx = values[max(0, gi - ctx_len):gi]
            hist = [
                {"date": base_date + timedelta(days=j), "value": v}
                for j, v in enumerate(ctx)
            ]
            # See _run_model_simulation: disable the residual-Ridge covariate
            # adjustment, which at horizon=1 pins the forecast to the last value.
            return {
                "historical_data": hist,
                "covariates": None,
                "pad_dates": None,
                "covariate_handling": "none",
            }

        preds: list[float] = []
        if on_progress is not None:
            await on_progress(done_offset, total_steps)  # announce series start
        for c in range(0, len(idxs), _CHUNK):
            chunk = [_make_item(gi) for gi in idxs[c:c + _CHUNK]]
            batch_results = await engine.predict_batch(
                chunk, horizon=horizon, prediction_from=base_date
            )
            for res in batch_results:
                step = res[min(horizon, len(res)) - 1] if res else None
                q = step.quantiles if (step and step.quantiles) else None
                if step and step.predicted_value is not None:
                    preds.append(float(step.predicted_value))
                elif q and len(q) >= 5:
                    preds.append(float(q[4]))
                else:
                    raise RuntimeError(
                        "Engine returned no forecast (no point value or quantiles) for a bar"
                    )
            if on_progress is not None:
                await on_progress(done_offset + len(preds), total_steps)
            if should_stop is not None and should_stop():
                break
        return preds

    @staticmethod
    def _external_covariate_adjust(
        predictions: list[float],
        step_quantiles: list[list[float] | None],
        actuals: list[float],
        prev_closes: list[float],
        usable_idx: list[int],
        cov_series: dict,
        parameters: dict | None,
    ) -> dict:
        """Trailing-Ridge covariate adjustment over the walk-forward's own history.

        For each scored bar i, a Ridge maps the swing-signal values at the last
        OBSERVED bar (origin - 1) to the engine's residual return ((actual -
        predicted) / prev_close), fitted on the pooled pairs of all EARLIER
        scored bars — whose target bars closed before bar i's origin, so the
        fit is strictly causal. This is the mechanism that made external
        covariate handling win in gorm: pooling across windows gives it
        hundreds-to-thousands of samples where the per-window fit (and a native
        API's single context) has a handful. It runs on top of plain forecasts,
        so it works with every engine, orchestration groups included.

        The forecast and its quantile band are shifted by the predicted
        residual (in price units). Mutates ``predictions`` and
        ``step_quantiles`` in place and returns a diagnostics dict.

        Strategy-parameter knobs (all optional):
          cov_window: trailing fit window in scored bars (0/absent = expanding)
          cov_alpha:  Ridge penalty on standardized features (default 1.0)
          cov_warmup: bars left unadjusted while history accumulates (default 50)
          cov_refit:  refit cadence in bars (default 50)
        """
        import numpy as np

        def _param(name: str, default: float) -> float:
            try:
                return float((parameters or {}).get(name, default))
            except (TypeError, ValueError):
                return default

        alpha = max(1e-6, _param("cov_alpha", 1.0))
        window = max(0, int(_param("cov_window", 0)))
        warmup = max(20, int(_param("cov_warmup", 50)))
        refit = max(1, int(_param("cov_refit", 50)))

        feats = sorted(cov_series)
        idx = np.asarray(usable_idx, dtype=int)
        # Feature row i = signal values at the last bar observed before the
        # forecast (origin - 1); origins have >= min_hist prior bars, so
        # idx - 1 >= 1 always indexes real data.
        x_all = np.column_stack(
            [np.asarray(cov_series[f], dtype=float)[idx - 1] for f in feats]
        )
        prev = np.asarray(prev_closes, dtype=float)
        raw_pred = np.asarray(predictions, dtype=float)
        act = np.asarray(actuals, dtype=float)
        safe_prev = np.where(prev == 0, 1.0, prev)
        # Residual returns of the RAW engine forecast — the fit target. The
        # adjusted values written back to `predictions` are never re-read here.
        resid = (act - raw_pred) / safe_prev

        n, k = x_all.shape
        adjusted = 0
        abs_adj: list[float] = []
        eye = np.eye(k)
        i = warmup
        while i < n:
            hi = min(n, i + refit)
            lo = 0 if window <= 0 else max(0, i - window)
            xt, yt = x_all[lo:i], resid[lo:i]
            mu = xt.mean(axis=0)
            sd = xt.std(axis=0)
            sd[sd == 0] = 1.0
            xs = (xt - mu) / sd
            y_mean = float(yt.mean())
            w = np.linalg.solve(xs.T @ xs + alpha * eye, xs.T @ (yt - y_mean))
            # Cap the adjustment at 3σ of the training residuals so a wild
            # signal value can't blow up a forecast.
            cap = 3.0 * float(yt.std())
            r_hat = np.clip(((x_all[i:hi] - mu) / sd) @ w + y_mean, -cap, cap)
            delta = r_hat * prev[i:hi]
            for j in range(i, hi):
                d = float(delta[j - i])
                predictions[j] = float(raw_pred[j] + d)
                if step_quantiles[j]:
                    step_quantiles[j] = [q + d for q in step_quantiles[j]]
            adjusted += hi - i
            abs_adj.extend(np.abs(r_hat).tolist())
            i = hi

        return {
            "features": feats,
            "warmup_bars": warmup,
            "refit_every": refit,
            "window": window or None,
            "alpha": alpha,
            "adjusted_bars": adjusted,
            "total_bars": n,
            "mean_abs_adjustment_bps": (
                round(float(np.mean(abs_adj)) * 1e4, 2) if abs_adj else 0.0
            ),
        }

    def _vol_metrics(
        self, realized: list[float | None], predicted: list[float | None]
    ) -> dict | None:
        """Accuracy of the volatility forecast (corr/MAE of predicted vs realized)."""
        pairs = [(a, p) for a, p in zip(realized, predicted) if a is not None and p is not None]
        if len(pairs) < 2:
            return None
        ra = [a for a, _ in pairs]
        pr = [p for _, p in pairs]
        n = len(pairs)
        mae = sum(abs(a - p) for a, p in pairs) / n
        ma, mp = sum(ra) / n, sum(pr) / n
        num = sum((a - ma) * (p - mp) for a, p in pairs)
        da = math.sqrt(sum((a - ma) ** 2 for a in ra))
        dp = math.sqrt(sum((p - mp) ** 2 for p in pr))
        corr = num / (da * dp) if da > 0 and dp > 0 else 0.0
        return {
            "corr": round(corr, 4),
            "corr_t": round(self._t_stat(corr, n), 2),
            "mae": round(mae, 6),
            "count": n,
        }

    def _walk_forward_metrics(
        self, actuals: list[float], predictions: list[float], prev_closes: list[float]
    ) -> dict:
        """Accuracy metrics for one-step-ahead walk-forward forecasts.

        Directional accuracy compares the predicted move against the actual move
        relative to the last observed close (prev_close) — the meaningful signal
        for one-step-ahead forecasting.
        """
        if not actuals or len(actuals) != len(predictions):
            return {"error": "Mismatch in actuals and predictions"}

        errors = [abs(a - p) for a, p in zip(actuals, predictions)]
        pct_errors = [
            abs(a - p) / a * 100 if a != 0 else 0 for a, p in zip(actuals, predictions)
        ]
        mae = sum(errors) / len(errors)
        rmse = math.sqrt(sum(e ** 2 for e in errors) / len(errors))
        mape = sum(pct_errors) / len(pct_errors)

        # Directional accuracy vs the last observed close.
        correct = 0
        directional = 0
        for a, p, prev in zip(actuals, predictions, prev_closes):
            actual_dir = a - prev
            pred_dir = p - prev
            if actual_dir == 0:
                continue  # flat actual move: not a directional call
            directional += 1
            if (actual_dir > 0) == (pred_dir > 0):
                correct += 1
        direction_accuracy = correct / directional * 100 if directional else 0

        # Information coefficient: rank correlation of the predicted move against
        # the realized move, both relative to prev_close. This is the meaningful,
        # parameter-free measure of forecast edge (a strategy's return is only a
        # tuned function of it). Computed on RETURNS, not price levels — a
        # level-to-level correlation on one-step-ahead forecasts is ~1.0 for
        # everything and can't discriminate.
        return_ic = self._return_ic(actuals, predictions, prev_closes)

        # Gross directional edge in basis points per bar: the average return of
        # a frictionless strategy that goes long/short with the forecast's sign
        # each bar. Parameter-free and directly comparable to trading fees —
        # e.g. edge_bps of 3 can't survive a 10 bps round trip.
        edge_terms = [
            (1 if p > prev else -1 if p < prev else 0) * (a - prev) / prev
            for a, p, prev in zip(actuals, predictions, prev_closes)
            if prev
        ]
        edge_bps = (sum(edge_terms) / len(edge_terms) * 1e4) if edge_terms else 0.0

        return {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "mape": round(mape, 2),
            "direction_accuracy_pct": round(direction_accuracy, 1),
            "return_ic": round(return_ic, 4),
            # Significance of the IC: t-statistic under the no-signal null.
            # Grows with sample size, so a small IC on many bars can outrank a
            # big IC on few — exactly what mass screening needs.
            "return_ic_t": round(self._t_stat(return_ic, len(actuals)), 2),
            "edge_bps": round(edge_bps, 2),
            # Back-compat key, now returns-based (was price-level correlation).
            "correlation": round(return_ic, 4),
            "test_count": len(actuals),
        }

    @staticmethod
    def _rank(xs: list[float]) -> list[float]:
        """Average (tie-corrected) ranks of ``xs``, for a Spearman correlation."""
        order = sorted(range(len(xs)), key=lambda i: xs[i])
        ranks = [0.0] * len(xs)
        i = 0
        while i < len(xs):
            j = i
            while j + 1 < len(xs) and xs[order[j + 1]] == xs[order[i]]:
                j += 1
            avg = (i + j) / 2.0
            for k in range(i, j + 1):
                ranks[order[k]] = avg
            i = j + 1
        return ranks

    @staticmethod
    def _pearson(xs: list[float], ys: list[float]) -> float:
        n = len(xs)
        if n < 2:
            return 0.0
        mx, my = sum(xs) / n, sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
        dy = math.sqrt(sum((y - my) ** 2 for y in ys))
        return num / (dx * dy) if dx > 0 and dy > 0 else 0.0

    def _return_ic(
        self, actuals: list[float], predictions: list[float], prev_closes: list[float]
    ) -> float:
        """Spearman rank correlation of predicted vs realized one-step returns."""
        ar: list[float] = []
        pr: list[float] = []
        for a, p, prev in zip(actuals, predictions, prev_closes):
            if prev:
                ar.append((a - prev) / prev)
                pr.append((p - prev) / prev)
        if len(ar) < 2:
            return 0.0
        return self._pearson(self._rank(ar), self._rank(pr))

    @staticmethod
    def _t_stat(r: float, n: int) -> float:
        """t-statistic of a correlation ``r`` over ``n`` samples under the
        no-correlation null: t = r * sqrt((n-2) / (1-r^2)).

        The screening companion to a raw correlation: |t| >= ~2 is nominally
        significant for ONE run, but when sweeping hundreds of coin/timeframe/
        model combinations the expected max |t| under pure chance is ~3-3.5, so
        only runs clearing ~4 deserve attention (Bonferroni-style).
        """
        if n < 3 or not (-1.0 < r < 1.0):
            return 0.0
        return r * math.sqrt((n - 2) / (1.0 - r * r))

    @staticmethod
    def _model_score(metrics: dict) -> float | None:
        """Price skill for the master table: the directional return IC.

        Parameter-free, in [-1, 1], higher = more edge. Every run computes it
        (the price walk-forward always happens). Volatility skill is a
        SEPARATE column (``score_vol`` from ``vol_metrics.corr``) — the two
        metrics live on different scales, so mixing them in one sortable
        column would compare unlike quantities.
        """
        ic = metrics.get("return_ic") if isinstance(metrics, dict) else None
        return round(float(ic), 4) if isinstance(ic, (int, float)) else None

    @staticmethod
    def _model_score_t(metrics: dict) -> float | None:
        """Significance (t-statistic) of the price score.

        Answers "is this edge statistically real given the sample size"
        instead of "how strong is it" — the number to sort by when screening
        many runs for the rare genuine signal. The vol equivalent is
        ``score_vol_t`` (from ``vol_metrics.corr_t``).
        """
        t = metrics.get("return_ic_t") if isinstance(metrics, dict) else None
        return round(float(t), 2) if isinstance(t, (int, float)) else None

    @staticmethod
    def _guard_not_degraded(engine, model_name: str) -> None:
        """Raise ModelDegradedError if the engine silently fell back at runtime.

        Degrade-capable engines (TimesFM, Chronos-2, …) return their fallback
        algorithm's slug from ``get_actual_slug()`` once loaded; a healthy run
        returns None (or its own slug). A mismatch means the requested model
        never ran.
        """
        actual = engine.get_actual_slug()
        if actual and actual != model_name:
            raise ModelDegradedError(
                f"'{model_name}' could not be loaded on this worker and fell back to "
                f"'{actual}', which produces no forecast bands (so the backtest can't "
                "run). The simulation was not completed with the requested model — "
                "ensure it's installed and its weights are available on the worker, "
                "then re-run."
            )

    def _configure_finetuned_engine(self, engine, klines: list) -> None:
        """Point a fine-tuned engine at this run's coin/pair/timeframe checkpoint.

        No-op for engines that aren't fine-tuned (they lack
        ``configure_checkpoint``). The target is read off the kline rows, which
        all share the same coin/pair/timeframe. If the per-target checkpoint
        doesn't exist the engine falls back to its base (zero-shot) model.
        """
        configure = getattr(engine, "configure_checkpoint", None)
        slug = getattr(engine, "finetune_source_slug", None)
        if configure is None or not slug or not klines:
            return
        k = klines[0]
        from crypto_ai.prediction.finetune_paths import finetune_checkpoint_dir
        configure(finetune_checkpoint_dir(slug, k.coin_id, k.quote_asset, k.interval))

    async def _resolve_orch_group(self, model_name: str):
        """Load the orchestration group behind an ``orch:<group_id>`` model token.

        Refuses a non-ready group: an un-calibrated group has an empty
        composition, which would silently degrade the blended model to nothing.
        """
        from crypto_ai.services.orchestration import OrchestrationService

        group_id = model_name.split(":", 1)[1]
        group = await OrchestrationService(self.session).get_group(group_id)
        if not group:
            raise ValueError(f"Orchestration group not found: {group_id}")
        if group.status != "ready":
            raise ValueError(
                f"Orchestration group '{group.name}' is not ready "
                f"(status: {group.status}). Calibrate it before running a simulation."
            )
        return group

    def _build_blending_engine(self, group):
        """Build a BlendingEngine from a ready group's calibrated weights."""
        from crypto_ai.prediction.engines.blending import BlendingEngine

        return BlendingEngine(
            weights=dict(group.model_composition or {}),
            weights_by_key=dict(group.weights_by_key or {}),
            registry=self.engine_registry,
            engine_params=dict(group.engine_params or {}),
        )

    def _get_engine_enum(self, model_name: str) -> PredictionEngineEnum | None:
        """Convert model name string to PredictionEngineEnum."""
        model_lower = model_name.lower()

        # Direct mappings
        mappings = {
            "statistical": PredictionEngineEnum.STATISTICAL,
            "timesfm": PredictionEngineEnum.TIMESFM,
            "timesfm_finetuned": PredictionEngineEnum.TIMESFM_FINETUNED,
            "custom": PredictionEngineEnum.CUSTOM,
            "gluon-chronos-bolt": PredictionEngineEnum.GLUON_CHRONOS_BOLT,
            "gluon-chronos2": PredictionEngineEnum.GLUON_CHRONOS2,
            "gluon-toto": PredictionEngineEnum.GLUON_TOTO,
            "chronos2": PredictionEngineEnum.CHRONOS2,
            "chronos-bolt": PredictionEngineEnum.CHRONOS_BOLT,
            "chronos_bolt": PredictionEngineEnum.CHRONOS_BOLT,
            "sundial": PredictionEngineEnum.SUNDIAL,
            "moirai2": PredictionEngineEnum.MOIRAI2,
            "toto": PredictionEngineEnum.TOTO,
            "yinglong": PredictionEngineEnum.YINGLONG,
            "kairos": PredictionEngineEnum.KAIROS,
            "tirex": PredictionEngineEnum.TIREX,
            "flowstate": PredictionEngineEnum.FLOWSTATE,
            "toto2": PredictionEngineEnum.TOTO2,
            "ttm": PredictionEngineEnum.TTM,
            "tabpfn": PredictionEngineEnum.TABPFN,
            "streak-reversal": PredictionEngineEnum.STREAK_REVERSAL,
            "streak_reversal": PredictionEngineEnum.STREAK_REVERSAL,
        }

        if model_lower in mappings:
            return mappings[model_lower]

        # Try fuzzy matching
        for key, enum_val in mappings.items():
            if key in model_lower or model_lower in key:
                return enum_val

        return None

    def _build_model_params(self, model_name: str, train_klines: list, train_features: list) -> dict:
        """Build model parameters by analyzing training data."""
        train_prices = [float(k.close) for k in train_klines]

        # Calculate comprehensive statistics for model fitting
        mean_price = sum(train_prices) / len(train_prices)
        variance = sum((p - mean_price) ** 2 for p in train_prices) / len(train_prices)
        std_dev = math.sqrt(variance)

        # Calculate returns and volatility
        returns = [(train_prices[i] - train_prices[i-1]) / train_prices[i-1]
                   for i in range(1, len(train_prices))]
        mean_return = sum(returns) / len(returns) if returns else 0

        # Calculate autocorrelation at different lags
        autocorr_lag1 = self._calculate_autocorr(returns, 1) if len(returns) > 1 else 0
        autocorr_lag5 = self._calculate_autocorr(returns, 5) if len(returns) > 5 else 0

        # Calculate rolling volatility
        rolling_vols = []
        for i in range(20, len(returns)):
            vol = math.sqrt(sum(r**2 for r in returns[i-20:i]) / 20)
            rolling_vols.append(vol)

        avg_rolling_vol = sum(rolling_vols) / len(rolling_vols) if rolling_vols else 0

        params = {
            "mean_price": mean_price,
            "std_dev": std_dev,
            "mean_return": mean_return,
            "autocorr_lag1": autocorr_lag1,
            "autocorr_lag5": autocorr_lag5,
            "rolling_volatility": avg_rolling_vol,
            "training_period": len(train_klines),
        }

        return params

    def _calculate_autocorr(self, series: list[float], lag: int) -> float:
        """Calculate autocorrelation at given lag."""
        if len(series) <= lag:
            return 0

        mean = sum(series) / len(series)
        numerator = sum((series[i] - mean) * (series[i - lag] - mean)
                       for i in range(lag, len(series)))
        denominator = sum((x - mean) ** 2 for x in series)

        if denominator == 0:
            return 0
        return numerator / denominator

    def _predict_with_confidence(
        self, model_name: str, test_klines: list, model_params: dict
    ) -> list[float]:
        """Generate predictions using model-specific strategies with fitted parameters."""
        test_prices = [float(k.close) for k in test_klines]
        test_horizon = len(test_klines) - 1

        if not test_prices or test_horizon < 1:
            return []

        model_lower = model_name.lower()
        mean_price = model_params.get("mean_price", 0)
        std_dev = model_params.get("std_dev", 0)
        mean_return = model_params.get("mean_return", 0)

        if "statistical" in model_lower:
            # Bayesian-style mean reversion with confidence intervals
            predictions = []
            current = test_prices[-1]
            confidence_factor = 0.15  # How much to revert toward mean

            for i in range(test_horizon):
                # Mean-reverting with volatility adjustment
                deviation = current - mean_price
                reversion_amount = deviation * confidence_factor
                next_price = current - reversion_amount + (mean_return * current)
                # Constrain to reasonable bounds based on training std dev
                next_price = max(
                    mean_price - 2 * std_dev,
                    min(next_price, mean_price + 2 * std_dev)
                )
                predictions.append(next_price)
                current = next_price
            return predictions

        elif any(x in model_lower for x in ("timesfm", "chronos", "moirai", "sundial", "yinglong", "kairos", "tirex", "flowstate")):
            # Advanced exponential smoothing with trend and seasonality
            alpha = 0.25  # Smoothing factor
            beta = 0.05   # Trend factor
            predictions = []
            current = test_prices[-1]

            # Calculate recent trend from last 20 prices
            if len(test_prices) >= 20:
                recent_returns = [(test_prices[i] - test_prices[i-1]) / test_prices[i-1]
                                 for i in range(len(test_prices)-20, len(test_prices))]
                recent_trend = sum(recent_returns) / len(recent_returns)
            else:
                recent_trend = mean_return

            for i in range(test_horizon):
                # Exponential smoothing with trend
                recent_avg = sum(test_prices[-10:]) / min(10, len(test_prices))
                current = (alpha * recent_avg +
                          (1 - alpha) * current +
                          beta * recent_trend * current)
                predictions.append(current)
                test_prices.append(current)  # Use prediction for next iteration

            return predictions
        else:
            # Random walk with drift
            predictions = []
            current = test_prices[-1]
            for i in range(test_horizon):
                next_price = current * (1 + mean_return)
                predictions.append(next_price)
                current = next_price
            return predictions

    def _analyze_predictions(
        self, test_dates: list, test_actuals: list, predictions: list
    ) -> list[dict]:
        """Generate detailed prediction analysis."""
        samples = []

        for i, (dt, actual, pred) in enumerate(zip(test_dates, test_actuals, predictions)):
            # Only sample every Nth prediction to keep output manageable
            sample_interval = max(1, len(test_actuals) // 10)
            if i % sample_interval == 0 or i < 10:
                error = actual - pred
                pct_error = abs(error) / actual * 100 if actual != 0 else 0

                samples.append({
                    "date": str(dt),
                    "actual": float(actual),
                    "predicted": float(pred),
                    "error": float(error),
                    "pct_error": float(pct_error),
                })

        return samples

    def _extract_features(self, klines: list) -> list[list[float]]:
        """Extract features from kline data."""
        features = []
        for i in range(1, len(klines)):
            k = klines[i]
            k_prev = klines[i - 1]
            # Features: open, high, low, close, volume, price_change, volatility
            price_change = (k.close - k_prev.close) / k_prev.close if k_prev.close > 0 else 0
            intra_volatility = (k.high - k.low) / k.open if k.open > 0 else 0
            features.append([
                float(k.open),
                float(k.high),
                float(k.low),
                float(k.close),
                float(k.volume),
                price_change,
                intra_volatility,
            ])
        return features

    def _calculate_metrics(
        self, actuals: list[float], predictions: list[float], test_klines: list
    ) -> dict:
        """Calculate accuracy metrics for predictions."""
        if not actuals or not predictions or len(actuals) != len(predictions):
            return {"error": "Mismatch in actuals and predictions"}

        # Basic error metrics
        errors = [abs(a - p) for a, p in zip(actuals, predictions)]
        pct_errors = [
            abs(a - p) / a * 100 if a != 0 else 0 for a, p in zip(actuals, predictions)
        ]

        mae = sum(errors) / len(errors) if errors else 0
        rmse = math.sqrt(sum(e ** 2 for e in errors) / len(errors)) if errors else 0
        mape = sum(pct_errors) / len(pct_errors) if pct_errors else 0

        # Direction accuracy: % of correct up/down predictions
        actual_directions = [1 if actuals[i] > actuals[i - 1] else -1 for i in range(1, len(actuals))]
        predicted_directions = [1 if predictions[i] > predictions[i - 1] else -1 for i in range(1, len(predictions))]
        correct_directions = sum(1 for a, p in zip(actual_directions, predicted_directions) if a == p)
        direction_accuracy = correct_directions / len(actual_directions) * 100 if actual_directions else 0

        # Correlation with actual prices
        if len(actuals) > 1:
            mean_actual = sum(actuals) / len(actuals)
            mean_pred = sum(predictions) / len(predictions)
            numerator = sum((a - mean_actual) * (p - mean_pred) for a, p in zip(actuals, predictions))
            denom_a = math.sqrt(sum((a - mean_actual) ** 2 for a in actuals))
            denom_p = math.sqrt(sum((p - mean_pred) ** 2 for p in predictions))
            correlation = numerator / (denom_a * denom_p) if denom_a > 0 and denom_p > 0 else 0
        else:
            correlation = 0

        return {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "mape": round(mape, 2),
            "direction_accuracy_pct": round(direction_accuracy, 1),
            "correlation": round(correlation, 4),
            "test_count": len(actuals),
        }
