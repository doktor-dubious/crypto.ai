# Handover: Foundation-Model Engines — TTM-r3, TabPFN-TS, FlowState r1.1, Chronos-2, Toto 2.0

**Audience:** Claude (or an engineer) implementing these time-series foundation models in **another project**.
**Source:** Reference implementation in the `gorm.ai` forecasting backend (FastAPI + Celery, Python 3.11, `uv`). Verified working June 2026.
**What this covers:** two *new* engines (IBM TinyTimeMixer / TTM, and TabPFN-TS) and three *model updates* (FlowState → r1.1, Chronos-2 to the real model, Toto → 2.0).

This document is self-contained: it gives the package, import, model IDs, the exact inference call + output shape, and the gotchas for each model. The gorm.ai engine class structure is included as **reference only** — your project's architecture will differ, so the portable parts are the **model APIs**, the **dependency/conflict story**, and the **deployment topology**.

> **Knowledge-cutoff caveat:** model package APIs move fast. Where an API is given, treat it as "what worked in June 2026" and cross-check against the upstream README/release notes before relying on it — especially Chronos-2 (`predict_df` signature) and TTM-r3 (checkpoint id not yet published as of writing).

---

## 0. TL;DR — what to install where

| Engine | Package(s) | Model id (default) | Quantiles? | Device | Python |
|---|---|---|---|---|---|
| **FlowState r1.1** | `granite-tsfm` (gift-flowstate branch) → `tsfm_public` | `ibm-granite/granite-timeseries-flowstate-r1` **@ revision `r1.1`** | native (9) | CPU/GPU | 3.11 |
| **TTM (r2/r3)** | `tsfm_public` (same as FlowState — no extra dep) | `ibm-granite/granite-timeseries-ttm-r2` (r3 when published) | **point only → synthesise** | CPU/GPU | 3.11 |
| **TabPFN-TS** | `tabpfn-time-series` + `tabpfn>=6.0.6` (local) | `tabpfn-ts` (TabPFN-TS-3 auto-downloads) | native (9) | CPU/GPU(rec) | 3.11 |
| **Chronos-2** | `chronos-forecasting>=2.2.0` | `amazon/chronos-2` | native | CPU/GPU | 3.11 |
| **Toto 2.0** | `toto-models` → `import toto2` | `Datadog/Toto-2.0-313m` | native (9) | CPU/GPU | **3.12+** |

**Critical dependency fact:** several of these have *mutually incompatible* transformers/gluonts pins. They **cannot all live in one environment**. Run conflicting groups in **separate worker processes/images** (see §7). The grouping that works:

- **"granite" worker** (`transformers<4.51`): FlowState + TTM (+ TSPulse, all from `tsfm_public`).
- **"tabpfn" worker**: TabPFN-TS (conflicts with flowstate/toto/autogluon/moirai/yinglong/kairos).
- **"toto2" worker**: Toto 2.0 — needs a **Python 3.12** base image.
- **default/ml worker**: Chronos-2 (chronos-forecasting is generally compatible with the base stack).

---

## 1. FlowState r1.1 (model update)

IBM Research State-Space Model, 18.5M params, 4096 context, Functional Basis Decoder → outputs 9 quantiles directly in one forward pass.

- **Package:** `granite-tsfm @ git+https://github.com/ibm-granite/granite-tsfm@gift-flowstate` (imports as `tsfm_public`). Pins `transformers<4.51`.
- **What changed for r1.1:** same repo, loaded as a **HuggingFace revision**:
  - `DEFAULT_MODEL_ID = "ibm-granite/granite-timeseries-flowstate-r1"`
  - `DEFAULT_REVISION = "r1.1"` ← the update (was `"main"`, which still holds original r1: 9M params, 2048 context).
  - r1.1 = 18.5M params, 4096 context, adds output gating on the S5 encoder for noisier series.
- **Load:**
  ```python
  from tsfm_public import FlowStateForPrediction  # exact import path per granite-tsfm
  model = FlowStateForPrediction.from_pretrained(model_id, revision="r1.1")
  ```
- **Key parameter — `scale_factor = 24 / N`** where N = timesteps per repeating cycle. This encodes the sampling rate and materially affects quality:
  - 15-min: 0.25 · hourly: 1.0 · **daily w/ weekly seasonality: 24/7 ≈ 3.43** · monthly: 2.0
- **Output:** 9 quantiles `[0.1..0.9]` per step; index 4 = median = point forecast.
- **To do the update in another project:** bump the loaded revision to `r1.1` and confirm `scale_factor` matches your data cadence.

---

## 2. IBM TinyTimeMixer / TTM (new engine; target r3)

Compact (~1–5M param) multivariate forecaster, same `tsfm_public` package as FlowState — **no new dependency** if you already have the granite worker.

- **Model ids:** `ibm-granite/granite-timeseries-ttm-r2` (confirmed working), `...-ttm-r1`. **r3: not published under a confirmed id as of June 2026** — wire the checkpoint id as a configurable parameter and switch to the r3 id once IBM publishes it. Don't hard-code r3.
- **Window-specific!** Each sub-model is pretrained for a fixed `(context_length, prediction_length)`. Available windows (r2 family): context ∈ `{512, 1024, 1536}`, horizon ∈ `{96, 192, 336, 720}`.
- **Load (per window shape, cache by `(context, horizon)`):**
  ```python
  from tsfm_public.toolkit.get_model import get_model
  model = get_model(model_id, context_length=C, prediction_length=P)  # pick smallest window >= request
  model = model.to(device=device, dtype=torch.float32).eval()
  ```
- **Inference (point forecast only):**
  ```python
  # left-pad (or truncate) the series to EXACTLY context_length C:
  past = torch.tensor(ctx, dtype=dtype, device=device).reshape(1, C, 1)  # (batch, context, channels)
  out = model(past_values=past)
  point = out.prediction_outputs[0, :, 0].cpu().numpy()[:horizon]       # (horizon,)
  ```
- **No quantile head.** If you need uncertainty bands (newsvendor / safety stock), **synthesise a Gaussian band**:
  - `sigma = std(diff(values))` (first-difference volatility), floor at a tiny epsilon;
  - widen per step with the random-walk rule: `spread[t, :] = sigma * sqrt(t+1) * Z` where `Z` are the standard-normal z-scores for P10..P90 `[-1.28155, -0.84162, -0.52440, -0.25335, 0, 0.25335, 0.52440, 0.84162, 1.28155]`;
  - `quantiles = point[:, None] + spread`, then `np.sort(axis=1)`. Median (index 4) == point.
  - Flag this clearly as an approximation — it is not a learned predictive distribution.
- **Device:** CPU or GPU.

---

## 3. TabPFN-TS (new engine) — LOCAL-ONLY, fail-closed

Reframes forecasting as tabular in-context regression over the TabPFN-v2 foundation model. **Strength: short / sparse / cold-start series** (min history ~3), complementing the pretrained sequence models.

- **Packages:** `tabpfn-time-series` **and** `tabpfn>=6.0.6`. The local `tabpfn` package is **mandatory**.
- **DATA-RESIDENCY WARNING:** TabPFN-TS can run against Prior Labs' **cloud** API (`TabPFNMode.CLIENT`), which transmits your series off-box. To prevent that, the reference engine is deliberately **local-only and fail-closed**:
  1. require **both** `import tabpfn` and `import tabpfn_time_series` — if the local backend isn't importable, report **unavailable** and fall back to a statistical model. **Never silently switch to the cloud client.**
  2. construct with explicit local mode: `TabPFNTSPipeline(tabpfn_mode=TabPFNMode.LOCAL)`.
  3. `os.environ.setdefault("TABPFN_DISABLE_TELEMETRY", "1")`.
  - If you port this, **keep the fail-closed behaviour** unless your project explicitly allows cloud inference.
- **Load:**
  ```python
  from tabpfn_time_series import TabPFNMode, TabPFNTSPipeline
  pipe = TabPFNTSPipeline(tabpfn_mode=TabPFNMode.LOCAL)   # TabPFN-TS-3 checkpoint downloads on first use
  ```
- **Inference (per series, `predict_df`):**
  ```python
  import pandas as pd
  hist_dates = pd.date_range("2000-01-01", periods=len(values), freq="D")  # calendar-agnostic anchor
  context_df = pd.DataFrame({"item_id": 0, "timestamp": hist_dates, "target": values})
  pred_df = pipe.predict_df(context_df, prediction_length=horizon, quantiles=[0.1,0.2,...,0.9])
  pred_df = pred_df.reset_index().sort_values("timestamp")
  # quantile column names vary — resolve robustly (try "0.1","0.10",numeric round) then np.sort(axis=1)
  ```
- **License:** requires accepting the Prior Labs license. GPU recommended, not required.
- **Caveat:** quantile column labels from `predict_df` are not stable across versions — resolve them defensively (match `f"{q:g}"`, `str(q)`, `f"{q:.2f}"`, and numeric-rounded column names).

---

## 4. Chronos-2 (model update) — use the REAL model

**Pitfall this update fixes:** it is easy to ship a "Chronos-2" engine that actually loads a **Chronos v1** checkpoint (e.g. `amazon/chronos-t5-small`) — the names look similar and the old `chronos-forecasting` API differs. Confirm you are loading **`amazon/chronos-2`** via the v2 pipeline, not a t5 v1 model. *(In the gorm.ai repo the v2 rewrite was reverted, so its current `chronos2_direct_engine.py` still points at `chronos-t5-small` — do NOT copy that file; follow the API below.)*

- **Package:** `chronos-forecasting>=2.2.0` (the v2 pipeline requires the 2.x line; the gorm.ai repo's pin reverted to `>=1.4.0` along with the engine revert).
- **Model:** `amazon/chronos-2`. **Native multivariate + covariate support** (a major reason to adopt v2) via extra columns in the dataframe.
- **API is real and settled** — verified against the installed **`chronos-forecasting==2.2.2`** (the `>=1.4.0` floor resolves up to 2.x). The package exposes `Chronos2Pipeline`, `Chronos2Model`, and `BaseChronosPipeline.predict_df`. This is NOT the reverted `chronos-t5-small` engine file — write a fresh engine against the API below.
- **Load + inference (`predict_df`) — exact signature from 2.2.2:**
  ```python
  from chronos import Chronos2Pipeline
  pipe = Chronos2Pipeline.from_pretrained("amazon/chronos-2")  # from_pretrained(model_id, *args, **kwargs)
  #   pass HF kwargs through, e.g. device_map="cuda", torch_dtype="auto"
  out = pipe.predict_df(
      df,                                   # long format
      future_df=None,                       # known-future covariates (optional)
      id_column="item_id",
      timestamp_column="timestamp",
      target="target",                      # str or list[str] (multivariate)
      prediction_length=horizon,
      quantile_levels=[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9],
      context_length=None,                  # None = use all history
      batch_size=256,
  )  # -> long-format DataFrame with quantile columns
  ```
- **Native covariates (a key reason to adopt v2):** extra columns in `df` are treated as **past-only** covariates; columns present in `future_df` are treated as **known-future** covariates. Prefer this over the Ridge-on-residuals path (§6) for this engine.
- **GOTCHA — regular timestamps required:** all series must have **regular timestamps at the same frequency with no gaps**. Fill/resample your series before calling `predict_df` (relevant for irregular or partially-missing data; crypto klines are 24/7 but still must be gap-free). There is also a lower-level tensor API `pipe.predict(inputs, prediction_length=...) -> list[torch.Tensor]` if you don't want the DataFrame path.
- **Why update:** real Chronos-2 brings native covariates and better accuracy vs the t5 v1 model the old engine was mistakenly running.
- **Ready-to-copy engine:** a full drop-in engine class (matching the `ChronosPipelineEngine` contract, verified against 2.2.2) is provided alongside this doc as **`chronos2_engine.py`**. Fix the import paths + registration (see the checklist in its header) and it runs.

---

## 5. Toto 2.0 (model update) — separate package, Python 3.12

Datadog's Toto 2.0 is a **different distribution** from the original Toto (`Datadog/Toto-Open-Base-1.0`, package `toto-ts`). 2.0 returns nine quantiles **directly** from `forecast()` (1.0 used a Student-T mixture with Monte-Carlo sampling).

- **Package:** `toto-models` → `import toto2`. **Requires Python ≥ 3.12** (gate it in your dependency markers; install in a 3.12 worker/image). Keeps it isolated from the 1.0 engine.
- **Checkpoints:** `Datadog/Toto-2.0-{4m,22m,313m,1B,2.5B}`. **Default 313m.** Make size a per-engine parameter.
- **Load:**
  ```python
  import torch
  from toto2 import Toto2Model
  model = Toto2Model.from_pretrained(model_id, map_location=device)
  model = model.to(device=device, dtype=torch.float32).eval()   # float32 avoids CPU mat1/mat2 dtype mismatch
  ```
- **Inference (per univariate series):**
  ```python
  target = torch.tensor(values, dtype=dtype, device=device).reshape(1, 1, -1)  # (batch, n_var, time)
  target_mask = torch.ones_like(target, dtype=torch.bool)
  series_ids = torch.zeros(1, 1, dtype=torch.long, device=device)
  q = model.forecast({"target": target, "target_mask": target_mask, "series_ids": series_ids},
                     horizon=horizon)
  # q shape: (9, batch, n_var, horizon) at levels [0.1..0.9]
  quantiles = q[:, 0, 0, :].cpu().numpy().T      # (horizon, 9)
  quantiles = np.sort(quantiles, axis=1)         # enforce monotonic
  point = quantiles[:, 4]                         # median
  ```
- **Device:** CPU or GPU; use **float32** unless you've confirmed bfloat16 on your GPU.

---

## 6. Covariate handling (portable pattern)

Of these models, only **Chronos-2** has a first-class covariate API; TTM/TabPFN/Toto-2/FlowState are used here without native exogenous inputs. The reference project applies a **model-agnostic external covariate adjustment**: fit `Ridge` (sklearn, `alpha=1.0`) on the **residuals** of the base point forecast against covariate features (weekday one-hots, price/financials, event flags), then add the Ridge prediction over the future covariate matrix to the base forecast and to every quantile.

```python
residuals = values[-k:] - base_pred[0]          # k = min(len(values), horizon)
ridge = Ridge(alpha=1.0, fit_intercept=True).fit(hist_X[-k:], residuals)
adj = ridge.predict(fut_X)                        # (horizon,)
final_pred = base_pred + adj                      # also add adj[:, None] to the quantile band
```

This is portable to any engine that yields a point forecast. If you adopt Chronos-2, prefer its **native** covariates over this Ridge path for that engine.

---

## 7. Deployment topology (the part that bites)

The transformers/gluonts/python pins are mutually exclusive across these models. Resolve by **isolation**, not by forcing one environment:

- **Optional dependency groups (extras).** Define one extra per model group, e.g. `flowstate`, `tabpfn`, `toto2`, `chronos`. With `uv`, declare incompatibilities so the lock resolves:
  ```toml
  [tool.uv]
  conflicts = [
    [{ extra = "flowstate" }, { extra = "tabpfn" }],
    [{ extra = "flowstate" }, { extra = "yinglong" }],   # transformers<4.51 vs >=4.57.6
    [{ extra = "tabpfn" },    { extra = "toto" }],
    # …one entry per conflicting pair
  ]
  toto2 = ["toto-models; python_version >= '3.12'"]        # marker so a 3.11 lock still resolves
  ```
- **One worker process per conflicting group.** In the reference (Docker + Celery), each worker image is built with a different `EXTRAS` build-arg and listens on its own queue; tasks are routed to the worker that carries the model:
  - granite worker: `EXTRAS="ml flowstate"` → FlowState + TTM (+ TSPulse).
  - tabpfn worker: `EXTRAS="ml tabpfn"`.
  - toto2 worker: needs a **`python:3.12`** base image + `toto2` extra.
  - chronos-2: fits in the default ml worker.
- **HuggingFace cache:** set `HF_HUB_CACHE` to a persistent, shared volume so large checkpoints (esp. Toto-2.0-1B/2.5B) download once. Set `HF_TOKEN` if any checkpoint is gated.
- **Fail-closed loading:** on any model-load exception, mark the engine unavailable and fall back (statistical / another engine) rather than crashing the request. For TabPFN specifically, "unavailable" must **never** mean "use the cloud."
- **Lazy, load-once:** load the model on first prediction and cache it on the worker for the process lifetime (avoids per-request reloads). TTM additionally caches one sub-model per `(context, horizon)` window.

---

## 8. Reference engine contract (gorm.ai-specific — adapt to your architecture)

In gorm.ai each engine subclasses a shared base (`ChronosPipelineEngine`) that owns preprocessing (normalise/fill), batching, denormalisation, the Ridge covariate path, and per-date event/weekday adjustments. A concrete engine implements:

- `get_capabilities()` → declares `supports_uncertainty/exogenous/multivariate`, `min/max_history`, `max_horizon`, frequencies.
- `estimate_memory(...)` → rough MB estimate for scheduling.
- `_check_<pkg>()` → cached import probe (sets a module-level availability flag).
- `_load_model()` → set `self._pipeline` to the loaded model, or `None` on failure (triggers fallback).
- `_run_batch_inference(batch, horizon) -> (results, ridge_infos)` where each result is the tuple `(pred, lower, upper, all_quantiles)` as numpy arrays, and the per-item `item` dict provides `values` (normalised), `hist_X`, `fut_X`, `feature_names`, `covariate_handling`.

Then **register** the engine (enum value + registry mapping; and a DB row if your engine list is DB-driven).

If your project doesn't have this base class, the only things you must reproduce are: load-once caching, the per-model inference call from §1–5, optional Ridge covariates from §6, and quantile-band handling (native for FlowState/Chronos-2/Toto-2/TabPFN; **synthesised** for TTM).

---

## 9. Verification checklist (per engine)

1. `import` of the model package succeeds in the target worker (`python -c "import tsfm_public"` / `import toto2` / `import tabpfn, tabpfn_time_series` / `from chronos import Chronos2Pipeline`).
2. Model loads from HF (watch logs for the checkpoint id + revision actually loaded — confirm it's the *intended* model, not a v1 fallback).
3. A single-series forecast returns a `(horizon,)` point and a `(horizon, 9)` monotonic quantile band.
4. Quantiles are non-crossing (`np.sort(axis=1)`), and the median equals the point forecast.
5. With covariates supplied, the Ridge adjustment (or native covariates for Chronos-2) changes the forecast as expected.
6. On a worker *without* the package installed, the engine reports unavailable and falls back — and TabPFN never reaches for the cloud.
7. Backtest a few series against your existing engines (MASE/MAE) to confirm the integration is sane, not just non-crashing.

---

### Companion drop-in files (in this same folder)

Ready-to-copy engine classes, written to the shared `ChronosPipelineEngine`
contract. Fix the `from crypto_ai.prediction...` imports to your package name and
follow each file's header INTEGRATION CHECKLIST.

- **`chronos2_engine.py`** — Chronos-2 (`amazon/chronos-2`, `predict_df`). Verified against `chronos-forecasting==2.2.2`.
- **`ttm_engine.py`** — IBM TinyTimeMixer (windowing + synthetic quantiles; `r1`/`r2`/`r3` aliases).
- **`tabpfn_engine.py`** — TabPFN-TS (local-only, fail-closed).
- **`toto2_engine.py`** — Toto 2.0 (`toto2` package; needs Python 3.12 worker).
- **`flowstate_update.md`** — FlowState → r1.1 patch note (update to an existing engine, not a new file).
- **`registration.md`** — enum values, registry lines, and DB `prediction_engine`/parameter INSERTs for all the above, in one place.

All four `.py` engines assume your project already has a `ChronosPipelineEngine`
base (with `_residual_ridge_adjustment`, batching, and normalise/denormalise) and
an `EngineCapabilities`/`MemoryEstimate` API. If it doesn't, see §8 for the minimal
contract each one relies on.

---

### Appendix — exact source files in gorm.ai (for copy/reference)

- `src/gorm_ai/prediction/engines/flowstate_engine.py` — FlowState (r1.1 revision, scale_factor).
- `src/gorm_ai/prediction/engines/ttm_engine.py` — TTM (windowing + synthetic quantiles).
- `src/gorm_ai/prediction/engines/tabpfn_engine.py` — TabPFN-TS (local-only, fail-closed).
- `src/gorm_ai/prediction/engines/toto2_direct_engine.py` — Toto 2.0 (`toto2` package).
- `src/gorm_ai/prediction/engines/chronos2_direct_engine.py` — ⚠️ currently reverted to chronos-t5-small (v1); use §4 API, not this file.
- `src/gorm_ai/prediction/engines/chronos_pipeline_engine.py` — shared base: `_residual_ridge_adjustment`, batching, denormalisation.
- `pyproject.toml` `[project.optional-dependencies]` + `[tool.uv] conflicts` — the extras/conflict matrix.
- `docker-compose.yml` (`celery-worker-granite`, `celery-worker-tabpfn`) + `Dockerfile` (`ARG EXTRAS`) — worker isolation.
