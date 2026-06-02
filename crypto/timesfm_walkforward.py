"""TimesFM 2.5 200M walk-forward directional test on BTCUSDT 1h.

Mirrors the gorm_ai TimesFMEngine load + ForecastConfig exactly. For each test
bar t: feed the prior CONTEXT closes, forecast 1 step, predicted direction =
sign(forecast - last_close); compare to actual sign(close[t+1]-close[t]).

Confirms (or refutes) that a foundation model lands at ~coin-flip on price
direction, and that its point forecast ≈ persistence (last close).
"""
import glob
import sys
import time
import numpy as np
import pandas as pd

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else "/home/rune/Downloads/btc/BTCUSDT-1h"
CONTEXT = 512          # multiple of patch_size (32)
N_TEST = 1000          # most-recent bars to score
CHUNK = 64             # series per forward pass
COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_vol", "num_trades", "taker_base", "taker_quote", "ignore"]

# ---- load ----
files = sorted(glob.glob(f"{DATA_DIR}/*.csv"))
df = pd.concat([pd.read_csv(f, header=None, names=COLS) for f in files], ignore_index=True)
df = df.sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)
close = df["close"].to_numpy(float)
print(f"{len(close)} bars from {DATA_DIR}")

# ---- load TimesFM 2.5 (same path as gorm_ai engine) ----
import timesfm
from huggingface_hub import snapshot_download

print("resolving checkpoint...")
import os
model_path = snapshot_download(repo_id="google/timesfm-2.5-200m-pytorch")
ckpt = os.path.join(model_path, "model.safetensors")
model = timesfm.TimesFM_2p5_200M_torch()
model.model.load_checkpoint(ckpt)
model.compile(timesfm.ForecastConfig(
    max_context=CONTEXT, max_horizon=128, normalize_inputs=True,
    use_continuous_quantile_head=True, force_flip_invariance=True,
    infer_is_positive=True, fix_quantile_crossing=True, return_backcast=True,
))
print("model loaded + compiled")

# ---- build test windows ----
# test bars are the last N_TEST positions that have a full CONTEXT history and a next bar
start = max(CONTEXT, len(close) - N_TEST - 1)
end = len(close) - 1                       # need close[t+1]
test_idx = list(range(start, end))
print(f"scoring {len(test_idx)} bars (context={CONTEXT})")

pred_next, last_close, actual_next = [], [], []
t0 = time.time()
for c0 in range(0, len(test_idx), CHUNK):
    batch_idx = test_idx[c0:c0 + CHUNK]
    inputs = [close[t - CONTEXT:t] for t in batch_idx]   # history up to and incl. bar t-1..t? see note
    point, _q = model.forecast(horizon=1, inputs=inputs)
    fc = np.asarray(point)[:, -1]                        # 1-step point forecast
    for k, t in enumerate(batch_idx):
        pred_next.append(fc[k])
        last_close.append(close[t - 1])                  # last observed close in the window
        actual_next.append(close[t])                     # the bar we forecast
    print(f"  {min(c0+CHUNK,len(test_idx))}/{len(test_idx)}  ({time.time()-t0:.0f}s)", end="\r")

pred_next = np.array(pred_next)
last_close = np.array(last_close)
actual_next = np.array(actual_next)

# ---- score ----
pred_dir = np.sign(pred_next - last_close)
true_dir = np.sign(actual_next - last_close)
called = pred_dir != 0
acc = (pred_dir[called] == true_dir[called]).mean()
up_rate = (true_dir > 0).mean()
baseline = max(up_rate, 1 - up_rate)

# how often does TimesFM even predict "up"?
pred_up_rate = (pred_dir > 0).mean()
# is the point forecast basically persistence? compare predicted move vs actual move
pred_move = np.abs(pred_next - last_close)
actual_move = np.abs(actual_next - last_close)

print("\n" + "=" * 60)
print(f"TimesFM 2.5 200M  —  {len(test_idx)} one-step forecasts")
print("=" * 60)
print(f"directional accuracy      = {acc:.3%}")
print(f"  vs always-majority      = {baseline:.3%}")
print(f"  vs coin flip            = 50.000%")
print(f"TimesFM predicted-up rate = {pred_up_rate:.3%}   (actual up rate {up_rate:.3%})")
print(f"mean |predicted move|     = {pred_move.mean():.2f}  ({pred_move.mean()/last_close.mean()*1e4:.2f} bps)")
print(f"mean |actual move|        = {actual_move.mean():.2f}  ({actual_move.mean()/last_close.mean()*1e4:.2f} bps)")
print(f"  -> ratio pred/actual    = {pred_move.mean()/actual_move.mean():.3f}  "
      f"({'≈persistence: model barely moves off last close' if pred_move.mean()/actual_move.mean() < 0.5 else 'model makes real-sized bets'})")
# binomial-ish CI
se = np.sqrt(0.25 / called.sum())
print(f"95% CI on accuracy        = ±{1.96*se:.3%}  (n={called.sum()})")
print("=" * 60)
