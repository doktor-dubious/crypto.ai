"""TimesFM vs GARCH(1,1) vs naive baselines — volatility walk-forward, BTCUSDT 1h.

Upgrades over v1:
  * TARGET = Parkinson range-vol (uses high/low; ~5x less noisy than |return|).
  * Adds GARCH(1,1) benchmark — the standard econometric vol model.
    Fit by MLE on TRAIN only, then filtered forward (params fixed, recursion uses
    only realized past returns) => honest one-step-ahead OOS forecasts.
GARCH forecasts return-std; rescaled to Parkinson units by a constant fit on
TRAIN only, so MAE is comparable across all models.
"""
import glob, os, sys, time
import numpy as np
import pandas as pd
from scipy.optimize import minimize

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else "/home/rune/Downloads/btc/BTCUSDT-1h"
CONTEXT, N_TEST, CHUNK = 512, 1000, 64
COLS = ["open_time","open","high","low","close","volume","close_time",
        "quote_vol","num_trades","taker_base","taker_quote","ignore"]

files = sorted(glob.glob(f"{DATA_DIR}/*.csv"))
df = pd.concat([pd.read_csv(f, header=None, names=COLS) for f in files], ignore_index=True)
df = df.sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)
close = df["close"].to_numpy(float); high = df["high"].to_numpy(float); low = df["low"].to_numpy(float)
M = len(df)

# --- targets / series (per bar, length M) ---
r = np.zeros(M); r[1:] = np.diff(np.log(close))            # bar return
pk = np.sqrt((np.log(high/low)**2) / (4*np.log(2)))        # Parkinson per-bar vol
test_start = M - N_TEST
print(f"{M} bars, target=Parkinson vol, test={N_TEST} from {DATA_DIR}")

# --- GARCH(1,1) by MLE on training returns ---
def garch_nll(params, x, v0):
    omega, alpha, beta = params
    if omega <= 0 or alpha < 0 or beta < 0 or alpha+beta >= 0.999: return 1e12
    n = len(x); s2 = v0
    ll = 0.0
    for t in range(n):
        ll += np.log(s2) + x[t]*x[t]/s2
        s2 = omega + alpha*x[t]*x[t] + beta*s2
    return 0.5*ll

train_r = r[max(1, test_start-3000):test_start]            # last 3000 train bars
train_r = train_r - train_r.mean()
v0 = np.var(train_r)
res = minimize(garch_nll, [v0*0.05, 0.08, 0.90], args=(train_r, v0),
               method="L-BFGS-B", bounds=[(1e-14, None), (0, 1), (0, 1)])
omega, alpha, beta = res.x
print(f"GARCH(1,1) fit: omega={omega:.2e} alpha={alpha:.3f} beta={beta:.3f} (persistence a+b={alpha+beta:.3f})")

# filter conditional variance forward over the FULL series with fixed params
mu = train_r.mean()
s2 = np.empty(M); s2[0] = v0
for t in range(1, M):
    s2[t] = omega + alpha*(r[t-1]-mu)**2 + beta*s2[t-1]    # forecast for bar t, uses info <= t-1
garch_sigma = np.sqrt(s2)
# rescale GARCH (return-std) -> Parkinson units, constant fit on TRAIN only
c = pk[CONTEXT:test_start].mean() / garch_sigma[CONTEXT:test_start].mean()
garch_pred_full = c * garch_sigma

# EWMA(.94) of Parkinson, causal
lam = 0.94; ewma = np.empty(M); ewma[0] = pk[0]
for i in range(1, M):
    ewma[i] = lam*ewma[i-1] + (1-lam)*pk[i]

# --- TimesFM ---
import timesfm
from huggingface_hub import snapshot_download
mp = snapshot_download(repo_id="google/timesfm-2.5-200m-pytorch")
model = timesfm.TimesFM_2p5_200M_torch()
model.model.load_checkpoint(os.path.join(mp, "model.safetensors"))
model.compile(timesfm.ForecastConfig(max_context=CONTEXT, max_horizon=128, normalize_inputs=True,
    use_continuous_quantile_head=True, force_flip_invariance=True, infer_is_positive=True,
    fix_quantile_crossing=True, return_backcast=True))
print("model loaded + compiled")

test_idx = list(range(test_start, M))
tfm, actual, persist, ewm, roll, garch, prev = [], [], [], [], [], [], []
t0 = time.time()
for c0 in range(0, len(test_idx), CHUNK):
    bi = test_idx[c0:c0+CHUNK]
    point, _q = model.forecast(horizon=1, inputs=[pk[i-CONTEXT:i] for i in bi])
    fc = np.asarray(point)[:, -1]
    for k, i in enumerate(bi):
        tfm.append(max(fc[k], 0.0)); actual.append(pk[i]); prev.append(pk[i-1])
        persist.append(pk[i-1]); ewm.append(ewma[i-1]); roll.append(pk[i-24:i].mean())
        garch.append(garch_pred_full[i])
    print(f"  {min(c0+CHUNK,len(test_idx))}/{len(test_idx)} ({time.time()-t0:.0f}s)", end="\r")

tfm, actual, prev = np.array(tfm), np.array(actual), np.array(prev)
persist, ewm, roll, garch = map(np.array, (persist, ewm, roll, garch))

def mae(p): return np.mean(np.abs(p-actual))
def corr(p): return np.corrcoef(p, actual)[0,1]
def regime_hit(p):
    pd_, td_ = np.sign(p-prev), np.sign(actual-prev); m = (pd_ != 0) & (td_ != 0)
    return (pd_[m] == td_[m]).mean()

print("\n" + "="*66)
print(f"VOLATILITY forecast (Parkinson range-vol) — {N_TEST} one-step, BTCUSDT 1h")
print("="*66)
print(f"{'model':<14}{'MAE(bps)':>10}{'MAE/persist':>13}{'corr':>8}{'regime_hit':>12}")
print("-"*66)
for name, p in [("TimesFM", tfm), ("GARCH(1,1)", garch), ("persistence", persist),
                ("EWMA(.94)", ewm), ("rolling-24", roll)]:
    print(f"{name:<14}{mae(p)*1e4:>10.2f}{mae(p)/mae(persist):>13.3f}{corr(p):>8.3f}{regime_hit(p):>12.2%}")
print("-"*66)
print("Honest GARCH benchmark: MLE fit on train, filtered forward (no look-ahead).")
print("MAE/persist < 1 beats naive; the bar that matters is beating GARCH.")
print("="*66)
