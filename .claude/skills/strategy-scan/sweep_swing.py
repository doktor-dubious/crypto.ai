#!/usr/bin/env python3
"""Sweep the swing-analysis endpoint (trend-swings strategy) over coins x configs.

Job fields: symbol, coin_id, interval, start, end, threshold (composite sigma),
hold, fee, side, signals (comma list or omit), weights ("name:pct,..." or omit),
sl_mode/sl_value, tp_mode/tp_value, htf_gate/htf_tf/htf_level.
Output identical to sweep2.py (full_/h1_/h2_ segment fields).
"""
import json, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://localhost:8000/api/v1/swing-analysis"


def run_one(job):
    q = {
        "coin_id": job["coin_id"], "quote_asset": job.get("quote", "USDT"),
        "interval": job.get("interval", "15m"),
        "start_date": job.get("start", "2026-02-07"), "end_date": job.get("end", "2026-08-07"),
        "threshold": job.get("threshold", 1.0), "hold_bars": job.get("hold", 6),
        "fee_bps": job.get("fee", 4), "side": job.get("side", "long"),
        "sl_mode": job.get("sl_mode", "none"), "sl_value": job.get("sl_value", 2),
        "tp_mode": job.get("tp_mode", "none"), "tp_value": job.get("tp_value", 3),
        "htf_gate": job.get("htf_gate", "off"), "htf_tf": job.get("htf_tf", "4h"),
        "htf_level": job.get("htf_level", 0.5),
    }
    for opt in ("signals", "weights"):
        if job.get(opt):
            q[opt] = job[opt]
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
            tag = f"{res.get('symbol','?')} swings th={res.get('threshold')} hold={res.get('hold')} {res.get('interval','15m')} fee={res.get('fee',4)}"
            if "error" in res:
                print(f"ERR  {tag}: {res['error']}", flush=True)
            else:
                print(f"ok   {tag}: n={res['full_n']} bps={res['full_bps']} t={res['full_t']} "
                      f"h1={res['h1_bps']}({res['h1_n']}) h2={res['h2_bps']}({res['h2_n']}) ret={res['full_ret']}%", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 4)
