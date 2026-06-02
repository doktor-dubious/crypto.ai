"""TimesFM 2.5 volatility walk-forward on BTCUSDT 1h.

Target = |log return| (move size). At each test bar: forecast next |return| from
the prior CONTEXT, compare TimesFM against persistence / EWMA(0.94) / rolling-24.
Unlike direction, this target has real structure (vol clustering), so a win is
plausible. Scored on MAE (lower=better) and correlation, plus vol-regime hit rate.
"""
import glob, os, sys, time
import numpy as np
import pandas as pd

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else "/home/rune/Downloads/btc/BTCUSDT-1h"
CONTEXT, N_TEST, CHUNK = 512, 1000, 64
COLS = ["open_time","open","high","low","close","volume","close_time",
        "quote_vol","num_trades","taker_base","taker_quote","ignore"]

files = sorted(glob.glob(f"{DATA_DIR}/*.csv"))
df = pd.concat([pd.read_csv(f, header=None, names=COLS) for f in files], ignore_index=True)
df = df.sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)
close = df["close"].to_numpy(float)
r = np.diff(np.log(close))
s = np.abs(r)                       # volatility target: |log return|, length N
print(f"{len(close)} bars, vol series len {len(s)} from {DATA_DIR}")

# EWMA (RiskMetrics lambda=0.94) of |return|, causal (value at i uses data <= i)
lam = 0.94
ewma = np.empty_like(s); ewma[0] = s[0]
for i in range(1, len(s)):
    ewma[i] = lam * ewma[i-1] + (1-lam) * s[i]

import timesfm
from huggingface_hub import snapshot_download
model_path = snapshot_download(repo_id="google/timesfm-2.5-200m-pytorch")
model = timesfm.TimesFM_2p5_200M_torch()
model.model.load_checkpoint(os.path.join(model_path, "model.safetensors"))
model.compile(timesfm.ForecastConfig(
    max_context=CONTEXT, max_horizon=128, normalize_inputs=True,
    use_continuous_quantile_head=True, force_flip_invariance=True,
    infer_is_positive=True, fix_quantile_crossing=True, return_backcast=True))
print("model loaded + compiled")

start = max(CONTEXT, len(s) - N_TEST)
test_idx = list(range(start, len(s)))
print(f"scoring {len(test_idx)} bars (context={CONTEXT})")

tfm, actual, persist, ewm, roll, prev = [], [], [], [], [], []
t0 = time.time()
for c0 in range(0, len(test_idx), CHUNK):
    bi = test_idx[c0:c0+CHUNK]
    inputs = [s[i-CONTEXT:i] for i in bi]
    point, _q = model.forecast(horizon=1, inputs=inputs)
    fc = np.asarray(point)[:, -1]
    for k, i in enumerate(bi):
        tfm.append(max(fc[k], 0.0)); actual.append(s[i])
        persist.append(s[i-1]); ewm.append(ewma[i-1])
        roll.append(s[i-24:i].mean()); prev.append(s[i-1])
    print(f"  {min(c0+CHUNK,len(test_idx))}/{len(test_idx)} ({time.time()-t0:.0f}s)", end="\r")

tfm, actual = np.array(tfm), np.array(actual)
persist, ewm, roll, prev = map(np.array, (persist, ewm, roll, prev))

def mae(p): return np.mean(np.abs(p - actual))
def corr(p): return np.corrcoef(p, actual)[0,1]
def regime_hit(p):  # predict whether vol rises vs current; ignore ties
    pd_, td_ = np.sign(p - prev), np.sign(actual - prev)
    m = (pd_ != 0) & (td_ != 0)
    return (pd_[m] == td_[m]).mean()

print("\n" + "="*64)
print(f"VOLATILITY forecast (|return|)  —  {len(test_idx)} one-step, BTCUSDT 1h")
print("="*64)
print(f"{'model':<14}{'MAE(bps)':>10}{'MAE/persist':>13}{'corr':>8}{'regime_hit':>12}")
print("-"*64)
for name, p in [("TimesFM", tfm), ("persistence", persist), ("EWMA(.94)", ewm), ("rolling-24", roll)]:
    print(f"{name:<14}{mae(p)*1e4:>10.2f}{mae(p)/mae(persist):>13.3f}{corr(p):>8.3f}{regime_hit(p):>12.2%}")
print("-"*64)
print("MAE/persist < 1.0  -> beats the naive 'next vol = current vol' baseline")
print("corr = correlation of forecast with realized |return| (higher=better)")
print("regime_hit = % correct on whether next vol is higher/lower than current bar")
print("="*64)
