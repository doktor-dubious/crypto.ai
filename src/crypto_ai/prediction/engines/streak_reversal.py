"""Streak-reversal baseline engine.

A deliberately simple, parameter-free benchmark that exploits the one
directional signal measurably present in crypto klines: short-term mean
reversion after runs of same-direction closes. Empirically (BTC/ETH,
5m–1h, 2019–2026) the probability that the next bar reverses grows
monotonically with the streak length — from ~50% after 1 bar to ~57–60%
after 5–6 bars, in both directions.

The forecast is built from the context itself: find every historical bar
in the context window whose (direction, streak-length) state matches the
current one, and use the empirical distribution of what happened next —
mean → point forecast, deciles → quantile band. No fitted parameters, so
it can't overfit; it simply gives every foundation model a floor to beat
that already knows the streak effect.
"""

from datetime import date

import numpy as np

from crypto_ai.prediction.engine import EngineCapabilities, PredictionEngine
from crypto_ai.prediction.preprocessor import DataPreprocessor
from crypto_ai.schemas.prediction import PredictionResult

# Streaks longer than this share one bucket: "exactly 7 ups" is too rare in a
# context window to estimate on its own, and empirically the reversal edge
# flattens out around this length anyway.
_STREAK_CAP = 4
# Minimum matching historical states required before the condition is relaxed
# (shorter streak, then unconditional) — below this the deciles are noise.
_MIN_SAMPLES = 16


def _signed_streaks(returns: np.ndarray) -> np.ndarray:
    """Signed run length ending at each bar: +k after k consecutive up moves,
    -k after k consecutive down moves, 0 on a flat move."""
    out = np.zeros(len(returns), dtype=np.int64)
    run = 0
    for i, r in enumerate(returns):
        if r > 0:
            run = run + 1 if run > 0 else 1
        elif r < 0:
            run = run - 1 if run < 0 else -1
        else:
            run = 0
        out[i] = run
    return out


class StreakReversalEngine(PredictionEngine):
    """Empirical conditional-on-streak forecaster (mean-reversion baseline)."""

    def __init__(self):
        self.preprocessor = DataPreprocessor(fill_missing=True, normalize=False)

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Streak Reversal",
            description=(
                "Parameter-free mean-reversion baseline: forecasts the next bar "
                "from the empirical distribution of moves that followed the same "
                "up/down streak state in the context window"
            ),
            supports_multivariate=False,
            supports_exogenous=False,
            supports_uncertainty=True,
            min_history_length=30,
            max_history_length=4096,
            max_horizon=365,
            optimal_horizon=1,
        )

    async def predict(
        self,
        historical_data: list[dict],
        horizon: int,
        prediction_from: date,
        covariates: dict[str, dict[date, float]] | None = None,
        pad_dates: dict[str, set[date]] | None = None,
        **kwargs,
    ) -> list[PredictionResult]:
        self.validate_input(historical_data, horizon)

        df = self.preprocessor.preprocess(historical_data)
        values = np.asarray(df["value"].values, dtype=np.float64)
        last = float(values[-1])

        cond_returns = self._conditional_next_returns(values)
        mean_ret = float(np.mean(cond_returns))
        deciles = np.percentile(cond_returns, np.arange(10, 100, 10))

        point = last * (1.0 + mean_ret)
        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)

        results: list[PredictionResult] = []
        for i, pred_date in enumerate(future_dates):
            # Beyond one step the streak state after the (unknown) next move is
            # itself unknown, so the point forecast stays at the step-1 value and
            # the band widens with sqrt(h), random-walk style.
            scale = float(np.sqrt(i + 1))
            q = sorted(last * (1.0 + mean_ret + (float(d) - mean_ret) * scale) for d in deciles)
            results.append(
                PredictionResult(
                    date=pred_date,
                    predicted_value=point,
                    lower_bound=q[0],
                    upper_bound=q[-1],
                    confidence=0.8,  # band spans P10–P90
                    quantiles=q,
                )
            )
        return results

    @staticmethod
    def _conditional_next_returns(values: np.ndarray) -> np.ndarray:
        """Next-bar returns of every historical bar whose streak state matches
        the current one, relaxing the condition until enough samples exist."""
        prev = values[:-1]
        safe_prev = np.where(prev != 0, prev, 1.0)
        returns = np.where(prev != 0, (values[1:] - prev) / safe_prev, 0.0)
        if len(returns) < 2:
            return np.array([0.0])

        streaks = _signed_streaks(returns)
        current = int(streaks[-1])
        sign = 1 if current > 0 else -1 if current < 0 else 0
        k = min(abs(current), _STREAK_CAP)

        # streaks[i] is the state AFTER bar i's move; the outcome of that state
        # is the following bar's return, so pair streaks[:-1] with returns[1:].
        states = streaks[:-1]
        outcomes = returns[1:]

        while sign != 0 and k >= 1:
            if k == _STREAK_CAP:
                mask = (states * sign) >= k  # capped bucket: "k or longer"
            else:
                mask = states == sign * k
            if int(mask.sum()) >= _MIN_SAMPLES:
                return outcomes[mask]
            k -= 1  # too rare in this context — relax to a shorter streak

        return outcomes if len(outcomes) else np.array([0.0])
