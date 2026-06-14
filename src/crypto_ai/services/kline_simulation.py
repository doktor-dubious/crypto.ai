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
from crypto_ai.schemas.kline import KlineResponse
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
    ) -> dict:
        """Run simulation of AI models on kline data.

        Args:
            coin_id: The coin to simulate
            quote_asset: Quote asset (e.g., USDT)
            interval: Timeframe (e.g., 1h, 15m, 1d)
            start_date: Start date for simulation
            end_date: End date for simulation
            model_names: List of model names to test

        Returns:
            Dictionary with simulation results for each model
        """
        start_time = time.time()

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

        if not klines:
            return {
                "coin_id": coin_id,
                "quote_asset": quote_asset,
                "interval": interval,
                "error": "No kline data found up to the specified end date",
            }

        # First index inside the requested simulation window; everything before
        # it is available as historical context.
        sim_start_idx = next(
            (i for i, k in enumerate(klines) if k.open_time >= start_dt),
            len(klines),
        )
        sim_count = len(klines) - sim_start_idx

        if sim_count < 1:
            return {
                "coin_id": coin_id,
                "quote_asset": quote_asset,
                "interval": interval,
                "error": "No kline data found within the simulation date range",
            }

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

        model_start = time.time()
        # Forecasting volatility roughly doubles the per-model work (a second
        # one-step walk-forward over the realized-vol series). Not used for the
        # kline (binary up/down) strategy.
        vol_on = forecast_vol and strategy != "kline"
        per_model_work = sim_count * (2 if vol_on else 1)
        total_work = max(1, len(model_names) * per_model_work)
        for model_idx, model_name in enumerate(model_names):
            done_base = model_idx * per_model_work

            async def _model_cb(done: int, total: int, mname: str = model_name, base: int = done_base) -> None:
                if on_progress is not None:
                    pct = min(99, int((base + done) / total_work * 100))
                    await on_progress(pct, f"{mname}: {done}/{total} forecasts")

            try:
                if strategy == "kline":
                    model_result = await self._run_kline_strategy(
                        model_name, klines, sim_start_idx,
                        on_progress=_model_cb, should_stop=should_stop,
                        include_full_predictions=include_full_predictions,
                    )
                else:
                    model_result = await self._run_model_simulation(
                        model_name, klines, sim_start_idx,
                        on_progress=_model_cb, should_stop=should_stop,
                        include_full_predictions=include_full_predictions,
                        forecast_vol=vol_on,
                    )
                results["models"][model_name] = model_result
            except VolForecastError:
                # The user opted into a volatility forecast and it failed; fail
                # the whole run with a visible reason rather than storing a
                # success that silently has no vol data.
                raise
            except Exception as e:
                log.error(f"Error running model {model_name}: {e}")
                results["models"][model_name] = {"error": str(e)}

            if should_stop is not None and should_stop():
                results["stopped"] = True
                break

        total_time = time.time() - start_time
        model_time = total_time - fetch_time
        results["timing"]["model_analysis_sec"] = round(model_time, 3)
        results["timing"]["total_sec"] = round(total_time, 3)

        log.info(f"Simulation completed in {total_time:.2f}s (fetch: {fetch_time:.2f}s, models: {model_time:.2f}s)")

        return results

    async def _run_model_simulation(
        self,
        model_name: str,
        klines: list,
        sim_start_idx: int,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
        should_stop: StopCb | None = None,
        include_full_predictions: bool = False,
        forecast_vol: bool = False,
    ) -> dict:
        """Walk-forward one-step-ahead backtest for a single model.

        For every kline at index ``gi >= sim_start_idx`` we forecast its close
        using only the closes that precede it (capped at the engine's max
        context), then compare to the actual. All such one-step forecasts are
        run as a single batched call for efficiency.
        """
        try:
            engine_enum = self._get_engine_enum(model_name)
            if not engine_enum:
                return {"error": f"Unknown model: {model_name}"}

            try:
                engine = self.engine_registry.get_engine(engine_enum)
            except ValueError as e:
                return {"error": f"Model {model_name} not available: {str(e)}"}

            capabilities = engine.get_capabilities()
            ctx_len = capabilities.max_history_length or 1024
            min_hist = max(2, capabilities.min_history_length)

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
                    else datetime.fromtimestamp(k.open_time / 1000)
                )

            # The engines/preprocessor are date-keyed and SUM values sharing a
            # date. Intraday klines must therefore be fed with unique, ordered
            # date keys — we use a synthetic daily index per context window
            # purely to preserve order; these zero-shot models forecast the
            # value sequence, not the calendar.
            base_date = date(2000, 1, 1)

            items: list[dict] = []
            usable_idx: list[int] = []
            for gi in range(sim_start_idx, n):
                ctx = closes[max(0, gi - ctx_len):gi]
                if len(ctx) < min_hist:
                    continue  # not enough prior history to forecast this point yet
                hist = [
                    {"date": base_date + timedelta(days=j), "value": v}
                    for j, v in enumerate(ctx)
                ]
                items.append({"historical_data": hist, "covariates": None, "pad_dates": None})
                usable_idx.append(gi)

            if not items:
                return {
                    "error": (
                        f"Insufficient history: need at least {min_hist} points "
                        "before the simulation range"
                    )
                }

            total = len(items)
            total_steps = total * (2 if forecast_vol else 1)
            log.info(
                f"Walk-forward {model_name}: {total} one-step forecasts "
                f"(context<= {ctx_len}){' +volatility' if forecast_vol else ''}"
            )

            # Process in chunks so progress can be reported and a graceful stop
            # honoured between batched engine calls. Each item is an independent
            # horizon-1 forecast.
            predictions: list[float] = []
            step_quantiles: list[list[float] | None] = []
            stopped = False
            for c in range(0, total, _CHUNK):
                chunk = items[c:c + _CHUNK]
                try:
                    batch_results = await engine.predict_batch(
                        chunk, horizon=1, prediction_from=base_date
                    )
                except Exception as e:
                    log.error(f"Engine prediction failed: {e}", exc_info=True)
                    return {"error": f"Prediction failed: {str(e)}"}

                for res in batch_results:
                    q = res[0].quantiles if (res and res[0].quantiles) else None
                    if res and res[0].predicted_value is not None:
                        predictions.append(float(res[0].predicted_value))
                    elif q and len(q) >= 5:
                        predictions.append(float(q[4]))
                    else:
                        predictions.append(0.0)
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

            actuals = [closes[gi] for gi in usable_idx]
            prev_closes = [closes[gi - 1] for gi in usable_idx]
            times = [_real_dt(klines[gi]) for gi in usable_idx]

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
                    realized_vol_list[i] = rv[usable_idx[i]]
                    if i < len(vol_preds):
                        pred_vol_list[i] = max(0.0, vol_preds[i])
                k = len(vol_preds)
                vol_metrics = self._vol_metrics(realized_vol_list[:k], pred_vol_list[:k])

            metrics = self._walk_forward_metrics(actuals, predictions, prev_closes)
            predictions_sample = self._analyze_predictions(times, actuals, predictions)

            model_result = {
                "status": "stopped" if stopped else "success",
                "metrics": metrics,
                "test_count": len(actuals),
                "engine": engine.__class__.__name__,
                "actual_engine": engine.get_actual_slug() or engine_enum.value,
                "context_length": ctx_len,
                "predictions_sample": predictions_sample,
            }
            if vol_metrics is not None:
                model_result["vol_metrics"] = vol_metrics

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
        except VolForecastError:
            raise  # opted-in vol forecast failed — fail the run, not a model-level error dict
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

            capabilities = engine.get_capabilities()
            ctx_len = capabilities.max_history_length or 1024
            min_hist = max(2, capabilities.min_history_length)

            closes = [float(k.close) for k in klines]
            n = len(klines)

            def _real_dt(k) -> datetime:
                return (
                    k.open_time
                    if isinstance(k.open_time, datetime)
                    else datetime.fromtimestamp(k.open_time / 1000)
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

            # Encode the directional call as a tiny synthetic "price" so the
            # existing direction columns and backtest light up: above prev when
            # the model leans up (f>0.5), below when it leans down.
            _edge = 0.02
            predictions = [prev_closes[i] * (1 + (f[i] - 0.5) * _edge) for i in range(scored)]

            metrics = self._walk_forward_metrics(actuals, predictions, prev_closes)
            model_result = {
                "status": "stopped" if stopped else "success",
                "metrics": metrics,
                "test_count": len(actuals),
                "engine": engine.__class__.__name__,
                "actual_engine": engine.get_actual_slug() or engine_enum.value,
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
    ) -> list[float]:
        """One-step-ahead walk-forward over an arbitrary value series.

        For each index gi in ``idxs`` forecast values[gi] from the preceding
        ``ctx_len`` values. Used for the volatility series; mirrors the price
        loop but returns plain point forecasts.
        """
        items: list[dict] = []
        for gi in idxs:
            ctx = values[max(0, gi - ctx_len):gi]
            hist = [
                {"date": base_date + timedelta(days=j), "value": v}
                for j, v in enumerate(ctx)
            ]
            items.append({"historical_data": hist, "covariates": None, "pad_dates": None})

        preds: list[float] = []
        for c in range(0, len(items), _CHUNK):
            chunk = items[c:c + _CHUNK]
            batch_results = await engine.predict_batch(chunk, horizon=1, prediction_from=base_date)
            for res in batch_results:
                q = res[0].quantiles if (res and res[0].quantiles) else None
                if res and res[0].predicted_value is not None:
                    preds.append(float(res[0].predicted_value))
                elif q and len(q) >= 5:
                    preds.append(float(q[4]))
                else:
                    preds.append(0.0)
            if on_progress is not None:
                await on_progress(done_offset + len(preds), total_steps)
            if should_stop is not None and should_stop():
                break
        return preds

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
        return {"corr": round(corr, 4), "mae": round(mae, 6), "count": n}

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

        # Correlation between predicted and actual levels.
        if len(actuals) > 1:
            mean_a = sum(actuals) / len(actuals)
            mean_p = sum(predictions) / len(predictions)
            num = sum((a - mean_a) * (p - mean_p) for a, p in zip(actuals, predictions))
            den_a = math.sqrt(sum((a - mean_a) ** 2 for a in actuals))
            den_p = math.sqrt(sum((p - mean_p) ** 2 for p in predictions))
            correlation = num / (den_a * den_p) if den_a > 0 and den_p > 0 else 0
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
            trend = mean_return * current

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

        for i, (date, actual, pred) in enumerate(zip(test_dates, test_actuals, predictions)):
            # Only sample every Nth prediction to keep output manageable
            sample_interval = max(1, len(test_actuals) // 10)
            if i % sample_interval == 0 or i < 10:
                error = actual - pred
                pct_error = abs(error) / actual * 100 if actual != 0 else 0

                samples.append({
                    "date": str(date),
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
