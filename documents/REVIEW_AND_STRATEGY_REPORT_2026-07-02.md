# Full Codebase Review & Trading Strategy Evaluation — 2026-07-02

Scope: entire crypto.ai codebase (backend, prediction engines, DB/migrations,
Celery tasks, frontend), plus an empirical evaluation of the trading
strategies using the stored simulation results in the live database.

Fixes marked **[PORT TO GORM]** touch code shared with the gorm.ai project
(same file/function names, package root `crypto_ai` → `gorm_ai`). Take this
report to a Claude session in that project and have it apply the marked items.

---

## 1. Bugs fixed in this pass

### 1.1 Data integrity (crypto pipeline) — the most consequential fixes

**F1. Duplicate klines corrupted simulations — dedupe + unique constraint** *(crypto.ai only)*
- `klines` had no unique constraint on `(coin_id, quote_asset, interval, open_time)`
  and the importer blindly inserted, so overlapping import ranges duplicated bars.
- **Your live DB had 56,296 duplicate rows in BTC/USDT 1h (42% of the series!) and
  234 in NEAR/USDT 4h.** Every BTC 1h simulation (including both `kline`-strategy
  runs) walked over series where many bars appeared twice: contexts contained
  repeated bars and the up/down encoding got spurious "flat" symbols.
- Fixed by migration `alembic/versions/20260702_100000_dedupe_klines_unique_constraint.py`
  (already applied: duplicates deleted — verified value-identical first — and the
  composite index is now UNIQUE), plus `BinanceImportService.insert_klines()`
  which upserts with `ON CONFLICT DO NOTHING`
  (`src/crypto_ai/services/binance_import.py`, also used by the upload route).
- **Action: re-run any BTC/USDT 1h and NEAR/USDT 4h simulations — their stored
  results are not trustworthy.**

**F2. Failed/no-data simulations were stored as "success"** *(crypto.ai only)*
- `KlineSimulationService.run_simulation` returned `{"error": ...}` dicts for
  "no kline data" cases; the Celery task persisted them as `status="success"`
  with the error buried in the result JSON. Your OP/USDT 4h 2025 run is exactly
  this (OP 4h data only covers 2023-01→2023-04).
- Now raises `RuntimeError` → task marked `failure`, message on the Error tab
  (`src/crypto_ai/services/kline_simulation.py`).

**F3. Import errors were swallowed → silent gaps** *(crypto.ai only)*
- A network timeout on any daily file was logged as a transient message and the
  import still finished "success", leaving holes the simulations treat as
  adjacent bars. Now failed days are collected and the task fails at the end
  with a summary (already-imported days stay committed). 404s (missing files on
  Binance's side) are still skipped as before.
  (`src/crypto_ai/services/binance_import.py`)
- Also: `symbol`/`interval` are now validated before being interpolated into
  the download URL, and the legacy SSE import route emits real JSON
  (`src/crypto_ai/api/routes/binance_import.py`).

### 1.2 Backtest correctness

**F4. Look-ahead bias in vol-targeting sizing** *(crypto.ai only)*
- `_compute_backtest` sized positions against the median predicted vol of the
  **entire** run — bar 10's size depended on bar 900's forecast. Now an
  expanding median of spreads seen up to each bar
  (`src/crypto_ai/services/kline_simulation_record.py`).

**F5. Monthly interval parsed as 1 minute** *(crypto.ai only)*
- `_interval_minutes("1M")` lowercased to "1m" → `periods_per_year = 525,600`
  instead of 12, inflating Sharpe ~209× on monthly runs. Fixed.

**F6. Short-position bankruptcy overflow** *(crypto.ai only)*
- A short against a >100% up-bar produced per-bar return < −1, flipping the
  compounded equity curve negative. Per-bar net return now floored at −100%.

**F7. Phantom "0.0" forecasts** *(crypto.ai only)*
- When an engine returned neither a point value nor quantiles for a bar, the
  simulation silently scored `0.0` (an extreme "down" call), corrupting
  direction accuracy and MAE. Now fails the model run with a clear error
  (`src/crypto_ai/services/kline_simulation.py`, both the price loop and
  `_predict_series`).

### 1.3 Prediction engines — **[PORT TO GORM]** (all of 1.3)

**F8. TimesFM: silent stub fallback after a failed load with fallback disabled**
- `_load_model`'s `finally: self._model_loaded = True` ran even when the load
  raised with `allow_fallback=False`; the next call skipped loading and served
  the exponential-smoothing stub *as TimesFM output* with no error.
  `_model_loaded` is now only set when load succeeded or fallback is allowed
  (`src/crypto_ai/prediction/engines/timesfm.py:_load_model`).

**F9. TimesFM: Blackwell GPU torch.compile workaround never ran**
- `os` wasn't imported at module level; the `os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")`
  raised `NameError`, silently eaten by `except Exception`. Added module-level
  `import os` (`timesfm.py`).

**F10. Sundial: crash with `precision=bfloat16`**
- `output.logits.cpu().numpy()` can't convert bfloat16; added `.float()` like
  the peer engines (`sundial_engine.py`).

**F11. TiRex: pointless zero-padding injected fake history**
- Contexts were zero-left-padded to the batch max even though inference is
  per-item; a short series was forecast from hundreds of fake "0.0 price"
  points. Padding removed (`tirex_engine.py`).

**F12. Chronos base: zero-padding of mixed-length batches**
- Shorter series in a batch were left-padded with zeros, which Chronos treats
  as real observations at the series minimum (values are min-max normalized).
  Now passes a list of variable-length tensors — the pipeline pads and masks
  internally (`chronos_pipeline_engine.py:_run_batch_inference`).
  **Verified against the real model in the worker container** (chronos-bolt-small,
  mixed 100/30-length inputs → correct `(2, 9, 3)` output).

**F13. NaN sanitization added to FlowState, Kairos, Sundial, YingLong, TiRex**
- These engines passed raw model output into `PredictionResult` without the
  `_sanitize_nan` step TimesFM/Chronos have; one NaN forward pass would
  propagate NaN into stored predictions and metrics.

**F14. Custom engine: forecasts dated one day early**
- `predict()` ignored `prediction_from` and anchored `generate_future_dates`
  (inclusive!) at the *last historical date*, overlapping the last observed day.
  Now accepts `prediction_from` (`custom.py`).

### 1.4 Sales prediction service — **[PORT TO GORM]** (all of 1.4; this is gorm's core path)

All in `src/crypto_ai/services/prediction.py`:

**F15. Ridge/weekday-correction coefficients zipped against the wrong outlets**
- The weekday-only rerun called `predict_batch` again with a *filtered* outlet
  subset, overwriting `engine._last_ridge_results`; the code then zipped that
  against the full `valid_outlet_ids`, silently corrupting persisted
  `covariate_outlet` rows and `correction_mon..sun`. The ridge results are now
  snapshotted immediately after the main batch call.

**F16. IndexError risk in weekday-only override**
- `all_results[...][ri]` written unguarded; engines cap horizon at their max so
  result lists can be shorter than requested. Guard added.

**F17. Closed-day deliveries resurrected by the ≥1 rounding floor**
- Closed days were zeroed to `predicted=0, eo=0`, but `_compute_delivered`'s
  `max(1, …)` floor plus min/add constraints delivered ≥1 anyway. A zero base
  now short-circuits to 0 (explicit `fixed` overrides still win).

**F18. Dead outlets ranked above healthy ones in fixed-total distribution**
- Degenerate quantiles (P10=P50=P90=0) hit a zero-width CDF segment → t=0.5 →
  P(demand>0)=0.95. `p90 <= 0` now returns ~0.

**F19. Explicit 0 in a request treated as "unset"**
- `getattr(request, k, None) in (None, False)` — `0 == False` in Python, so an
  explicit `total_return_pct=0.0` was silently replaced by the strategy default.
  Now uses `is None` / `is False`.

**F20. Data-dump profits used the wrong weekday's financials**
- `fin_map` was keyed 1=Mon..7=Sun but looked up with Python's 0..6: Monday rows
  never matched, Tue–Sun used the previous day's cost/profit. Fixed
  (`weekday() + 1`), and the financials query now filters `active.is_(True)`.

### 1.5 Tasks / fine-tuning — **[PORT TO GORM]**

**F21. Fine-tune tasks SIGKILLed at 1 hour**
- `run_finetune_task` had no `time_limit` override, so the global 1h Celery
  limit applied; long fine-tunes on a prefork worker were killed at exactly
  60 min. Now 7d like the simulation task (`src/crypto_ai/tasks/finetuning.py`).

**F22. Fine-tune tasks marked "Worker lost" while still training**
- Crypto fine-tunes train a single series, so progress can be silent for hours
  and orphan detection killed the record. Added the same 60s heartbeat the
  simulation/import tasks use (`tasks/finetuning.py`).

**F23. MOIRAI-2 rsync blocked the event loop up to 20 min**
- `_pull_checkpoint`/`_sync_checkpoint` were called synchronously inside the
  async runner (TimesFM's runner already used an executor). All four call sites
  now run in an executor (`services/_finetune_moirai2.py`).

### 1.6 Database models / migrations

**F24. Elasticity models were broken and invisible to Alembic** *(check gorm — its originals are likely correct; crypto.ai's copies were mangled)*
- `PriceChangeEvent`: missing `customer_id` entirely; `price_before/price_after`
  typed as **UUID** instead of Float; FK pointed at nonexistent table `outlet`
  (table is `outlets`). Any elasticity endpoint would crash, and
  `Base.metadata.create_all` (the whole test suite bootstrap) failed on the FK.
- `ElasticityEvent`: same wrong FK.
- Both models were also missing from `models/__init__.py`, so the next
  `alembic revision --autogenerate` would have emitted `drop_table` for them —
  the same failure class as the earlier `cd3e507c9147` incident.
- All fixed (`database/models/price_change_event.py`, `elasticity_event.py`,
  `models/__init__.py`); metadata now resolves cleanly.

### 1.7 Frontend

**F25. CRITICAL: the entire backend was reachable without login** *(check gorm — likely the same middleware)*
- The auth middleware skipped every `/backend/*` path, and the Next.js rewrite
  proxies those straight to FastAPI — which has **no auth at all**. Anyone who
  could reach the frontend port could read/delete all data and enqueue GPU jobs
  with no session. `/backend/*` now requires a valid Better Auth session
  (401 for API traffic), with a one-path allowlist for the public share page
  (`frontend/src/middleware.ts`). The `/api/chat` SSE proxy (also previously
  unauthenticated) now verifies the session server-side
  (`frontend/src/app/api/chat/route.ts`).

**F26. AI-Models page: "Sane epochs" / "Max MAE" couldn't be viewed or saved** *(check gorm)*
- The draft-sync effect, `isDirty`, and cancel handler all omitted
  `finetune_sane_epochs`/`finetune_max_mae`: stored values rendered empty and
  edits were silently lost unless another field was also edited. Fixed
  (`frontend/src/app/(dashboard)/ai-models/page.tsx`).

**F27. Simulations page: stale state when switching runs** *(crypto.ai only)*
- Model Fit kept the previous sim's model selection and zoom (showing "No
  predictions to plot" for runs with thousands of rows); the Predictions tab
  kept the previous sim's page offset and row selection (empty table with wrong
  "Showing" text). Both components are now keyed by `sim.id`. The Backtest tab
  was left unkeyed on purpose — its settings aren't per-sim and its query key
  already includes the sim id.

**F28. Backtest tab misreported every failure as "no quantiles"** *(crypto.ai only)*
- Network errors/500s rendered the hardcoded "the model produced no quantiles"
  message. Non-400 errors now show the real message.

**F29. Coins page fixes** *(crypto.ai only)*
- Switching coins kept the previous pair/timeframe selection (phantom
  ETH/USDT/4h queries, blank timeframe select, misdirected "Delete All Data").
  Row click now resets pair/timeframe/page.
- "Annualized Vol" in the Analyze tab used √252 regardless of timeframe (1h vol
  understated ~5×, 5m ~17×). Now annualizes by bars-per-year for the selected
  timeframe on a 365-day year.

### Verification
- All 21 edited Python files parse and import; model metadata `create_all`
  resolves (previously failed on the `outlet` FK).
- `pytest` results identical before/after the changes (the 4 statistical-engine
  failures and the `ba_users` FK error are pre-existing).
- Frontend `tsc --noEmit` passes.
- Chronos list-of-tensors inference verified against the real model in the
  worker container.
- Dedupe migration applied; BTC 1h now 77,244 unique bars; unique index live.

---

## 2. Known issues found but NOT fixed (documented decisions)

Security/infrastructure (need your call, may break your LAN/vast.ai topology):
1. **FastAPI has no authentication and port 8000 is published to the host**
   (`docker-compose.yml` `ports: "8000:8000"`, kept in prod overlay). The
   frontend gate (F25) protects the proxy path, but the raw port bypasses it.
   Recommendation: bind `127.0.0.1:8000:8000` (frontend reaches it via the
   Docker network) or add a shared-secret header check.
2. **Docker socket mounted into the API container** + unauthenticated
   `POST /tasks/workers/restart` and `GET /logs` = host-compromise primitive if
   port 8000 is reachable. Move Docker ops to an authenticated admin path.
3. **`BETTER_AUTH_SECRET` committed to the repo** in `docker-compose.yml` (and
   used as the prod default). Anyone with repo access can forge sessions.
   **Rotate it** and require it from the environment. Same for the `gorm/gorm`
   DB credentials on a published port (5433).
4. `GET /prediction-engines/{id}/finetune/models` and `DELETE …/finetune/reset`
   operated on a user-editable path — **fixed** with containment to `models/`
   (`_safe_finetune_dir` in `api/routes/prediction_engines.py`), but the general
   pattern (API-writable paths used in filesystem ops) is worth auditing when
   adding endpoints.

Engine-layer (latent, lower priority):
5. Zero left-padding of mixed-length batches also exists in FlowState, Kairos,
   Sundial, YingLong, TTM (`_run_batch_inference` in each). Not fixed because
   each model's padding API differs and can't be tested here. In kline
   simulations contexts are equal-length once history ≥ context window, so this
   mainly bites young coins / small batches with the sales path.
6. Engine singletons are not safe under concurrent tasks: `apply_parameters`
   nulls the live pipeline, `allow_fallback` is mutated per request, TimesFM
   recompiles the shared model per context size, and single `predict()` shares
   one preprocessor across awaits. Two simultaneous simulations on one worker
   can interleave. Fix direction: per-call preprocessors + a load/compile lock +
   pass params per call. **[PORT CONCERN FOR GORM TOO]**
7. `DataPreprocessor.denormalize` clamps all forecasts to ≥0 (a sales
   assumption). Fine for prices/range-vol, but **blocks any experiment on
   return series** (negative values legal). Make it opt-in when you switch to
   returns (see §4).
8. TimesFM single `predict()` never applies PAD adjustments (batch path does);
   MOIRAI-2/AutoGluon read `eo_params` from the wrong dict (always defaults);
   AutoGluon derives covariate columns from item 0 only.
9. `TaskService.cancel()` restarts the entire worker container, killing every
   other running task on it.
10. TimesFM/MOIRAI-2 checkpoint swap is non-atomic (crash window loses the
    checkpoint); the pathological sane-check only fires exactly at
    `epoch == sane_epochs`.
11. `list_completed(search=…)` is a silent no-op; `FineTuneCreate` schema is
    stale dead code; migration `20260701_120000` downgrade doesn't restore the
    chronos2/flowstate parameter rows it deleted; `20260616_150000` downgrade
    fails once NULL-customer fine-tunes exist.
12. Frontend: several pages read localStorage in `useState` initializers → React
    hydration mismatch + layout flash (the New Simulation page shows the correct
    effect-based pattern). Backtest `vol_targeting` mixes two vol scales when a
    stopped run has partial `pred_vol` (backend picks per-row).

---

## 3. Trading strategy evaluation — the honest picture

### What your own data says (all 16 scored runs in the DB)

| Signal | Result |
|---|---|
| Direction accuracy (point forecast vs prev close) | **44.6–52.7%**, mean ≈ 49% — coin flip |
| Hit rate when prob_up ≥ 0.6 | 45–54% |
| Hit rate when prob_up ≥ 0.7 (high conviction) | 44.8–51.9% |
| Avg signal-bar return at prob_up ≥ 0.7 | **−16 to +5 bps** |
| Round-trip fee assumed | 15 bps |
| Volatility forecast (pred_vol vs realized, BTC 1h) | **corr 0.61** |

The one apparent exception — chronos-bolt 68.8% at ≥0.7 on BTC 4h — is 16
signals on a 186-bar January run: small-sample noise, not an edge. (And the
BTC 1h rows above were computed on the 42%-duplicated series; re-run them, but
don't expect the conclusion to change.)

### Why this outcome is structural, not a bug

- Next-bar close direction on liquid crypto pairs at 15m–4h is nearly
  informationally efficient: your measured ~49–52% matches the academic
  consensus and your own earlier research (TimesFM 46.7% across 15 coins).
- The math: expected PnL per traded bar ≈ (2p − 1)·E|move| − fee·turnover.
  At 1h BTC, E|move| ≈ 37 bps. Even p = 0.55 (far above anything measured)
  yields ~3.7 bps of gross edge per bar against ~15 bps round-trip cost. At 4h
  (62 bps avg move) breakeven needs sustained p ≈ 0.62 with full turnover.
  No univariate close-only forecaster gets there.
- Foundation TS models (TimesFM/Chronos/…) are trained on generic, mostly
  non-adversarial series (energy, traffic, retail). Prices are the adversarial
  limit case: any pattern in close-only history is arbitraged away. **Feeding
  them more of the same input cannot fix this.** Fine-tuning on the same
  univariate closes learns noise (your epoch-1 MSE 0.02 → epoch-8 1.34 log is
  overfitting in action).
- **The volatility result is the real signal.** Corr 0.6 one-step-ahead is
  genuinely good (beats GARCH per your earlier work) — volatility clusters, so
  it *is* forecastable. You currently only use it to size/filter a losing
  direction signal, which can't make the direction signal profitable.

### Verdict

The current strategy family — threshold on `prob_up` derived from univariate
close-only quantile forecasts, long (or short) the next bar on spot with taker
fees — is structurally unprofitable, and your data shows it consistently.
Stop iterating within that family. The levers that can actually change the
outcome: (a) different inputs, (b) different targets (vol, cross-sectional
ranks), (c) drastically lower fees, (d) longer holding periods that amortize
costs.

---

## 4. What to experiment with next (ordered by expected value)

### 4.1 Monetize the volatility edge directly (your one proven signal)
- **Vol-breakout with a trend trigger:** enter only when predicted vol is in
  its top quintile AND a direction trigger fires (e.g. breakout of the last
  N-bar high/low). You're not predicting direction — you're predicting *when a
  large move is likely* and letting the breakout choose the side. Fees hurt
  less because expected |move| on traded bars is much larger.
- **Vol-regime filter for everything:** run all other strategies only in
  high-predicted-vol regimes; flat markets are pure fee bleed.
- **Options (Deribit BTC/ETH):** with a vol forecast that beats GARCH you can
  trade implied-vs-forecast realized vol (straddles/strangles) — the honest way
  to monetize a vol model. Bigger infrastructure lift; paper-trade it first.
- Add a **vol-forecast quality dashboard** (pred vs realized scatter, by
  regime) — you already store both columns.

### 4.2 Change the input space (order flow, not just closes)
- **Already in your DB, unused:** `taker_buy_base_asset_volume` per bar → per-bar
  order-flow imbalance (taker buy ratio), plus `volume`, `number_of_trades`,
  high/low ranges. These are the standard alpha features at these horizons.
- Import from Binance (free, same data.binance.vision source): **funding rates,
  open interest, liquidations** for USDⓈ-M perps — regime/positioning signals.
- Cross-asset: BTC leads alts at hourly scale; ETH/BTC ratio; BTC dominance.
- **Model:** gradient boosting (LightGBM/XGBoost) or logistic regression on
  ~20–50 engineered features, predicting P(up) or expected return, with proper
  purged walk-forward CV. This is the industry-standard shape for this problem
  and where covariates actually get used (the FM engines mostly can't ingest
  these as true covariates — the Ridge-residual hack is not a covariate model).
- If you want to stay with FMs: **Chronos-2 and Toto 2.0 support multivariate/
  covariate inputs natively** — feed (close, volume, taker ratio, funding) and
  forecast returns, not closes. Requires the preprocessor ≥0-clamp fix (§2.7).

### 4.3 Change the target
- **Returns / log-returns instead of price levels** (stationarity; also makes
  quantile bands meaningful across regimes).
- **Cross-sectional rank (market-neutral):** forecast all ~20 imported coins,
  go long the top 3–5 expected-return coins and short the bottom 3–5 on 4h/1d,
  rebalance daily. Removes market beta (the thing that makes single-coin
  direction a coin flip) and only needs *relative* ordering skill. This is the
  single most promising direction-flavored experiment available to you.
- **Longer horizons:** 1d–1w rebalances amortize fees (a daily trade pays
  15 bps against ~200+ bps average daily ranges on mid-caps).

### 4.4 Fix the fee math (platform lever)
- Binance **spot taker 10 bps** (7.5 with BNB) is the killer at intraday scale.
- Binance **USDⓈ-M futures: maker 2 bps / taker 5 bps** (less with BNB) — a
  maker-entry/maker-exit strategy pays ~4 bps round trip instead of 15–20, and
  shorts become real (your backtest already warns its short model ignores
  funding; import funding rates to model it).
- Other venues (OKX/Bybit/MEXC) have comparable or promo-zero maker tiers, but
  liquidity and counterparty risk matter more than a few bps — **switching
  platforms won't create a signal that isn't there; it only lowers breakeven.**
  Model maker fills honestly: a passive order only fills when price trades
  through your level (assume fill only if the bar's extreme crosses it).
- Add fee-sensitivity to the backtest tab: run each config at 0/4/8/15/30 bps
  round trip to see where the strategy dies.

### 4.5 Evaluation hygiene (before trusting any "winner")
- With ~7 free knobs on the backtest tab you will find fake winners by sweep.
  Adopt: out-of-sample confirmation windows (tune on 2024, confirm on 2025),
  per-quarter consistency (a real edge wins most quarters, not one lucky
  stretch), and a deflated-Sharpe / multiple-testing mindset (dozens of tries →
  demand much higher in-sample Sharpe before believing it).
- Add **prob_up calibration** (reliability curve: predicted 0.7 should win ~70%
  of the time — you already store everything needed).
- Headline metric per experiment: **after-fee expectancy per trade** and
  **excess vs buy & hold**, not MAPE/direction accuracy.

### 4.6 Coins/timeframes
- Your earlier list stands: mid-caps (NEAR, ATOM, INJ, APT, ARB, OP, SUI) at
  4h/1d for trend persistence; memes (DOGE, PEPE, WIF) for vol strategies only.
- Skip BTC/ETH for single-coin direction — most efficient books in crypto —
  but keep them as the *hedge leg* for cross-sectional long/short.
- Import 1d for everything (cheap) to enable the cross-sectional experiment.

---

## 5. Scalping strategies — which can this system support?

| Strategy | Feasible here? | Notes |
|---|---|---|
| **Order book / spread scalping** | **No (and don't)** | Needs L2 depth + trade-stream data (not in klines, can't be backfilled), sub-second execution, and maker rebates. At retail fees/latency this is the market makers' pocket, not yours. Would require live websocket capture infrastructure before you could even research it. |
| **Range scalping** | **Yes** — implementable on stored klines | Detect ranges (e.g. rolling pivot highs/lows or N-bar min/max channel), buy support/sell resistance with a stop beyond the range. Works on your BTC/ETH 5m–30m history (back to 2017). Add a regime filter: only trade when predicted vol is LOW (your vol forecast!) — ranges hold in calm regimes and break in violent ones. |
| **Momentum / breakout scalping** | **Yes** — best fit for your assets | Volume-spike + channel-breakout entry, fast exit (time stop of a few bars or trailing stop). You have `volume` and `taker_buy_*` for the spike detection. Pairs naturally with the vol-expansion forecast (§4.1) — that combination is your most promising scalping experiment. |
| **Indicator scalping (EMA cross, RSI, VWAP, Bollinger)** | **Yes** — trivial from klines | Be aware the published evidence (and my strong prior): raw indicator rules after fees ≈ break-even minus costs. Use them as *features* in a learned model or as *triggers* gated by the vol forecast, not as standalone systems. |

Practical notes if you build the Scalping tab (you sketched this in
`documents/crypt.ai.txt`):
- Import **1m klines** for BTC/ETH (you have 5m+; 1m exists on data.binance.vision).
- Execution realism decides everything at this timescale: fill at **next bar
  open** (never the signal bar's close), model maker fills as "limit price
  touched by the next bar's range", add 1–2 bps slippage for takers, and use
  futures maker fees (§4.4) — at spot taker fees every 1m–5m strategy is dead
  on arrival, no exception.
- Structure it like the Backtest tab: strategy dropdown (range / breakout /
  EMA-cross / VWAP-revert), per-strategy params, fee/slippage inputs, equity
  curve vs buy & hold, per-trade stats. The `_compute_backtest` machinery is
  reusable — the difference is signals computed from OHLCV rules instead of
  `prob_up`.

## 6. News scanning — feasible and worth it?

Feasible: yes, and your stack is well-suited (Celery for polling, Anthropic key
already integrated for classification). Honest expectations first:

- **Headline-reaction trading on majors is a lost race** — listing/hack/ETF
  headlines are priced in by bots in seconds. Don't build for that.
- Where retail-latency news signals genuinely live:
  1. **Exchange listing announcements** (Binance/Coinbase/Upbit listing a
     mid-cap) — the pump develops over minutes-to-hours; an automated watcher on
     the announcement pages/APIs is the classic version of this.
  2. **Slow-diffusing fundamental news** on mid-caps (partnerships, unlocks,
     governance, regulatory actions) — repricing over hours/days.
  3. **Aggregate sentiment** as a *covariate* for your daily models (count/tone
     of coin-specific news over trailing 24–72h) rather than per-headline trades.
- Architecture that fits this repo: Celery beat poller (CryptoPanic API,
  exchange announcement feeds, CoinDesk/CoinTelegraph RSS, token-unlock
  calendars) → dedupe → **Claude Haiku classification** (coin(s), event type,
  direction, magnitude, confidence — cheap at these volumes) → `news_events`
  table keyed to your coins → **event-study module first**: measure average
  abnormal return by event type × coin tier × window (1h/4h/24h) against your
  klines *before* wiring any trading logic. Build trading rules only for event
  types the study shows still move price at your latency.

## 7. Conclusions

1. The platform is now substantially sounder: the two worst data-integrity
   bugs (42% duplicated BTC 1h bars; failed runs stored as "success") and a
   look-ahead bias are fixed. **Re-run BTC 1h and NEAR 4h simulations.**
2. The strategy conclusion from your own 25k+ stored forecasts is unambiguous:
   close-only foundation-model direction forecasts are a coin flip at every
   coin/timeframe tested, and no threshold/sizing/fee toggle changes that.
   That family is exhausted — the code was mostly fine; the alpha isn't there.
3. Your volatility forecast (corr ~0.6) is a real, reproducible edge-shaped
   signal. The highest-value experiments all route through it: vol-gated
   breakout scalping, vol-regime filters, and (eventually) options.
4. Next three experiments in order: (1) cross-sectional long/short over your
   ~20 coins at 1d, (2) vol-expansion-gated breakout on mid-caps at 15m–1h
   with futures maker fees, (3) LightGBM on order-flow features
   (taker-buy ratio, volume, funding, OI) predicting 4h/1d returns.
5. Platform: stay on Binance data; move execution assumptions to USDⓈ-M
   futures maker fees (~4 bps round trip). Other exchanges lower costs
   marginally but create no signal.
6. News scanning: build the poller + Claude classifier + event-study module;
   target listings and mid-cap fundamental news, and feed aggregate sentiment
   into the daily models as a covariate. Skip headline-latency trading.
7. Security: rotate `BETTER_AUTH_SECRET`, bind port 8000 to localhost, and get
   the Docker socket out of the API container (§2, items 1–3).
