# Handover: Model Orchestration — Blend Correctness, Calibration & Dynamic Reweighting

**Audience:** Claude (or an engineer) porting these changes into **crypto.ai** (the sibling fork of gorm.ai).
**Source:** Implemented, tested, and evaluated in `gorm.ai`, 2026-07-02. All changes are on `main`'s working tree; reference files are listed per section.
**Origin:** A review of the Model Orchestration implementation against **TSorchestra** (github.com/DC-research/TSorchestra — SLSQP simplex stacking) and **Synapse** (arXiv:2511.05460 — adaptive arbitration via predictive sampling). The gorm.ai architecture (rolling-origin backtest → inverse-error weights → top-N → mixture blend) was kept as a deliberate hybrid of the two; the changes below fix correctness bugs in it and add the missing pieces.

Since crypto.ai is a fork, file paths and structure should match closely (`src/*/prediction/blending.py`, `src/*/services/calibration.py`, `src/*/services/orchestration.py`, etc.). Where crypto.ai has drifted, the **invariants and code snippets** below are the portable parts. Check each section's "crypto.ai note".

---

## 0. TL;DR — the eight changes

| # | Change | File (gorm.ai) | Severity / kind |
|---|--------|----------------|-----------------|
| 1 | Blend quantile **level-map fix** (P10/P90 were really ~P18/P82) | `prediction/blending.py` | **Bug, affects every orchestrated forecast** |
| 2 | Quantile-less engines blend as **point masses** (weight was silently discarded) | `prediction/blending.py` | **Bug** |
| 3 | `economic_optimal` **weight-blended** (was overwritten with the median) | `prediction/blending.py` | **Bug** (skip if crypto.ai has no newsvendor EO) |
| 4 | **Common-fold scoring** — engines compared on the folds all of them completed | `services/calibration.py`, `services/orchestration.py` | Methodology bug |
| 5 | **Global top-N membership** — composition/per-key vectors restricted to one top-N set | `services/orchestration.py` | Correctness vs documented semantics |
| 6 | **`calibrated_basis`** staleness (grain/metric/top-N, not just slugs) + frontend legacy-NULL-grain fix | model + migration + routes + frontend | Silent-staleness bug |
| 7 | New calibration metrics: **`smase`** (seasonal-naive MASE) and **`crps`** (wQL) | `services/calibration.py` + schemas + frontend | Feature |
| 8 | **Dynamic per-step reweighting** (Synapse's adaptive loop), opt-in, default OFF | `prediction/blending.py`, `prediction/engines/blending.py` | Feature + evaluation |

Plus one guard: the **simulation must refuse non-ready orchestration groups** exactly like `create_prediction` does (a draft/failed group has an empty composition, which silently degrades the simulation to a single default engine).

Tests: `tests/test_prediction/test_blending.py` (24 tests) and `tests/test_prediction/test_calibration.py` (14 tests) are **repo-agnostic** except for two engine-enum slugs — copy them wholesale and adjust `SLUG_A`/`SLUG_B`.

---

## 1. Blend quantile level-map fix (the big one)

**The bug.** The predictive-sampling blend draws deterministic stratified samples from each engine's quantile-defined distribution at levels confined to `[0.1, 0.9]` (engines expose 9 quantiles, P10..P90; no tail extrapolation). The blended quantiles were then read as `np.percentile(pool, q*100)`. But the α-percentile of samples whose *levels* are uniform on [0.1, 0.9] estimates the mixture quantile at `0.1 + 0.8α`, not α. Result: reported P10 was really ~P18, P90 ~P82 — every orchestrated forecast understated uncertainty by ~20% in level space. The tell: blending a **single** engine with weight 1.0 did not return that engine's own quantiles.

**The fix.** Read pooled percentiles through the inverse map:

```python
_LEVEL_LO, _LEVEL_HI = 0.1, 0.9
_LEVEL_SPAN = _LEVEL_HI - _LEVEL_LO

def _pool_percentile(level: float) -> float:
    """Map a quantile level to the percentile of the [P10,P90]-sampled pool."""
    return (level - _LEVEL_LO) / _LEVEL_SPAN * 100.0

# in the per-step blend:
empirical_quantiles = [float(np.percentile(arr, _pool_percentile(q))) for q in QUANTILE_LEVELS]
predicted_value = float(np.percentile(arr, _pool_percentile(0.5)))   # == median, unchanged
lower_bound     = float(np.percentile(arr, _pool_percentile(0.1)))   # == min of pool
upper_bound     = float(np.percentile(arr, _pool_percentile(0.9)))   # == max of pool
```

Why this is exact: each engine truncates exactly 10% of mass on each side *in its own level space*, so wherever no engine's CDF is clipped at the read point, pool-CDF(x) = (mixture-CDF(x) − 0.1)/0.8 and the map inverts it exactly. When engines disagree wildly there is a small bounded clipping error — acceptable, and infinitely better than the systematic compression. (Synapse instead samples `p ~ U(0,1)` with linear tail extrapolation beyond [P10,P90]; the inverse map achieves the same correctness without inventing tails.)

**Invariant test (add it):** blending one engine with weight 1.0 returns its own quantiles/bounds/median to within stratification tolerance (atol ≈ 0.3 at 1000 samples).

**Refactor note:** gorm.ai extracted the per-step logic into `_blend_step(date_idx, predictions_by_engine, norm_weights, engine_slugs)` shared by the static and dynamic blend functions. Recommended — change #8 needs it.

---

## 2. Point-mass contribution for quantile-less engines

**The bug (found by the evaluation, not the review).** In the sampling loop, an engine whose `PredictionResult.quantiles` is `None`/unusable contributed **no samples**. If *any* other engine had quantiles, the pool was non-empty, so the point-fallback branch never ran — the quantile-less engine's entire weight silently redistributed to the others. Observed effect: a 50/50 timesfm/statistical blend was numerically identical to pure timesfm to 4 decimals.

**The fix.** A point-only engine contributes its point forecast as a **point mass** (degenerate distribution) at its weight:

```python
n_engine_samples = max(1, int(round(_N_SAMPLES * weight)))
qv = np.asarray(pred.quantiles, dtype=float) if pred.quantiles else np.array([])
qv = qv[np.isfinite(qv)]
if qv.size == 0:
    if pv is not None and np.isfinite(pv):
        pooled_samples.extend([max(float(pv), 0.0)] * n_engine_samples)  # point mass
    continue
qv = np.sort(qv)
# ... existing stratified interpolation over qv ...
```

Consequence: two point-only engines at 10/20 now produce a blend with median 15, lower 10, upper 20 (ensemble spread as uncertainty) instead of `quantiles=None`. The old "no engine has quantiles" fallback branch remains only for the nothing-usable case. **Update the corresponding test** if the fork asserts `quantiles is None` for point-only blends.

**crypto.ai note:** the `max(..., 0.0)` clamps assume non-negative targets (sales units). If crypto blends anything that can be negative (returns, log-prices), drop the clamps — check what the fork's engines emit.

---

## 3. `economic_optimal` blending

**The bug.** The blend set `economic_optimal = predicted_value` (median), discarding each engine's newsvendor critical-fractile quantile — so orchestrated strategies silently ordered at P50 with no margin-driven buffer.

**The fix.** Weight-average the sub-engines' EO values, renormalized over engines that produced one; fall back to the blend median only when none did:

```python
eo_contributions: list[tuple[float, float]] = []   # (weight, eo) collected in the engine loop
...
def blended_eo(default: float) -> float:
    if not eo_contributions:
        return default
    wsum = sum(w for w, _ in eo_contributions)
    if wsum <= 0:
        return float(np.mean([e for _, e in eo_contributions]))
    return sum(w * e for w, e in eo_contributions) / wsum
```

(Weighted average of per-engine quantiles-at-τ is a Vincentized mixture quantile — fine here.)

**crypto.ai note:** if the fork stripped the newsvendor/economic-optimal concept (likely for klines), **skip this change** — but verify the blend isn't overwriting some other engine-computed field the same way.

---

## 4. Common-fold scoring in calibration

**The bug.** Each engine's backtest score was the mean over *the folds it survived*. An engine that crashes or returns non-finite on hard windows got averaged over only its easy survivors — selection favored fragile engines. (TSorchestra avoids this by dropping rows where *any* model is NaN.)

**The fix — two halves.**

*(a) Scoring returns per-fold scores.* `_score_engine_over_series` returns `{fold_id: score}` with `fold_id = f"{series_idx}:{origin_idx}"`, and `score_engine_keys` returns `{key: {fold_id: score}}` (a failed fold is simply absent; a key with an empty dict = engine never scored it). **Critical invariant: fold ids must mean the same (series, window) for every engine.** That requires deterministic series ordering and origin construction — in gorm.ai: keys sorted (by volume for outlet/product grains, lexically for the pooled customer grain), even-stride sampling when capped, and `_build_origins` depends only on series length. If crypto.ai's equivalent iterates a dict in query order, **sort it**.

*(b) Aggregation on common folds.* In `combine_engine_scores`, per key:

```python
def key_scores(key: str) -> dict[str, float]:
    per_engine: dict[str, dict[str, float]] = {}
    for slug, per_key in scores_by_engine.items():
        if key not in per_key:
            continue
        folds = per_key[key]
        if isinstance(folds, dict):
            per_engine[slug] = {f: float(v) for f, v in folds.items()
                                if isinstance(v, (int, float)) and math.isfinite(float(v))}
        elif isinstance(folds, (int, float)) and math.isfinite(float(folds)):
            per_engine[slug] = {"__avg__": float(folds)}   # legacy scalar payload
        else:
            per_engine[slug] = {}

    scored = [set(f) for f in per_engine.values() if f]
    common = set.intersection(*scored) if scored else set()

    scores = {}
    for slug, folds in per_engine.items():
        if not folds:
            scores[slug] = float("inf")                       # never scored → zero weight
        elif common:
            scores[slug] = float(np.mean([folds[f] for f in common]))
        else:
            scores[slug] = float(np.mean(list(folds.values())))  # disjoint folds — best we can do
    return scores
```

The legacy-scalar branch keeps old Celery payloads/inline callers working during the transition. The distributed chord (`score_engine_task` → `finalize_calibration_task`) needs **no change** — the per-fold dicts are plain JSON.

---

## 5. Global top-N membership

**The bug.** For per-key grains (outlet/product), the group default `model_composition` was the average of per-key **top-N** vectors — whose key-union can be the entire pool. So "the selected top-N models" could be 8 models, `selected_slugs()`/Reweight operated on that union, and the UI table showed more rows than `top_n`.

**The fix.** Selection makes **one** membership decision:

```python
# per-key inverse-error vectors over the FULL pool (no cut), then:
avg_full = self._average_vectors(list(full_vectors.values()))
membership = {s for s, _ in sorted(avg_full.items(), key=lambda x: x[1], reverse=True)[:top_n]}
# restrict every per-key vector to membership and renormalize
# (inverse-error weights ∝ 1/err, so renormalizing a subset == recomputing on it)
```

`weights_by_key` = restricted vectors; `model_composition` = normalized average of those. The customer/pooled grain keeps its single top-N cut on the `__pooled__` vector. Also filter `w > 0` before ranking so inf-scored engines can't occupy membership slots.

---

## 6. `calibrated_basis` staleness + frontend legacy-grain fix

**The bugs.** (a) Staleness detection only compared the engine pool (`calibrated_slugs`), so editing **grain / metric / top-N** left stale weights in place with no flag — and a grain change is nasty: `weights_by_key` keeps old-grain keys while the group claims the new grain, so the grain-compat guard passes and every series silently falls back to the default vector. (b) The frontend seeded a NULL `prediction_target` (legacy = *outlet* on the backend) as `"customer"` — saving any unrelated field silently rewrote the group's grain.

**The fix.**

- New JSON column on `orchestration_groups` (alembic migration, `server_default='{}'`):
  ```python
  calibrated_basis: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
  # {"slugs": [...], "prediction_target": ..., "metric": ..., "top_n": ...}
  ```
- Written in `store_calibration_result` on **every** calibration: any run (Selection or Reweight) executes at the *current* grain/metric/top_n, so those always refresh; only the pool snapshot is Selection-specific:
  ```python
  prior_basis = dict(group.calibrated_basis or {})
  group.calibrated_basis = {
      "slugs": (list(group.engine_slugs or []) if is_selection
                else prior_basis.get("slugs", list(group.calibrated_slugs or []))),
      "prediction_target": group.prediction_target,
      "metric": group.calibration_metric,
      "top_n": group.top_n,
  }
  ```
- Exposed in the detail response schema/route; frontend `isStale` compares saved config against the basis (sorted-slug equality + target with `?? "outlet"` on both sides + metric + top_n), falling back to the old `calibrated_slugs` check for legacy groups with no basis. `configChanged` (unsaved metric/topN/target edits) also triggers the "Initiate" bar, same as `modelsChanged`.
- Frontend: every `group.prediction_target ?? "customer"` in the detail pane becomes `?? "outlet"` (draft seeding, dirty comparison, cancel-reset).

**crypto.ai note:** grain names differ in the fork (symbols/intervals rather than outlets/products) — port the *mechanism*, map the grain vocabulary. Check what the fork's backend treats NULL grain as before choosing the frontend default.

---

## 7. New metrics: `smase` and `crps`

`MetricType` everywhere becomes `Literal["mase", "smase", "mae", "mape", "rmse", "crps"]` (services + schemas + frontend union type + both metric `<select>`s + help strings). `"mase"` is untouched for backward comparability.

- **`smase`** — MASE with the *seasonal* naive denominator `mean(|x[m:] − x[:-m]|)` over the training series, falling back to lag-1 when the series is shorter than the season:
  ```python
  m = season if metric == "smase" else 1
  # gorm.ai: def _season_for(frequency): return 7 if frequency == "daily" else 1
  ```
  **crypto.ai note:** this is the one truly domain-specific choice. Retail dailies have a weekly cycle (m=7). For crypto klines pick per interval — e.g. m=24 for hourly (daily cycle), m=7 for daily if you believe in a weekly effect, else m=1. Wire `_season_for` to the fork's interval vocabulary.
- **`crps`** — mean pinball loss over the 9 quantile levels, ×2, normalized by the test window's mean |actual| (weighted quantile loss, the GIFT-Eval convention; scale-free so it pools across series). Requires fold quantiles: `_predict_for_fold` now returns `(points, horizon×9 quantile matrix)`, with per-step fallback to the point value at all levels when an engine has no quantiles (degrades to 0.5·|error|, keeping such engines comparable rather than excluded):
  ```python
  denom = float(np.mean(np.abs(actual)))
  if denom <= 1e-10: return float("inf")
  errors = actual.reshape(-1, 1) - q                      # q: (h, 9)
  levels = QUANTILE_LEVELS.reshape(1, -1)
  pinball = np.where(errors >= 0, levels * errors, (levels - 1) * errors)
  return 2.0 * float(np.mean(pinball)) / denom
  ```
  **crypto.ai note:** the |actual|-normalization assumes a positive-level target (prices, volume). It is fine for those; do **not** use it on signed returns without changing the denominator.

All three `_predict_for_fold` call sites (outlet legacy, pooled, per-engine scorer) unpack the tuple and pass `quantiles=`/`season=`.

---

## 8. Dynamic per-step reweighting (Synapse's adaptive loop) — opt-in

Implements the half of Synapse gorm.ai lacked: per-horizon-step weight adaptation via forward simulation. `blend_predictions_dynamic_reweight(predictions_by_engine, weights, engine_slugs, prior_strength=3.0)`:

1. Blend step *t* with current weights (same `_blend_step`).
2. Pseudo-ground-truth `y_sim` = the blend median at *t* (no actuals exist inside the horizon).
3. Per engine: CRPS of its step-*t* forecast against `y_sim` (mean pinball over the 9 levels; point-only engines: `0.5·|pv − y_sim|`), accumulated over the steps so far.
4. Next step's weights shrink from the calibrated prior toward inverse-CRPS as evidence accumulates:
   `w ∝ (K·w_prior + n_t·w_crps) / (K + n_t)` with `K = prior_strength`, `n_t` = mean number of scored steps. The prior anchoring mitigates the confirmation-bias failure mode the Synapse paper itself flags for its pure self-referential loop (their `W_init` seeding is unspecified in the paper; our calibrated static weights are a strictly better seed).

Wiring: `BlendingEngine(dynamic_reweight=False, prior_strength=3.0)` + an `apply_parameters` override so it can be toggled per strategy through the existing engine-params mechanism (slug `"blending"`): `{"dynamic_reweight": "true", "prior_strength": "5"}`. **Default OFF.**

### Evaluation (do re-run this in crypto.ai — the verdict may flip)

Harness: `scripts/eval_dynamic_reweight.py` — rolling-origin backtest on real data mirroring production calibration (first 3 origins → static weights via the real `combine_engine_scores`; last ~3 origins held out; compares each single engine, static blend, dynamic blend, uniform blend on sMASE + CRPS). gorm.ai ran it inside the worker container (local venv has no ML deps): `docker cp` the script, then `docker exec -e DATABASE_URL=... <worker> python /tmp/eval_dynamic_reweight.py <customer_id> 12`.

gorm.ai results (newspaper dailies, 4-engine pool: timesfm / chronos-bolt / sundial / statistical):

| | Chicago Sun Times (sMASE mean/med) | Philly Inquirer (sMASE mean/med) |
|---|---|---|
| best single (timesfm) | 0.942 / 0.922 | 0.998 / 0.797 |
| static calibrated blend | **0.866** / 0.796 | 1.128 / 0.953 |
| dynamic blend | 0.912 / 0.759 | 1.189 / 1.006 |
| uniform blend | 1.641 / 0.792 | 1.129 / 0.955 |

Dynamic was **~5% worse mean sMASE, 27–28% fold win rate, on both customers** → shipped default-off for gorm.ai. **But**: Synapse's own ablation shows the dynamic loop's gains concentrate on lumpy, non-stationary domains (their Web/CloudOps: MASE 0.808→0.690) and vanish on smooth seasonal data. Crypto klines are firmly in the first category, so crypto.ai is exactly where this *might* pay off — port the flag *and the eval script*, run it on real symbols, and decide on evidence. Secondary gorm.ai finding worth replicating: near-uniform calibrated weights (Philly) meant calibration found no signal separating engines, and the blend underperformed the best single engine — a near-uniform Selection result is a warning sign worth surfacing.

---

## 9. Simulation guard

`run_simulation` (and any strategy-driven backtest path) must mirror `create_prediction`'s refusal of a non-ready orchestration group. Without it, a draft/failed group has an empty `model_composition`, the `if orchestration_weights:` check is falsy, and the simulation silently runs a single default engine while claiming to test the orchestrated strategy:

```python
if strategy.orchestration_group_id and strategy.orchestration_group:
    og = strategy.orchestration_group
    if og.status != "ready":
        raise ValueError(f"Orchestration group '{og.name}' is not ready (status: {og.status}). ...")
```

---

## 10. Tests & verification checklist

Copy `tests/test_prediction/test_blending.py` and `tests/test_prediction/test_calibration.py` — they use no DB (services instantiated with `session=None`; `BlendingEngine` gets a fake registry). Only adjust the two engine-enum slugs (`SLUG_A`/`SLUG_B`) to members that exist in the fork's `PredictionEngine` enum, and the point-only-blend expectations if you dropped the `max(…, 0.0)` clamps (§2 note).

Verify, in order:

1. `pytest tests/test_prediction/ -q` — the 38 tests pass. The load-bearing ones: single-engine identity blend (§1), point-mass weight preservation (§2), common-fold flattery test (§4: engine failing the hard fold ends up *equal*, not ahead), global top-N membership (§5).
2. `alembic upgrade head` applies the `calibrated_basis` migration.
3. Frontend typechecks (`npx tsc --noEmit`); both metric selects show 6 options; a legacy NULL-grain group survives an unrelated edit+save without its grain changing.
4. Run a real Selection end-to-end (distributed chord) — confirms the per-fold payload shape flows through Celery JSON and `finalize_calibration_task` unchanged.
5. Port `scripts/eval_dynamic_reweight.py`, run on 2 symbols/customers, and record the static-vs-dynamic verdict for the fork's domain before deciding the default.

## Known non-goals (reviewed, deliberately not done — consider for the fork too)

- No guard against **concurrent calibrations** (two dispatches race, last write wins) and no stuck-status recovery if a chord dies mid-run (group stays `selecting` forever).
- The **legacy per-outlet calibration path** (`OutletEngineWeights`, `calibrate_outlet_weights`, `/calibrate-engines` routes) is unused by prediction and still has bugs (mixes calibration dates in `get_outlet_engines`; no gap densification). Candidate for removal rather than porting.
- `last_calibration_score` column is written by nothing and always NULL in the API.
