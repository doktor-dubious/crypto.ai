#!/usr/bin/env python3
"""Sweep the scalp-analysis endpoint over coins x parameter configs.

Usage:  python3 sweep.py jobs.jsonl results.jsonl [workers=4]

Each line of jobs.jsonl is one backtest job:
  {"symbol": "VANRY", "coin_id": "<uuid>", "strategy": "streak",
   "interval": "5m", "start": "2025-08-07", "end": "2026-08-07",
   "threshold": 4, "hold": 12, "fee": 4, "side": "long",
   "voldiv": 0, "btc": 0,                  # streak-only conditioners
   "params": "window:48,band_pct:15",      # OR raw params for other strategies
   "sl_mode": "none", "tp_mode": "none", "vol_gate": "off", "indicator": "ema"}

Results stream to results.jsonl (one JSON object per job) and a progress line
prints per job. Segment stats land as full_/h1_/h2_ prefixed fields:
n, bps (avg net bps/trade), t (edge t-stat), ret (total %), wr, sharpe, mdd.

Notes:
- 12 months of 5m bars takes ~20-35s per call; 15m+ is much faster.
- Workers 4-5 is a safe concurrency for the local API + DB.
- streak's btc filter fetches BTC klines too (slower). For non-streak
  strategies pass knobs via "params" verbatim (name:value,name:value).
"""
import json, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://localhost:8000/api/v1/scalp-analysis"


def run_one(job):
    params = job.get("params")
    if params is None and job.get("strategy", "streak") == "streak":
        params = f"require_voldiv:{job.get('voldiv', 0)},btc_filter:{job.get('btc', 0)}"
    q = {
        "coin_id": job["coin_id"], "quote_asset": job.get("quote", "USDT"),
        "interval": job.get("interval", "5m"),
        "start_date": job.get("start", "2026-02-07"), "end_date": job.get("end", "2026-08-07"),
        "strategy": job.get("strategy", "streak"), "threshold": job.get("threshold", 3),
        "hold_bars": job.get("hold", 6), "fee_bps": job.get("fee", 4),
        "side": job.get("side", "long"), "indicator": job.get("indicator", "ema"),
        "sl_mode": job.get("sl_mode", "none"), "sl_value": job.get("sl_value", 2),
        "tp_mode": job.get("tp_mode", "none"), "tp_value": job.get("tp_value", 3),
        "vol_gate": job.get("vol_gate", "off"), "vol_level": job.get("vol_level", 1.0),
        "htf_gate": job.get("htf_gate", "off"), "htf_tf": job.get("htf_tf", "4h"),
        "htf_level": job.get("htf_level", 0.5),
    }
    if params:
        q["params"] = params
    url = BASE + "?" + urllib.parse.urlencode(q)
    t0 = time.time()
    try:
        with urllib.request.urlopen(url, timeout=300) as r:
            d = json.load(r)
    except Exception as e:
        return {**job, "error": str(e)[:200]}
    segs = {s["label"]: s for s in d["segments"]}
    out = {k: v for k, v in job.items() if k != "coin_id"}
    out["secs"] = round(time.time() - t0, 1)
    for label, tag in (("Full range", "full"), ("First half", "h1"), ("Second half", "h2")):
        s = segs[label]
        out[f"{tag}_n"] = s["n_trades"]
        out[f"{tag}_bps"] = round(s["avg_net_bps"], 1)
        out[f"{tag}_t"] = s["edge_t"]
        out[f"{tag}_ret"] = round(s["total_return_pct"], 1)
        out[f"{tag}_wr"] = round(s["win_rate_pct"], 1)
        out[f"{tag}_sharpe"] = s["sharpe"]
        out[f"{tag}_mdd"] = s["max_drawdown_pct"]
    return out


def main(jobs_path, out_path, workers=4):
    jobs = [json.loads(l) for l in open(jobs_path) if l.strip()]
    with open(out_path, "w") as f, ThreadPoolExecutor(max_workers=workers) as ex:
        for res in ex.map(run_one, jobs):
            f.write(json.dumps(res) + "\n")
            f.flush()
            tag = (f"{res.get('symbol','?')} {res.get('strategy','streak')} "
                   f"th={res.get('threshold')} hold={res.get('hold')} {res.get('interval','5m')} fee={res.get('fee',4)}")
            if "error" in res:
                print(f"ERR  {tag}: {res['error']}", flush=True)
            else:
                print(f"ok   {tag}: n={res['full_n']} bps={res['full_bps']} t={res['full_t']} "
                      f"h1={res['h1_bps']}({res['h1_n']}) h2={res['h2_bps']}({res['h2_n']}) ret={res['full_ret']}%", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 4)
