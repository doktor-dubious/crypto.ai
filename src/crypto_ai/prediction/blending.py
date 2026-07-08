"""Prediction blending strategies for model orchestration.

The primary blend is *predictive sampling* (arbitration via a mixture
distribution, as in Synapse, arXiv:2511.05460): each engine contributes
samples from its quantile-defined predictive distribution in proportion to
its weight, and the blend's quantiles are empirical quantiles of the pooled
samples — monotonic by construction.

Samples are drawn at quantile levels inside [0.1, 0.9] (engines expose nine
quantiles at P10..P90; we never extrapolate past the known tails). The pooled
samples therefore represent the central 80% of the blend distribution, so
empirical quantiles must be read back through the *inverse* of that level
map: pool-percentile ``(q - 0.1) / 0.8`` estimates the blend's q-quantile.
Reading them at ``q`` directly would compress the band (P10 would really be
~P18) — the identity check "blending one engine returns its own quantiles"
only holds with the inverse map.
"""

import math

import numpy as np

from crypto_ai.prediction.engine import QUANTILE_LEVELS
from crypto_ai.schemas.prediction import PredictionResult

# Engines expose quantiles at these levels; sampling stays inside the range.
_LEVEL_LO = 0.1
_LEVEL_HI = 0.9
_LEVEL_SPAN = _LEVEL_HI - _LEVEL_LO
_N_SAMPLES = 1000  # total stratified samples distributed across engines by weight


def _pool_percentile(level: float) -> float:
    """Map a quantile level to the percentile of the [P10,P90]-sampled pool."""
    return (level - _LEVEL_LO) / _LEVEL_SPAN * 100.0


def _normalize_step_weights(
    weights: dict[str, float], engine_slugs: list[str]
) -> dict[str, float]:
    """Normalize weights over ``engine_slugs``, guarding against a zero (or
    negative) total. Deterministic equal weights when nothing positive is
    supplied."""
    pos = {s: max(0.0, float(weights.get(s, 0.0))) for s in engine_slugs}
    total_weight = sum(pos.values())
    if total_weight <= 0:
        return {s: 1.0 / len(engine_slugs) for s in engine_slugs}
    return {s: w / total_weight for s, w in pos.items()}


def _blend_step(
    date_idx: int,
    predictions_by_engine: list[list[PredictionResult]],
    norm_weights: dict[str, float],
    engine_slugs: list[str],
) -> PredictionResult:
    """Blend one horizon step of all engines' forecasts with the given weights."""
    # Date = first engine that covers this step.
    step_date = None
    for predictions in predictions_by_engine:
        if date_idx < len(predictions):
            step_date = predictions[date_idx].date
            break

    pooled_samples: list[float] = []
    # (weight, point) fallbacks for steps where no engine exposes quantiles.
    point_fallbacks: list[tuple[float, float]] = []
    # (weight, economic_optimal) from engines that computed a newsvendor draw.
    eo_contributions: list[tuple[float, float]] = []

    for engine_slug, predictions in zip(engine_slugs, predictions_by_engine):
        if date_idx >= len(predictions):
            continue
        pred = predictions[date_idx]
        weight = norm_weights.get(engine_slug, 0.0)
        if weight <= 0:
            continue

        pv = pred.predicted_value
        if pv is not None and np.isfinite(pv):
            point_fallbacks.append((weight, float(pv)))

        eo = pred.economic_optimal
        if eo is not None and np.isfinite(eo):
            eo_contributions.append((weight, float(eo)))

        n_engine_samples = max(1, int(round(_N_SAMPLES * weight)))

        qv = np.asarray(pred.quantiles, dtype=float) if pred.quantiles else np.array([])
        qv = qv[np.isfinite(qv)]  # drop NaN/inf — never let them poison the pool
        if qv.size == 0:
            # No usable quantiles: contribute the point forecast as a point
            # mass so the engine's weight still counts in the mixture —
            # skipping it would silently hand its entire weight to the
            # quantile-exposing engines.
            if pv is not None and np.isfinite(pv):
                pooled_samples.extend([max(float(pv), 0.0)] * n_engine_samples)
            continue
        qv = np.sort(qv)  # enforce monotonicity defensively
        # Deterministic stratified draw across the engine's known [P10,P90]
        # range — no RNG (reproducible), no extrapolation past the tails.
        strata = (np.arange(n_engine_samples) + 0.5) / n_engine_samples
        if qv.size > 1:
            levels = np.linspace(_LEVEL_LO, _LEVEL_HI, qv.size)
            sample_levels = _LEVEL_LO + _LEVEL_SPAN * strata
            samples = np.interp(sample_levels, levels, qv)
        else:
            samples = np.full(n_engine_samples, qv[0])
        samples = np.maximum(samples, 0.0)
        pooled_samples.extend(samples.tolist())

    arr = np.asarray(pooled_samples, dtype=float)
    arr = arr[np.isfinite(arr)] if arr.size else arr

    # Blend the engines' newsvendor optima (each is that engine's quantile at
    # the critical fractile) with the same weights, renormalized over the
    # engines that actually produced one. Overwriting with the median would
    # silently disable draw optimization for orchestrated forecasts.
    def blended_eo(default: float) -> float:
        if not eo_contributions:
            return default
        wsum = sum(w for w, _ in eo_contributions)
        if wsum <= 0:
            return float(np.mean([e for _, e in eo_contributions]))
        return sum(w * e for w, e in eo_contributions) / wsum

    if arr.size:
        empirical_quantiles = [
            float(np.percentile(arr, _pool_percentile(q))) for q in QUANTILE_LEVELS
        ]
        predicted_value = float(np.percentile(arr, _pool_percentile(0.5)))
        lower_bound = float(np.percentile(arr, _pool_percentile(_LEVEL_LO)))
        upper_bound = float(np.percentile(arr, _pool_percentile(_LEVEL_HI)))
        return PredictionResult(
            date=step_date,
            predicted_value=predicted_value,
            lower_bound=lower_bound,
            upper_bound=upper_bound,
            economic_optimal=blended_eo(predicted_value),
            quantiles=empirical_quantiles,
        )

    # No engine exposed usable quantiles at this step → weighted average of
    # the engines' point estimates rather than a silent zero.
    if point_fallbacks:
        wsum = sum(w for w, _ in point_fallbacks)
        pv = (
            sum(w * p for w, p in point_fallbacks) / wsum
            if wsum > 0
            else float(np.mean([p for _, p in point_fallbacks]))
        )
    else:
        pv = 0.0
    pv = max(pv, 0.0)
    return PredictionResult(
        date=step_date,
        predicted_value=pv,
        lower_bound=pv,
        upper_bound=pv,
        economic_optimal=blended_eo(pv),
        quantiles=None,
    )


def blend_predictions_predictive_sampling(
    predictions_by_engine: list[list[PredictionResult]],
    weights: dict[str, float],
    engine_slugs: list[str],
) -> list[PredictionResult]:
    """
    Blend predictions from multiple engines using predictive sampling.

    This approach:
    1. For each engine i with weight w_i, draw n_i = N_samples × w_i samples
       from its quantile distribution
    2. Pool all samples together
    3. Compute empirical quantiles from the pooled samples (via the inverse
       level map — see module docstring)
    4. Return blended predictions with monotonic quantiles by construction

    Args:
        predictions_by_engine: List of prediction lists, one per engine
        weights: Dict mapping engine slug to weight (should sum to 1)
        engine_slugs: List of engine slugs in order matching predictions_by_engine

    Returns:
        Blended PredictionResult list with empirical quantiles
    """
    if not predictions_by_engine or not weights:
        # Fallback: return first engine's predictions
        return predictions_by_engine[0] if predictions_by_engine else []

    norm_weights = _normalize_step_weights(weights, engine_slugs)

    # Cover the longest engine — never silently truncate to the first engine's length.
    n_dates = max((len(p) for p in predictions_by_engine), default=0)
    if n_dates == 0:
        return []

    return [
        _blend_step(date_idx, predictions_by_engine, norm_weights, engine_slugs)
        for date_idx in range(n_dates)
    ]


def _step_crps(pred: PredictionResult, y: float) -> float | None:
    """CRPS (mean pinball over the nine quantile levels) of one engine's step
    forecast against ``y``. Falls back to the point forecast treated as a flat
    quantile function (= 0.5·|error|) when the engine exposes no quantiles.
    Returns None when the step has nothing usable."""
    if pred.quantiles:
        qv = np.asarray(pred.quantiles, dtype=float)
        if len(qv) == len(QUANTILE_LEVELS) and np.all(np.isfinite(qv)):
            errors = y - qv
            pinball = np.where(
                errors >= 0, QUANTILE_LEVELS * errors, (QUANTILE_LEVELS - 1) * errors
            )
            return float(np.mean(pinball))
    pv = pred.predicted_value
    if pv is not None and np.isfinite(pv):
        return 0.5 * abs(y - float(pv))
    return None


def blend_predictions_dynamic_reweight(
    predictions_by_engine: list[list[PredictionResult]],
    weights: dict[str, float],
    engine_slugs: list[str],
    prior_strength: float = 3.0,
) -> list[PredictionResult]:
    """Synapse-style adaptive arbitration (arXiv:2511.05460): re-weight the
    engines at every horizon step via forward simulation.

    Step t is blended with the current weights; its blend median acts as
    pseudo-ground-truth; each engine's CRPS against it accumulates over the
    steps seen so far; and the next step's weights move from the calibrated
    prior toward inverse-CRPS as evidence accumulates:

        w_t ∝ (K·w_prior + n_t·w_crps) / (K + n_t)

    where ``K = prior_strength`` and ``n_t`` = simulated steps so far. Engines
    that track the consensus gain weight; divergent engines are down-weighted.
    Anchoring on the calibrated prior mitigates the confirmation-bias risk the
    paper itself flags for its pure self-referential loop.
    """
    if not predictions_by_engine or not weights:
        return predictions_by_engine[0] if predictions_by_engine else []

    prior = _normalize_step_weights(weights, engine_slugs)
    n_dates = max((len(p) for p in predictions_by_engine), default=0)
    if n_dates == 0:
        return []

    crps_history: dict[str, list[float]] = {s: [] for s in engine_slugs}
    current = dict(prior)
    blended_results: list[PredictionResult] = []

    for date_idx in range(n_dates):
        step = _blend_step(date_idx, predictions_by_engine, current, engine_slugs)
        blended_results.append(step)

        # Forward simulation: score each engine against the blend median.
        y_sim = step.predicted_value
        if y_sim is None or not math.isfinite(y_sim):
            continue
        for engine_slug, predictions in zip(engine_slugs, predictions_by_engine):
            if date_idx >= len(predictions):
                continue
            crps = _step_crps(predictions[date_idx], float(y_sim))
            if crps is not None:
                crps_history[engine_slug].append(crps)

        scores = {
            s: float(np.mean(h)) for s, h in crps_history.items() if h
        }
        if not scores:
            continue
        # Inverse-CRPS weights with a median-scaled epsilon (same scheme as the
        # offline calibration) — engines with no evidence keep zero here and
        # rely on their prior mass.
        median_err = float(np.median(list(scores.values())))
        eps = 1e-6 * (1.0 + median_err)
        raw = {s: 1.0 / (v + eps) for s, v in scores.items()}
        total = sum(raw.values())
        w_crps = {s: r / total for s, r in raw.items()} if total > 0 else {}

        n_t = float(np.mean([len(h) for h in crps_history.values() if h]))
        denom = prior_strength + n_t
        current = _normalize_step_weights(
            {
                s: (prior_strength * prior.get(s, 0.0) + n_t * w_crps.get(s, 0.0))
                / denom
                for s in engine_slugs
            },
            engine_slugs,
        )

    return blended_results


def blend_predictions_weighted_average(
    predictions_by_engine: list[list[PredictionResult]],
    weights: dict[str, float],
    engine_slugs: list[str],
) -> list[PredictionResult]:
    """
    Blend predictions using weighted average of point estimates.

    Simpler approach than predictive sampling, but less rigorous for quantile blending.

    Args:
        predictions_by_engine: List of prediction lists, one per engine
        weights: Dict mapping engine slug to weight (should sum to 1)
        engine_slugs: List of engine slugs in order matching predictions_by_engine

    Returns:
        Blended PredictionResult list
    """
    if not predictions_by_engine or not weights:
        return predictions_by_engine[0] if predictions_by_engine else []

    n_dates = len(predictions_by_engine[0]) if predictions_by_engine else 0

    if n_dates == 0:
        return []

    # Normalize weights (guard zero/negative total).
    total_weight = sum(max(0.0, float(w)) for w in weights.values())
    if total_weight <= 0:
        norm_weights = {slug: 1.0 / len(engine_slugs) for slug in engine_slugs}
    else:
        norm_weights = {slug: max(0.0, float(w)) / total_weight for slug, w in weights.items()}

    blended_results: list[PredictionResult] = []

    for date_idx in range(n_dates):
        weighted_point = 0.0
        weighted_lower = 0.0
        weighted_upper = 0.0
        weighted_eo = 0.0
        weighted_quantiles = None
        total_valid_weight = 0.0

        for engine_idx, (engine_slug, predictions) in enumerate(
            zip(engine_slugs, predictions_by_engine)
        ):
            if date_idx >= len(predictions):
                continue

            pred = predictions[date_idx]
            weight = norm_weights.get(engine_slug, 0.0)

            if weight <= 0:
                continue

            point = pred.predicted_value or 0.0
            weighted_point += point * weight
            lo = pred.lower_bound if pred.lower_bound is not None else point
            hi = pred.upper_bound if pred.upper_bound is not None else point
            eo = pred.economic_optimal if pred.economic_optimal is not None else point
            weighted_lower += lo * weight
            weighted_upper += hi * weight
            weighted_eo += eo * weight
            total_valid_weight += weight

            # For quantiles, use weighted average too (less rigorous)
            if weighted_quantiles is None and pred.quantiles:
                weighted_quantiles = [q * weight for q in pred.quantiles]
            elif weighted_quantiles is not None and pred.quantiles:
                weighted_quantiles = [
                    wq + q * weight
                    for wq, q in zip(weighted_quantiles, pred.quantiles)
                ]

        if total_valid_weight > 0:
            # Renormalize by actual weight
            weighted_point /= total_valid_weight
            weighted_lower /= total_valid_weight
            weighted_upper /= total_valid_weight
            weighted_eo /= total_valid_weight
            if weighted_quantiles:
                weighted_quantiles = [q / total_valid_weight for q in weighted_quantiles]

        # Get date
        date = None
        for predictions in predictions_by_engine:
            if date_idx < len(predictions):
                date = predictions[date_idx].date
                break

        blended_results.append(
            PredictionResult(
                date=date,
                predicted_value=weighted_point,
                lower_bound=weighted_lower,
                upper_bound=weighted_upper,
                economic_optimal=weighted_eo,
                quantiles=weighted_quantiles,
            )
        )

    return blended_results
