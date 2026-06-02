# %% [markdown]
# # BTC 1h — Null-Hypothesis / Predictability Screen
#
# Goal: before building any forecasting pipeline, find out whether hourly BTC
# direction carries *any* exploitable signal beyond a random walk, and whether
# the extra kline columns (taker order-flow) help.
#
# This is a SCREEN, not proof. Caveats baked in at the bottom: single month,
# ~695 returns, in-sample, thin venue, no multiple-testing correction.
#
# Runs with only pandas/numpy/scipy. `# %%` markers let it open as a notebook.

# %%
import glob
import numpy as np
import pandas as pd
from scipy import stats

import sys
DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else "/home/rune/Downloads/btc/1hr/unzipped"
COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_vol", "num_trades", "taker_base", "taker_quote", "ignore"]

files = sorted(glob.glob(f"{DATA_DIR}/*.csv"))
df = pd.concat([pd.read_csv(f, header=None, names=COLS) for f in files], ignore_index=True)
df = df.sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)
df["dt"] = pd.to_datetime(df["open_time"] / 1_000_000, unit="s")

close = df["close"].to_numpy(float)
open_ = df["open"].to_numpy(float)
r = np.diff(np.log(close))            # close-to-close log returns, length N-1
N = len(r)
print(f"{len(df)} bars  |  {df['dt'].iloc[0]} -> {df['dt'].iloc[-1]}  |  {N} returns")
print(f"hourly return: mean={r.mean()*1e4:+.2f} bps  std={r.std()*1e4:.1f} bps  "
      f"annualized vol≈{r.std()*np.sqrt(24*365)*100:.0f}%")


# %% [markdown]
# ## 1. Direction base rates  (what does "always guess the majority" score?)
# Two notions of direction:
#  - **close-to-close** (tradeable: buy now, sell next bar) — this is the real target
#  - **candle colour** (close>open within the bar) — your "green/red" framing

# %%
def binom(k, n):
    p = k / n
    pval = stats.binomtest(k, n, 0.5).pvalue
    return p, pval

up_cc = r > 0
green = (close > open_)[1:]           # align to same bars as r
flat_cc = r == 0
print("close-to-close:")
p, pv = binom(int(up_cc.sum()), N)
print(f"  up={up_cc.mean():.3%}  flat={flat_cc.mean():.3%}  "
      f"majority-class baseline={max(p,1-p):.3%}  (binom p vs 50% = {pv:.3f})")
p, pv = binom(int(green.sum()), N)
print(f"candle green={green.mean():.3%}  majority={max(p,1-p):.3%}  (p={pv:.3f})")
print("\n>> Beat THIS number, not 50%. Drift alone makes 'always up' > 50%.")


# %% [markdown]
# ## 2. Baselines to beat
# - **Persistence/momentum**: next direction = this bar's direction
# - **Majority**: always predict the majority class
# A real model must beat both out-of-sample.

# %%
# momentum: predict sign(r_t) for r_{t+1}
pred_mom = np.sign(r[:-1])
hit_mom = (np.sign(r[1:]) == pred_mom) & (pred_mom != 0)
acc_mom = hit_mom.sum() / (pred_mom != 0).sum()
maj_dir = 1 if up_cc.mean() >= 0.5 else -1
acc_maj = (np.sign(r) == maj_dir).mean()
print(f"persistence/momentum accuracy = {acc_mom:.3%}")
print(f"always-majority   accuracy = {acc_maj:.3%}")


# %% [markdown]
# ## 3. Return autocorrelation + Ljung-Box  (the core EMH test)
# If returns have no autocorrelation, direction is unpredictable *from price alone*.
# ACF bands are ±1.96/√N (white-noise 95%).

# %%
def acf(x, nlags):
    x = x - x.mean()
    denom = np.sum(x * x)
    return np.array([1.0] + [np.sum(x[k:] * x[:-k]) / denom for k in range(1, nlags + 1)])

def ljung_box(x, lags):
    n = len(x)
    a = acf(x, lags)[1:]
    q = n * (n + 2) * np.sum([a[k] ** 2 / (n - k - 1) for k in range(lags)])
    return q, stats.chi2.sf(q, lags)

band = 1.96 / np.sqrt(N)
ac = acf(r, 24)
sig = [(k, ac[k]) for k in range(1, 25) if abs(ac[k]) > band]
print(f"ACF 95% band = ±{band:.3f}")
print("significant return-ACF lags:", [(k, round(v, 3)) for k, v in sig] or "NONE")
for L in (1, 5, 10, 24):
    q, pv = ljung_box(r, L)
    flag = "<-- structure" if pv < 0.05 else "random-walk consistent"
    print(f"  Ljung-Box(lags={L:>2}): Q={q:7.2f}  p={pv:.3f}   {flag}")


# %% [markdown]
# ## 4. Variance-ratio test (Lo–MacKinlay, heteroskedasticity-robust)
# VR(q) ≈ 1 → random walk. <1 → mean-reversion, >1 → momentum/trending.
# z* is N(0,1); |z*|>1.96 rejects random walk at 5%.

# %%
def variance_ratio(logp, q):
    x = np.diff(logp)
    n = len(x)
    mu = x.mean()
    sa = np.sum((x - mu) ** 2) / (n - 1)
    overlap = np.array([np.sum(x[t - q:t]) for t in range(q, n + 1)]) - q * mu
    m = q * (n - q + 1) * (1 - q / n)
    sc = np.sum(overlap ** 2) / m
    vr = sc / sa
    # het-robust standard error
    e2 = (x - mu) ** 2
    denom = np.sum(e2) ** 2
    theta = 0.0
    for j in range(1, q):
        delta = np.sum(e2[j:] * e2[:-j]) / denom
        theta += (2 * (q - j) / q) ** 2 * delta
    z = (vr - 1) / np.sqrt(theta) if theta > 0 else np.nan
    return vr, z

logp = np.log(close)
for q in (2, 4, 8, 12):
    vr, z = variance_ratio(logp, q)
    flag = "REJECT random walk" if abs(z) > 1.96 else "random-walk consistent"
    print(f"  VR({q:>2}) = {vr:.3f}   z* = {z:+.2f}   {flag}")


# %% [markdown]
# ## 5. Volatility clustering  (is the *constructive* target predictable?)
# Direction may be noise while volatility is forecastable. ACF of |returns| +
# Ljung-Box on squared returns. Significant here = pivot to vol forecasting.

# %%
ac_abs = acf(np.abs(r), 24)
sig_abs = [(k, round(ac_abs[k], 3)) for k in range(1, 25) if abs(ac_abs[k]) > band]
print("significant |return|-ACF lags:", sig_abs or "NONE")
q, pv = ljung_box(r ** 2, 10)
print(f"Ljung-Box on r^2 (lags=10): Q={q:.2f}  p={pv:.4f}  "
      f"{'VOL IS PREDICTABLE <--' if pv < 0.05 else 'no vol clustering'}")


# %% [markdown]
# ## 6. Order-flow signal  (do the taker columns predict the NEXT bar?)
# imbalance_t = taker_buy_base / volume - 0.5  ∈ [-0.5, +0.5]
# Test imbalance_t vs r_{t+1}: does buy pressure now predict the next move?

# %%
vol = df["volume"].to_numpy(float)
taker = df["taker_base"].to_numpy(float)
imb = np.where(vol > 0, taker / np.where(vol > 0, vol, np.nan) - 0.5, np.nan)
# align: imbalance at bar t (index i) vs next return r_{t+1} (r index i)
imb_t = imb[1:N + 1]            # imbalance of bar that produced return... use bar i -> r[i] is close[i+1]/close[i]
# predictor = imbalance of bar i, target = r[i] (move into next close). Use bars 0..N-1
imb_pred = imb[:N]
mask = ~np.isnan(imb_pred)
ip, tp = imb_pred[mask], r[mask]
pear = stats.pearsonr(ip, tp)
spear = stats.spearmanr(ip, tp)
print(f"n usable (volume>0) = {mask.sum()} / {N}")
print(f"corr(imbalance_t, r_t→next): Pearson={pear.statistic:+.3f} (p={pear.pvalue:.3f})  "
      f"Spearman={spear.statistic:+.3f} (p={spear.pvalue:.3f})")
# conditional hit rate
hi = ip > np.median(ip)
print(f"P(next up | buy-pressure high) = {(tp[hi] > 0).mean():.3%}")
print(f"P(next up | buy-pressure low ) = {(tp[~hi] > 0).mean():.3%}")
# also same-bar contemporaneous (sanity: should be strongly positive)
con = stats.pearsonr(imb_pred[mask], r[mask])  # imbalance and that bar's own return
samebar = stats.pearsonr(imb[1:][~np.isnan(imb[1:])], r[~np.isnan(imb[1:])])
print(f"(sanity) corr(imbalance_t, SAME-bar return) = {samebar.statistic:+.3f}  "
      f"<- should be strongly + if columns are sane")


# %% [markdown]
# ## 7. Cost band → tradeable subset + naive order-flow strategy
# Hourly moves must clear round-trip cost to be tradeable. Report at several
# cost levels. Then a toy strategy: go with sign(imbalance_t) next bar, net of cost.

# %%
print("fraction of bars with |return| below a round-trip cost band:")
for bps in (2, 5, 10, 20):
    band_c = bps / 1e4
    frac = (np.abs(r) < band_c).mean()
    print(f"  cost={bps:>2}bps : {frac:5.1%} of bars are sub-cost (untradeable noise)")

print("\nnaive strategy: position = sign(imbalance_t), held 1 bar, net of cost")
sig_pos = np.sign(imb_pred[mask])
gross = sig_pos * tp
for bps in (0, 5, 10, 20):
    cost = bps / 1e4
    # pay cost when position changes (approx: every bar, conservative)
    net = gross - cost
    ann = net.mean() / net.std() * np.sqrt(24 * 365) if net.std() > 0 else np.nan
    print(f"  cost={bps:>2}bps: mean/bar={net.mean()*1e4:+.2f}bps  "
          f"hit={ (gross>0).mean():.1%}  Sharpe(ann)={ann:+.2f}")
bh = r.mean() / r.std() * np.sqrt(24 * 365)
print(f"  buy-and-hold Sharpe(ann) = {bh:+.2f}")


# %% [markdown]
# ## VERDICT CHEATSHEET
# - Returns ACF / Ljung-Box / VR all insignificant + strategy Sharpe ≤ buy-hold
#   after cost  →  **price direction is a random walk here. Do NOT build a price
#   forecaster.** Pivot to volatility (Sec 5) if that's significant.
# - Order-flow corr significant AND strategy Sharpe > 0 after realistic cost
#   →  signal worth pursuing; feed taker imbalance as a covariate to the models.
#
# CAVEATS: 1 month / ~695 obs / single thin venue / in-sample / many tests run
# (some will look significant by chance). This screens go/no-go; it does not
# prove an edge. Confirm anything promising on more data, out-of-sample.
