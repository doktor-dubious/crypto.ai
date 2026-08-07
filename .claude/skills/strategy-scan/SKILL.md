---
name: strategy-scan
description: Investigate scalping strategies (streak/range/momentum/sweep/takerflow/indicator) across coins, timeframes and parameters via the scalp-analysis backtest API, then create vetted strategy templates. Use when asked to find promising strategy+coin+parameter combos or "use the analysis system to locate strategies with potential".
---

# Strategy Scan — find live-viable scalp configs and save them as templates

Staged sweep of `GET /api/v1/scalp-analysis` (the backend behind every
Trading → Strategies → \*/analytics page) to locate coin + parameter combos with
real, non-overfit edge, then `POST /api/v1/strategy-templates` to save the
winners. Proven 2026-08-07 (AI-SR1..4, see memory `streak-live-candidates`).

## Hard rules (learned the expensive way)

1. **Long-only** unless told otherwise — the live executor is long-only Binance Spot (`side=long`).
2. **Tick-size guard first.** Estimate tick = min nonzero close-step over 7d of
   5m bars. Tick ≥ ~10 bps of price disqualifies the coin — backtest wins there
   are one-tick artifacts a live order gives back crossing the spread.
   (Disqualified 2026-08: PEPE, SHIB, BONK, BANK, ERA, SXT.)
3. **Never trust a 6-month screen.** Final selection requires 12+ months with
   **both half-splits positive** at the target fee. On 2026-08 data, 6-month
   t-stats up to 2.8 (EPIC 15m!) collapsed to negative first halves on 12 months.
4. **Fee-stress every finalist** at 4 / 10 / 20 bps round-trip. 4 = futures
   maker, 10 = futures taker, 20 = spot taker. Quote which tier the edge
   survives in the notes. (2026-08: nothing survived 20 bps; that is expected —
   these are maker-fee edges.)
5. **Pooled research priors don't transfer per-coin.** Probe conditioners
   (streak: `require_voldiv`, `btc_filter`) per coin instead of assuming; on the
   2026-08 winners they *reduced* the long-side edge and ended up off.
6. **Judge by** `avg_net_bps` + `edge_t` + half-split consistency + MDD, never
   by total return alone (compounding on 2k trades flatters noise).
7. **Verify per-interval kline coverage before trusting any windowed backtest.**
   The API silently uses whatever bars exist in range: on 2026-08, SOL/XRP 15m
   data was only 6 weeks old, so their "12-month" runs (SOL t=1.72!) were
   6-week artifacts. Check `min(open_time)` for the SCREENING interval (not
   just 5m) for every candidate, and re-check whenever a "24-month" result is
   suspiciously identical to the 12-month one.

## Stage 0 — setup (~2 min)

- API health: `curl -s localhost:8000/health`. DB: `postgresql://gorm:gorm@localhost:5433/crypto_ai` (psql, PGPASSWORD=gorm).
- Data lives in `klines` (join `coin` on `coin.id = klines.coin_id`; table is ~450 coins × 5m/15m/30m/1h/4h/1d, current through today).
  Avoid unfiltered full-table scans (11GB+, minutes); always filter on the
  `(coin_id, quote_asset, interval, open_time)` index.
- Work in the session scratchpad; copy `sweep.py` from this skill's directory there.

Candidate ranking (volatility × liquidity, last 30d) + coin ids:

```sql
SELECT c.symbol, k.coin_id,
       round(avg(k.quote_asset_volume))                        AS avg_quote_vol_5m,
       round(avg((k.high-k.low)/nullif(k.close,0))*10000)      AS avg_range_bps
FROM klines k JOIN coin c ON c.id=k.coin_id
WHERE k.interval='5m' AND k.quote_asset='USDT' AND k.open_time >= now()-interval '30 days'
GROUP BY c.symbol, k.coin_id HAVING count(*) > 8000
ORDER BY avg_range_bps DESC LIMIT 60;
```

Keep coins with `avg_quote_vol_5m` ≥ ~20k USDT (≈ $6M/day). Then the tick check:

```sql
WITH bars AS (
  SELECT k.coin_id, k.close,
         abs(k.close - lag(k.close) OVER (PARTITION BY k.coin_id ORDER BY k.open_time)) AS step
  FROM klines k WHERE k.interval='5m' AND k.quote_asset='USDT'
    AND k.open_time >= now()-interval '7 days' AND k.coin_id IN (...))
SELECT c.symbol, round(min(CASE WHEN step>0 THEN step/nullif(close,0) END)*10000,2) AS tick_bps
FROM bars b JOIN coin c ON c.id=b.coin_id GROUP BY c.symbol ORDER BY tick_bps;
```

Drop tick_bps ≥ ~10; flag 5–10 as marginal. Also grab each candidate's listing
date (`min(open_time)`) — a coin younger than the validation window gets judged
on its whole life instead, and its early weeks are noisy.

## Stages A/B/C — screen, tune, validate

Run backtests with `sweep.py` (this skill's directory): jobs.jsonl in →
results.jsonl out, 4–5 workers, ~20-35s per 12-month 5m call. Run it via
`run_in_background` and read the output file when notified. Field reference in
its docstring; segment stats come back as `full_/h1_/h2_` fields.

- **A — screen** (~20 coins × 2 configs, 6-month window): default params vs the
  strategy's researched conditioned config. Kill coins negative or h2-negative.
- **B — tune** (~7 coins × grid): threshold × hold grid, conditioner probes,
  one 15m variant, one vol-gate probe. 2026-08 streak winner shape:
  **threshold 4–5, hold 12 (1h on 5m)** — deeper + longer than the defaults.
- **C — validate** (finalists × fees {4,10,20} × 12mo, plus 24mo where history
  allows): apply hard rule 3. Expect most of stage B to die here; that is the
  stage doing its job. Backfill slots from the wide field re-screened directly
  on 12 months at the winning shape.

## Create templates

`POST /api/v1/strategy-templates` — params use the explorer's **camelCase**
shape (verified: `paper_trade_engine._parse_knobs` reads these exact keys):

```json
{"name": "AI-SR1 · VANRY 5m", "strategy": "streak", "is_abstract": false,
 "scope": {"coin_id": "<uuid>", "quote_asset": "USDT", "interval": "5m"},
 "params": {"threshold": 4, "holdBars": 12, "feeBps": 4, "side": "long",
            "slMode": "none", "slValue": 2, "tpMode": "none", "tpValue": 3,
            "volGate": "off", "volLevel": 1, "htfGate": "off", "htfTf": "4h",
            "htfLevel": 0.5, "indicator": "ema",
            "paramValues": {"require_voldiv": 0, "btc_filter": 0}},
 "description": "<one line: signal, hold, headline stat>",
 "notes": "<see below>", "ai_confirmation": false}
```

Naming: `AI-<series><n> · SYMBOL tf` (existing series: AI-SR = streak reversion).
Notes must let a future reader re-derive the pick: why this coin + params
(stats: n, net bps, t, both halves, total %, Sharpe, MDD, per window), fee tier
that survives, tick + liquidity, trade rate, known caveats/risks, and a short
methodology paragraph (windows, long-only, tick guard, half-split criterion).

## Wrap up

- Update memory (`streak-live-candidates` or a sibling) with new picks and any
  new methodology lessons.
- Recommend paper-trade runs on the new templates before live — t of 1.5–2.5 is
  evidence, not proof. Cross-check later against the sweep leaderboard
  (`GET /api/v1/paper-trade/sweeps/leaderboard`, judge pooled per-template).

## Trend swings (`swings` strategy)

Uses a DIFFERENT endpoint: `GET /api/v1/swing-analysis` (composite trough/crest
signal, threshold = composite σ 0–5). Sweep it with `sweep_swing.py` (this
skill's directory) — same jobs/results format as `sweep.py`. Template `params`
additionally carry `disabledSignals: []` and `weightPct: {}` (defaults = all
signals, weight 1 — probes didn't beat them). 2026-08 findings: edge lives at
**1h and on majors** (BTC/ETH/LINK/AVAX — unique among families); deeper
threshold (1.5–2σ) for majors, 1σ for alts; trough-buys cluster in reversion
regimes, so validate on YEARLY halves over 24 months, not 6-month splits.

## Strategy knob cheat-sheet (`params` query arg, name:value comma-joined)

| strategy | knobs (defaults) | threshold means |
|---|---|---|
| streak | require_voldiv:0, btc_filter:0 | run length (bars) |
| range | window:48, band_pct:15, max_width_pct:3 | edge depth (band units) |
| momentum | window:48 | volume spike (σ) |
| sweep | window:12 | sweep depth (ATR) |
| takerflow | window:12, fade:0 | imbalance (σ) |
| indicator | ema: fast:9,slow:21 · rsi/bollinger: period · vwap: vwap_window:96 | trigger depth (σ) |
