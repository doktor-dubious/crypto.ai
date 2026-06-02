"""Random-walk battery across a basket of coins -> one comparison table.

For each coin dir under coins/, compute the key predictability stats and a naive
order-flow strategy Sharpe after cost. Flags any coin whose direction shows
structure the others lack.
"""
import glob, os, sys
import numpy as np
import pandas as pd
from scipy import stats

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/home/rune/Downloads/btc/coins"
COLS = ["open_time","open","high","low","close","volume","close_time",
        "quote_vol","num_trades","taker_base","taker_quote","ignore"]
COST = 10 / 1e4  # 10 bps round-trip for the strategy column

def acf(x, nlags):
    x = x - x.mean(); d = np.sum(x*x)
    return np.array([1.0]+[np.sum(x[k:]*x[:-k])/d for k in range(1, nlags+1)])

def ljung_box(x, lags):
    n = len(x); a = acf(x, lags)[1:]
    q = n*(n+2)*np.sum([a[k]**2/(n-k-1) for k in range(lags)])
    return q, stats.chi2.sf(q, lags)

def variance_ratio(logp, q):
    x = np.diff(logp); n = len(x); mu = x.mean()
    sa = np.sum((x-mu)**2)/(n-1)
    ov = np.array([np.sum(x[t-q:t]) for t in range(q, n+1)]) - q*mu
    m = q*(n-q+1)*(1-q/n); sc = np.sum(ov**2)/m
    vr = sc/sa
    e2 = (x-mu)**2; den = np.sum(e2)**2; th = 0.0
    for j in range(1, q):
        th += (2*(q-j)/q)**2 * (np.sum(e2[j:]*e2[:-j])/den)
    z = (vr-1)/np.sqrt(th) if th > 0 else np.nan
    return vr, z

def load(d):
    files = sorted(glob.glob(f"{d}/*.csv"))
    if not files: return None
    df = pd.concat([pd.read_csv(f, header=None, names=COLS) for f in files], ignore_index=True)
    return df.sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)

rows = []
for d in sorted(glob.glob(f"{ROOT}/*")):
    if not os.path.isdir(d): continue
    sym = os.path.basename(d)
    df = load(d)
    if df is None or len(df) < 200: continue
    close = df["close"].to_numpy(float)
    r = np.diff(np.log(close)); N = len(r)
    vol = df["volume"].to_numpy(float); taker = df["taker_base"].to_numpy(float)
    imb = np.where(vol > 0, taker/np.where(vol > 0, vol, np.nan) - 0.5, np.nan)
    imb_p = imb[:N]; mask = ~np.isnan(imb_p)
    ip, tp = imb_p[mask], r[mask]
    # stats
    up = (r > 0).mean()
    ac1 = acf(r, 1)[1]   # lag-1 autocorr; strong negative + illiquid = bid-ask bounce artifact
    _, lb_ret = ljung_box(r, 10)
    _, vr8z = variance_ratio(np.log(close), 8)[0], variance_ratio(np.log(close), 8)[1]
    _, lb_vol = ljung_box(r**2, 10)
    of = stats.pearsonr(ip, tp)
    # naive order-flow strategy after cost
    g = np.sign(ip) * tp
    net = g - COST
    sharpe = net.mean()/net.std()*np.sqrt(24*365) if net.std() > 0 else np.nan
    # momentum strategy: position = sign(prev return); cost charged only on flips
    pos = np.sign(r[:-1])              # position for bar t+1 = sign(r_t)
    pnl = pos * r[1:]                  # realized next-bar return
    flips = np.abs(np.diff(np.concatenate([[0], pos]))) / 2  # 1 when position changes
    mnet = pnl - flips * COST
    msharpe = mnet.mean()/mnet.std()*np.sqrt(24*365) if mnet.std() > 0 else np.nan
    mhit = (pnl > 0).mean()
    liq = df["quote_vol"].astype(float).mean()  # avg USD/hr ~ size proxy
    rows.append(dict(sym=sym, N=N, liq=liq, up=up*100, ac1=ac1, lb_ret=lb_ret, vr8z=vr8z,
                     lb_vol=lb_vol, of_corr=of.statistic, of_p=of.pvalue, sharpe=sharpe,
                     mhit=mhit*100, msharpe=msharpe))

rows.sort(key=lambda x: -x["liq"])
print(f"\n{'coin':<9}{'~$M/hr':>8}{'up%':>7}{'AC1':>7}{'LBret_p':>9}{'VR8_z':>7}"
      f"{'momHit%':>8}{'momShrp':>8}{'OFshrp':>8}  flag")
print("-"*92)
for x in rows:
    flag = ""
    if x["lb_ret"] < 0.05: flag += "DIR? "       # return structure -> direction maybe predictable
    if x["msharpe"] > 0:   flag += "MOM+ "        # momentum strategy positive after cost (tradeable!)
    if x["sharpe"] > 0:    flag += "OF+ "         # order-flow strategy positive after cost
    print(f"{x['sym']:<9}{x['liq']/1e6:>8.1f}{x['up']:>7.2f}{x['ac1']:>+7.3f}{x['lb_ret']:>9.3f}"
          f"{x['vr8z']:>7.2f}{x['mhit']:>8.2f}{x['msharpe']:>+8.2f}{x['sharpe']:>+8.2f}  {flag}")
print("-"*92)
print("DIR? = returns show autocorrelation (Ljung-Box p<0.05) -> direction MIGHT be predictable")
print("OF+  = naive order-flow strategy Sharpe>0 AFTER 10bps cost")
print("vol  = volatility clustering present (Ljung-Box on r^2 p<0.05) -> vol forecastable")
print("Sorted by liquidity (avg $/hr) = size proxy, large-cap at top.")
