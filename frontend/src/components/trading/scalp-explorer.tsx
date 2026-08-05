"use client"

// Shared explorer for the three scalping strategies (Range / Momentum /
// Indicator). Same honesty framework as the swing explorer: fee-aware
// non-overlapping trades via the shared backend engine, SL/TP/hold-max exits,
// and Full / First-half / Second-half segments as the built-in overfitting
// check. Each strategy contributes only its entry signal + its own knobs.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { HtfGateControl } from "@/components/trading/htf-gate-control"
import { BacktestAnalysis } from "@/components/trading/backtest-analysis"
import { BacktestTrades } from "@/components/trading/backtest-trades"
import type { WorkbenchTab } from "@/components/trading/strategy-workbench"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Flag, Info } from "lucide-react"
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
  Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { scalpAnalysisApi, coinsApi, type SwingScope } from "@/lib/api"

// Server-side cap on trade_markers (services/swing_analysis.py _MAX_TRADE_MARKERS).
// Hitting it means the chart is showing a prefix, not the whole set.
const MAX_TRADE_MARKERS = 1000

const CHART_TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 6,
  backgroundColor: "var(--popover, var(--background))",
  border: "1px solid var(--border)",
  color: "var(--popover-foreground, var(--foreground))",
} as const
const CHART_TOOLTIP_LABEL_STYLE = {
  color: "var(--popover-foreground, var(--foreground))",
  fontWeight: 500,
} as const

function InfoIcon({ text }: { text: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <UITooltip>
        <TooltipTrigger asChild>
          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">{text}</TooltipContent>
      </UITooltip>
    </TooltipProvider>
  )
}

const FEE_PRESETS = [
  { value: 4, label: "Futures maker (4 bps RT)", market: "futures" },
  { value: 10, label: "Futures taker (10 bps RT)", market: "futures" },
  { value: 20, label: "Spot taker (20 bps RT)", market: "spot" },
] as const

// A fee model is offered unless the coin is known NOT to have the market it
// needs (null = unchecked → keep it). Empty result falls back to all presets.
function allowedFees(coin?: { has_spot: boolean | null; has_futures: boolean | null }) {
  const filtered = FEE_PRESETS.filter((p) =>
    p.market === "spot" ? coin?.has_spot !== false : coin?.has_futures !== false,
  )
  return filtered.length ? filtered : FEE_PRESETS
}

interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  info: string
  // When present, render a select of these numeric options instead of a
  // number input (for mode-like parameters, e.g. with-flow vs fade).
  options?: { value: number; label: string }[]
}

interface StrategyConfig {
  intro: ReactNode
  thresholdLabel: string
  thresholdInfo: string
  thresholdMin: number
  thresholdMax: number
  thresholdStep: number
  thresholdDefault: number
  sideDefault: string
  params: ParamDef[]
}

const CONFIGS: Record<string, StrategyConfig> = {
  range: {
    intro: "Fade the edges of a tight price channel: buy at support, sell at resistance — but ONLY while the channel is narrow enough to be a genuine range. Wide channels are trends, and fading a trend's edge is how range scalpers die; the max-width gate is the regime filter.",
    thresholdLabel: "Edge depth (band units)",
    thresholdInfo: "How deep into the edge band price must push before entering. 1.0 = exactly at the band boundary (e.g. the bottom 15% of the channel for longs); higher = closer to the absolute channel edge = fewer, better-priced entries.",
    thresholdMin: 0.5, thresholdMax: 2, thresholdStep: 0.1, thresholdDefault: 1.0,
    sideDefault: "both",
    params: [
      { key: "window", label: "Channel window (bars)", min: 10, max: 200, step: 1, default: 48, info: "The channel = the highest high / lowest low of the previous N bars (the current bar can't define its own support/resistance)." },
      { key: "band_pct", label: "Edge band (%)", min: 5, max: 40, step: 1, default: 15, info: "The entry zone at each channel edge, as a percentage of channel height. 15% = trade only in the outer 15% slices." },
      { key: "max_width_pct", label: "Max channel width (%)", min: 0.5, max: 10, step: 0.5, default: 3, info: "The regime gate: only channels narrower than this (height as % of price) count as ranges. Raise on volatile coins/timeframes, lower to be stricter." },
    ],
  },
  momentum: {
    intro: "Trade WITH a channel breakout when volume confirms it — the tradeable mirror of the swing explorer's breakout veto (our research: >2σ stretch on 2× volume CONTINUES, +20–26 bps/6 bars at 1h). Entry = close beyond the prior N-bar extreme with a volume spike; exits do the risk work.",
    thresholdLabel: "Volume spike (σ)",
    thresholdInfo: "Required volume z-score (vs its trailing distribution) on the breakout bar. Higher = only the most heavily-confirmed breakouts trade. 2σ matched the researched continuation effect.",
    thresholdMin: 0, thresholdMax: 5, thresholdStep: 0.25, thresholdDefault: 2.0,
    sideDefault: "both",
    params: [
      { key: "window", label: "Channel window (bars)", min: 10, max: 200, step: 1, default: 48, info: "A breakout = the close exceeding the highest high (or lowest low) of the previous N bars." },
    ],
  },
  indicator: {
    intro: "Classic single-indicator triggers, measured honestly. Fair warning from the published evidence and our own priors: raw indicator rules net of fees tend to be break-even minus costs. Their real value is as features inside a learned model or as triggers gated by a volatility forecast — this page quantifies the raw baseline.",
    thresholdLabel: "Trigger depth (σ)",
    thresholdInfo: "How far beyond the classic trigger level the signal must go. 0 = trigger exactly at the textbook level (RSI 30/70, the 2σ Bollinger band, VWAP itself); higher = deeper extremes only. EMA crosses are binary events — any threshold ≤ 1 takes every cross.",
    thresholdMin: -1, thresholdMax: 3, thresholdStep: 0.25, thresholdDefault: 0,
    sideDefault: "both",
    params: [],
  },
  streak: {
    intro: "Fade runs of same-direction closes — the one directional effect PROVEN in this project's data: after 4+ consecutive same-direction bars, the probability the next bar reverses rises to ~55–60%, monotonically with run length (z≈17 on 900k bars of BTC 5m). The catch: the gross edge is a few bps per bar, so fees and exits decide everything.",
    thresholdLabel: "Streak length (bars)",
    thresholdInfo: "Required run of consecutive same-direction closes before fading it. The reversal probability grows monotonically: ~52% at 2 bars, ~57% at 4, ~60% at 6 — but entries get rarer. 3–4 is the researched sweet spot.",
    thresholdMin: 2, thresholdMax: 8, thresholdStep: 1, thresholdDefault: 3,
    sideDefault: "both",
    params: [
      {
        key: "require_voldiv", label: "Volume divergence", min: 0, max: 1, step: 1, default: 0,
        info: "Require the run to be advancing on FALLING volume (3rd bar lighter than the 1st) — dwindling participation. In the research this conditioner roughly DOUBLED the fade edge on every dataset, at the cost of fewer entries.",
        options: [{ value: 0, label: "Not required" }, { value: 1, label: "Required" }],
      },
      {
        key: "btc_filter", label: "BTC-beta filter", min: 0, max: 2, step: 1, default: 0,
        info: "Split each bar's move into the part BTC explains (beta × BTC) and this coin's own residual, then judge the run by which one drove it. A run BTC explains is the whole market repricing — a trend, and fading it loses. A run in the residual is this coin's book overreacting, which is what reverts. Measured over 339 coins × 1 year of 5m bars: BTC-driven runs reverted −0.22 bps (monthly-block t −0.72, no edge at all) versus +1.96 bps (t 10.5) for idiosyncratic ones, against +1.32 bps unfiltered. About 29% of entries are BTC-driven, so this drops roughly a third of trades and raises the edge on the rest by about half — better gross edge AND less fee drag. 'Only BTC-driven' is the null control: if it scores like 'Only idiosyncratic', the split is noise and this should be off. Caveat: +1.96 bps gross is still under the 8 bps round-trip fee — this improves a strategy, it doesn't make one profitable. Needs BTC klines on the same timeframe; a run whose coin IS BTC ignores the setting.",
        options: [
          { value: 0, label: "Off" },
          { value: 1, label: "Only idiosyncratic runs" },
          { value: 2, label: "Only BTC-driven runs (control)" },
        ],
      },
    ],
  },
  sweep: {
    intro: "Fade the failed breakout — the classic stop-hunt print: price trades beyond the prior N-bar extreme intra-bar, sweeps the stops resting there, then CLOSES back inside the range. The rejection is the signal; perpetual-futures crypto is a stop-hunting machine, which makes this one of the most market-native patterns available from OHLC data.",
    thresholdLabel: "Sweep depth (ATR)",
    thresholdInfo: "How far beyond the prior extreme the sweep must reach, measured in 14-bar ATRs, before the rejection is faded. 0 = any poke through the level counts; higher = only deep, violent sweeps.",
    thresholdMin: 0, thresholdMax: 2, thresholdStep: 0.1, thresholdDefault: 0.1,
    sideDefault: "both",
    params: [
      { key: "window", label: "Extreme window (bars)", min: 3, max: 200, step: 1, default: 12, info: "The swept level = the highest high / lowest low of the previous N bars. 12 matches the researched swing-sweep flag; longer windows mean more significant levels swept less often." },
    ],
  },
  takerflow: {
    intro: "Trade sustained aggressive-flow imbalance: the taker-buy ratio says who is crossing the spread — market-order buyers or sellers — bar by bar. This project stores it but the wider market rarely uses it: it is the closest thing to order-flow analysis available without collecting live order-book data. Two modes: ride the flow (momentum) or fade it when it has run hot (exhaustion — the taker tilt measured at swing points flips right at the turn).",
    thresholdLabel: "Imbalance (σ)",
    thresholdInfo: "Required z-score of the rolling taker-flow imbalance versus its own trailing distribution. Higher = only the most lopsided flow episodes trade.",
    thresholdMin: 0.5, thresholdMax: 4, thresholdStep: 0.25, thresholdDefault: 1.5,
    sideDefault: "both",
    params: [
      { key: "window", label: "Flow window (bars)", min: 2, max: 100, step: 1, default: 12, info: "Bars over which the taker-buy imbalance is averaged. Short = reactive to single-bar bursts; long = sustained campaigns only." },
      {
        key: "fade", label: "Direction", min: 0, max: 1, step: 1, default: 0,
        info: "With the flow: buy when aggressive buyers dominate (momentum). Fade the flow: sell into buyer dominance / buy into seller dominance (exhaustion). The swing research saw taker tilt flip exactly at turns, which argues for fade on longer windows.",
        options: [{ value: 0, label: "With the flow" }, { value: 1, label: "Fade the flow" }],
      },
    ],
  },
}

const INDICATOR_PARAMS: Record<string, ParamDef[]> = {
  ema: [
    { key: "fast", label: "Fast EMA (bars)", min: 2, max: 100, step: 1, default: 9, info: "Fast exponential moving average. Long on fast crossing above slow, short on crossing below." },
    { key: "slow", label: "Slow EMA (bars)", min: 3, max: 400, step: 1, default: 21, info: "Slow exponential moving average — must be longer than the fast one." },
  ],
  rsi: [
    { key: "period", label: "RSI period (bars)", min: 2, max: 50, step: 1, default: 14, info: "Wilder's RSI lookback. Long when RSI drops below 30 (oversold), short above 70 — mean-reversion style." },
  ],
  bollinger: [
    { key: "period", label: "Band period (bars)", min: 5, max: 100, step: 1, default: 20, info: "Bollinger bands = SMA ± 2 standard deviations over this window. Long on touching the lower band, short on the upper." },
  ],
  vwap: [
    { key: "vwap_window", label: "VWAP window (bars)", min: 5, max: 500, step: 1, default: 96, info: "Rolling volume-weighted average price (24/7 crypto has no session VWAP). Long when price sits below VWAP, short above — deviation measured in σ of price." },
  ],
}

export type ScalpStrategy = "range" | "momentum" | "indicator" | "streak" | "sweep" | "takerflow"

export function ScalpExplorer({
  scope, strategy, activeTab, onParams, loadParams,
}: {
  scope: SwingScope
  strategy: ScalpStrategy
  // Which workbench tab is showing. Inactive regions are HIDDEN, never
  // unmounted — switching tabs must not reset a knob or refire the analysis.
  activeTab: WorkbenchTab
  // Publishes the current signal parameters so the workbench's Create Strategy
  // dialog can save them.
  onParams: (params: Record<string, unknown>) => void
  // A saved strategy's knobs to restore ("Open in Analytics"), applied once
  // per token. Null when nothing was handed over.
  loadParams: { token: string; params: Record<string, unknown> } | null
}) {
  const cfg = CONFIGS[strategy]
  const [threshold, setThreshold] = useState(cfg.thresholdDefault)
  const [holdBars, setHoldBars] = useState(6)
  const [feeBps, setFeeBps] = useState<number>(4)
  // Restrict the fee models to the Binance markets this coin actually trades on.
  const { data: coins } = useQuery({
    queryKey: ["coins"],
    queryFn: () => coinsApi.list({ limit: 1000 }),
    staleTime: 60_000,
  })
  const coin = coins?.find((c) => c.id === scope.coin_id)
  const feePresets = useMemo(() => allowedFees(coin), [coin])
  useEffect(() => {
    if (!feePresets.some((p) => p.value === feeBps)) setFeeBps(feePresets[0].value)
  }, [feePresets, feeBps])
  const [side, setSide] = useState(cfg.sideDefault)
  const [slMode, setSlMode] = useState("none")
  const [slValue, setSlValue] = useState(2)
  const [tpMode, setTpMode] = useState("none")
  const [tpValue, setTpValue] = useState(3)
  const [indicator, setIndicator] = useState("ema")
  const [paramValues, setParamValues] = useState<Record<string, number>>({})
  // Volatility-regime gate (researched pairing: ranges hold in calm regimes,
  // breakouts continue in expansions). Applies to every scalp strategy.
  const [volGate, setVolGate] = useState("off")
  const [volLevel, setVolLevel] = useState(1.0)
  // Higher-timeframe trend gate — off by default; see htf-gate-control.tsx.
  const [htfGate, setHtfGate] = useState("off")
  const [htfTf, setHtfTf] = useState("4h")
  const [htfLevel, setHtfLevel] = useState(0.5)
  const [showTradeMarkers, setShowTradeMarkers] = useState(true)

  const paramDefs = strategy === "indicator" ? INDICATOR_PARAMS[indicator] : cfg.params
  const paramsStr = useMemo(() => {
    const parts = paramDefs
      .map((d) => `${d.key}:${paramValues[d.key] ?? d.default}`)
    return parts.join(",")
  }, [paramDefs, paramValues])

  // The signal knobs saved in a template (scope excluded). showTradeMarkers is
  // view-only, so it's left out.
  const templateParams = useMemo(() => ({
    threshold, holdBars, feeBps, side, slMode, slValue, tpMode, tpValue,
    volGate, volLevel, htfGate, htfTf, htfLevel, indicator, paramValues,
  }), [threshold, holdBars, feeBps, side, slMode, slValue, tpMode, tpValue, volGate, volLevel, htfGate, htfTf, htfLevel, indicator, paramValues])

  function applyTemplate(p: Record<string, unknown>) {
    if (typeof p.threshold === "number") setThreshold(p.threshold)
    if (typeof p.holdBars === "number") setHoldBars(p.holdBars)
    if (typeof p.feeBps === "number") setFeeBps(p.feeBps)
    if (typeof p.side === "string") setSide(p.side)
    if (typeof p.slMode === "string") setSlMode(p.slMode)
    if (typeof p.slValue === "number") setSlValue(p.slValue)
    if (typeof p.tpMode === "string") setTpMode(p.tpMode)
    if (typeof p.tpValue === "number") setTpValue(p.tpValue)
    if (typeof p.volGate === "string") setVolGate(p.volGate)
    if (typeof p.volLevel === "number") setVolLevel(p.volLevel)
    if (typeof p.htfGate === "string") setHtfGate(p.htfGate)
    if (typeof p.htfTf === "string") setHtfTf(p.htfTf)
    if (typeof p.htfLevel === "number") setHtfLevel(p.htfLevel)
    if (typeof p.indicator === "string") setIndicator(p.indicator)
    if (p.paramValues && typeof p.paramValues === "object") setParamValues(p.paramValues as Record<string, number>)
  }

  // Persist every selection per strategy so it survives leaving and returning to
  // the page. Reuses the template serialization + the view-only markers toggle;
  // scope (coin/pair/timeframe/dates) is persisted separately by the scope picker.
  const storageKey = `crypt:scalpExplorer:${strategy}`
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw)
        applyTemplate(saved)
        if (typeof saved.showTradeMarkers === "boolean") setShowTradeMarkers(saved.showTradeMarkers)
      }
    } catch { /* ignore malformed storage */ }
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])
  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...templateParams, showTradeMarkers }))
    } catch { /* ignore quota/serialization errors */ }
  }, [restored, storageKey, templateParams, showTradeMarkers])

  // Publish the current params to the workbench (Create Strategy saves these).
  useEffect(() => { onParams(templateParams) }, [onParams, templateParams])

  // "Open in Analytics" handed us a saved strategy's knobs. Applied once per
  // token, AFTER the localStorage restore above (effects run in order), so the
  // strategy wins over whatever was last left on this page — and never re-applies
  // over edits made afterwards.
  const loadedTokenRef = useRef<string | null>(null)
  useEffect(() => {
    if (!loadParams || loadedTokenRef.current === loadParams.token) return
    loadedTokenRef.current = loadParams.token
    applyTemplate(loadParams.params)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadParams])

  // The Analytics tab's hour/weekday cuts are computed from the SAME backtest,
  // so they ride along on this request rather than firing a second one. Latched
  // on first visit: once asked for, keep asking, or every tab switch back would
  // change the query key and re-run the backtest.
  const [wantBuckets, setWantBuckets] = useState(false)
  useEffect(() => { if (activeTab === "analytics") setWantBuckets(true) }, [activeTab])

  // Charts must not first render inside a display:none container — a
  // ResponsiveContainer measures 0×0 there and can come back collapsed. Each
  // chart region is therefore latched on its first visit: hidden-but-mounted
  // afterwards (so nothing re-fetches), but never mounted while never-shown.
  const [seenResults, setSeenResults] = useState(false)
  const [seenAnalytics, setSeenAnalytics] = useState(false)
  useEffect(() => {
    if (activeTab === "results") setSeenResults(true)
    if (activeTab === "analytics") setSeenAnalytics(true)
  }, [activeTab])
  const [tzLocal, setTzLocal] = useState(false)
  // Positive-east offset in minutes (getTimezoneOffset is positive-west).
  const localOffset = useMemo(() => -new Date().getTimezoneOffset(), [])
  const tzOffset = tzLocal ? localOffset : 0

  const scopeKey = `${scope.coin_id}:${scope.quote_asset}:${scope.interval}:${scope.start_date}:${scope.end_date}`
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["scalpAnalysis", strategy, scopeKey, threshold, holdBars, feeBps, side, slMode, slValue, tpMode, tpValue, indicator, paramsStr, volGate, volLevel, htfGate, htfTf, htfLevel, wantBuckets, wantBuckets ? tzOffset : 0],
    queryFn: () => scalpAnalysisApi.analyze(scope, {
      strategy, indicator: strategy === "indicator" ? indicator : undefined,
      threshold, hold_bars: holdBars, fee_bps: feeBps, side,
      sl_mode: slMode, sl_value: slValue, tp_mode: tpMode, tp_value: tpValue,
      params: paramsStr || undefined, vol_gate: volGate, vol_level: volLevel,
      htf_gate: htfGate, htf_tf: htfTf, htf_level: htfLevel,
      buckets: wantBuckets, tz_offset_minutes: tzOffset,
    }),
    // Wait until saved selections are restored so we don't fire a throwaway
    // analysis with default params on every page visit.
    enabled: restored,
    retry: false,
    placeholderData: keepPreviousData,
  })

  const curve = useMemo(
    () => (data?.equity_curve ?? []).map((p) => ({
      t: new Date(p.timestamp).getTime(),
      strategy: (p.strategy - 1) * 100,
      buy_hold: (p.buy_hold - 1) * 100,
    })),
    [data],
  )
  const tradeMarkers = useMemo(
    () => (data?.trade_markers ?? []).map((m) => ({
      t: new Date(m.timestamp).getTime(),
      end: m.exit_timestamp ? new Date(m.exit_timestamp).getTime() : null,
      good: m.ret >= 0,
      short: m.side === "short",
    })),
    [data],
  )
  const signalCurve = useMemo(
    () => (data?.signal_curve ?? []).map((p) => ({ ...p, t: new Date(p.timestamp).getTime() })),
    [data],
  )
  const drawMarkers = showTradeMarkers && tradeMarkers.length <= 300
  // The server caps trade_markers at MAX_TRADE_MARKERS; the Full-range segment is
  // the only honest trade COUNT. Reporting the capped array made a 2,770-trade
  // backtest announce "1000", which reads as a real number and isn't one.
  const fullTrades = data?.segments?.find((s) => s.label === "Full range")?.n_trades ?? null
  const markersTruncated = tradeMarkers.length >= MAX_TRADE_MARKERS

  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
  const tCol = (t: number) => (t >= 3 ? "text-green-500" : t >= 2 ? "text-amber-400" : t <= -2 ? "text-red-400" : "text-muted-foreground")
  const halves = (data?.segments ?? []).filter((s) => s.label !== "Full range")
  const consistent = halves.length === 2 && halves.every((s) => s.avg_net_bps > 0)

  return (
    <>
    {/* ── Parameters ── */}
    <div className={cn("space-y-4", activeTab !== "parameters" && "hidden")}>
      <p className="text-xs text-muted-foreground max-w-3xl">{cfg.intro}</p>

      {/* Controls */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-md border p-4">
        {strategy === "indicator" && (
          <div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Indicator</label>
              <InfoIcon text="Which classic indicator generates the entries. Each has its own parameters below." />
            </div>
            <select value={indicator} onChange={(e) => { setIndicator(e.target.value); setParamValues({}) }} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
              <option value="ema">EMA cross</option>
              <option value="rsi">RSI (30/70)</option>
              <option value="bollinger">Bollinger touch</option>
              <option value="vwap">VWAP deviation</option>
            </select>
          </div>
        )}
        {paramDefs.map((d) => (
          <div key={d.key}>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{d.label}</label>
              <InfoIcon text={d.info} />
            </div>
            {d.options ? (
              <select
                value={paramValues[d.key] ?? d.default}
                onChange={(e) => setParamValues((prev) => ({ ...prev, [d.key]: Number(e.target.value) }))}
                className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm"
              >
                {d.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <Input
                type="number" min={d.min} max={d.max} step={d.step}
                value={paramValues[d.key] ?? d.default}
                onChange={(e) => {
                  const v = Math.max(d.min, Math.min(d.max, Number(e.target.value)))
                  setParamValues((prev) => ({ ...prev, [d.key]: Number.isFinite(v) ? v : d.default }))
                }}
                className="h-9 mt-1"
              />
            )}
          </div>
        ))}
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Vol regime</label>
            <InfoIcon text="Restrict entries to a volatility regime, measured as the 14-bar ATR relative to its own trailing 200-bar median. Calm = at or below the level (ranges hold in calm regimes); Expanding = at or above it (breakouts continue in expansions — measured at +20–26 bps/6 bars). This gate is the researched pairing for these strategies: try Range with calm and Momentum with expanding." />
          </div>
          <select value={volGate} onChange={(e) => setVolGate(e.target.value)} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
            <option value="off">Off</option>
            <option value="calm">Calm only</option>
            <option value="expanding">Expanding only</option>
          </select>
          <div className="mt-1 h-6">
            {volGate !== "off" && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>ATR vs median {volGate === "calm" ? "≤" : "≥"}</span>
                <Input type="number" min={0.1} max={5} step={0.1} value={volLevel}
                  onChange={(e) => setVolLevel(Math.max(0.1, Math.min(5, Number(e.target.value) || 1)))}
                  className="h-6 w-16 px-1.5 text-[11px]" />
              </div>
            )}
          </div>
        </div>
        <HtfGateControl
          baseInterval={scope.interval}
          gate={htfGate} setGate={setHtfGate}
          tf={htfTf} setTf={setHtfTf}
          level={htfLevel} setLevel={setHtfLevel}
        />
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{cfg.thresholdLabel}</label>
            <InfoIcon text={cfg.thresholdInfo} />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={cfg.thresholdMin} max={cfg.thresholdMax} step={cfg.thresholdStep} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="flex-1" />
            <span className="text-sm font-mono w-12 text-right">{threshold.toFixed(2)}</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Hold max (bars)</label>
            <InfoIcon text="Maximum holding period — the time-stop backstop. A stop loss or take profit can exit earlier. Scalps are short by definition: start small (3–6 bars)." />
          </div>
          <Input type="number" value={holdBars} min={1} max={96} onChange={(e) => setHoldBars(Math.max(1, Math.min(96, Math.round(Number(e.target.value)) || 1)))} className="h-9 mt-1" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Fees</label>
            <InfoIcon text="Round-trip trading cost. Scalping's tiny per-trade edges live or die on fees — futures maker is the only realistic venue for most of these strategies; spot taker is shown as the pessimistic bound." />
          </div>
          <select value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
            {feePresets.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Side</label>
            <InfoIcon text="Long-only, short-only, or both. Fee model is symmetric; funding/borrow costs of real shorts are not modeled." />
          </div>
          <select value={side} onChange={(e) => setSide(e.target.value)} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
            <option value="long">Long only</option>
            <option value="short">Short only</option>
            <option value="both">Both</option>
          </select>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Stop loss</label>
            <InfoIcon text={
              <div className="space-y-1.5">
                <p>Exit early when the trade moves against you (fills at the level; stop wins if stop+target could both fill in one bar).</p>
                <p><span className="font-semibold">Fixed %</span> — static stop that far beyond entry.</p>
                <p><span className="font-semibold">ATR ×</span> — k × 14-bar ATR (Wilder&apos;s Average True Range): volatility-adaptive.</p>
                <p><span className="font-semibold">Swing structure</span> — beyond the prior 12-bar extreme.</p>
                <p><span className="font-semibold">Trailing ATR ×</span> — trails the best close at k ATRs.</p>
              </div>
            } />
          </div>
          <select value={slMode} onChange={(e) => setSlMode(e.target.value)} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
            <option value="none">None</option>
            <option value="pct">Fixed %</option>
            <option value="atr">ATR ×</option>
            <option value="structure">Swing structure</option>
            <option value="trail_atr">Trailing ATR ×</option>
          </select>
          <div className="mt-1 h-6">
            {(slMode === "pct" || slMode === "atr" || slMode === "trail_atr") && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{slMode === "pct" ? "stop distance %" : "ATR multiple"}</span>
                <Input type="number" min={0.1} max={50} step={0.5} value={slValue}
                  onChange={(e) => setSlValue(Math.max(0.1, Math.min(50, Number(e.target.value) || 0.1)))}
                  className="h-6 w-16 px-1.5 text-[11px]" />
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Take profit</label>
            <InfoIcon text={
              <div className="space-y-1.5">
                <p>Exit early when the trade pays. All variants capped by Hold max.</p>
                <p><span className="font-semibold">Fixed %</span> — static target.</p>
                <p><span className="font-semibold">Resistance</span> — the prior 12-bar extreme.</p>
                <p><span className="font-semibold">Mean touch</span> — price reverting to its 20-bar average (≈ the range midpoint for range scalps).</p>
                <p><span className="font-semibold">Opposite signal</span> — hold until the strategy signals the other direction.</p>
              </div>
            } />
          </div>
          <select value={tpMode} onChange={(e) => setTpMode(e.target.value)} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
            <option value="none">None (hold max only)</option>
            <option value="pct">Fixed %</option>
            <option value="resistance">Resistance (prior extreme)</option>
            <option value="mean">Mean touch (SMA20)</option>
            <option value="reversal">Opposite signal</option>
          </select>
          <div className="mt-1 h-6">
            {tpMode === "pct" && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>target distance %</span>
                <Input type="number" min={0.1} max={100} step={0.5} value={tpValue}
                  onChange={(e) => setTpValue(Math.max(0.1, Math.min(100, Number(e.target.value) || 0.1)))}
                  className="h-6 w-16 px-1.5 text-[11px]" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* ── Results ── */}
    <div className={cn("space-y-4", activeTab !== "results" && "hidden")}>
      {!seenResults ? null : error ? (
        <p className="text-sm text-muted-foreground py-8">Analysis failed: {(error as Error).message || "request error"}</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground py-8">{isFetching ? "Analyzing… (large ranges can take a little while on the first run)" : "—"}</p>
      ) : (
        <div className={cn("space-y-4", isFetching && "opacity-60 transition-opacity")}>
          {isFetching && <p className="text-xs text-muted-foreground animate-pulse">Recomputing…</p>}

          {/* Segments — the half split is the overfitting check */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {data.segments.map((s) => (
              <div key={s.label} className="rounded-md border p-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-lg font-semibold font-mono", s.avg_net_bps >= 0 ? "text-green-500" : "text-red-400")}>
                    {s.avg_net_bps >= 0 ? "+" : ""}{s.avg_net_bps.toFixed(1)} bps
                  </span>
                  <span className="text-xs text-muted-foreground">/ trade net</span>
                  {s.n_trades >= 2 ? (
                    <span className={cn("text-xs font-mono", tCol(s.edge_t))} title="t-statistic of per-trade net returns vs zero. ≥2 nominally significant; ≥3 strong.">t={s.edge_t.toFixed(1)}</span>
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground" title="Significance needs at least 2 trades.">t=—</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>{s.n_trades} trades · {s.win_rate_pct.toFixed(0)}% win</p>
                  <p>
                    Return <span className={cn("font-mono", s.total_return_pct >= 0 ? "text-green-500" : "text-red-400")}>{fmtPct(s.total_return_pct)}</span>
                    {" "}vs B&H <span className="font-mono">{fmtPct(s.buy_hold_return_pct)}</span>
                  </p>
                  <p>Sharpe {s.sharpe.toFixed(2)} · maxDD {s.max_drawdown_pct.toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs">
            {halves.length === 2 && (consistent
              ? <span className="text-green-500">Edge is positive in both halves — consistent with a real signal (still confirm on other coins/periods).</span>
              : <span className="text-amber-400">Edge does not hold in both halves — treat the full-range number as curve-fit until it does.</span>)}
            <span className="text-muted-foreground"> {data.long_entries} long / {data.short_entries} short entries. Exits: {data.exit_counts.stop ?? 0} stop · {data.exit_counts.take_profit ?? 0} take-profit · {data.exit_counts.reversal ?? 0} reversal · {data.exit_counts.hold_max ?? 0} hold-max.</span>
          </p>

          {/* Equity curve */}
          <div className="relative rounded-md border bg-card p-2">
            <button
              type="button"
              onClick={() => setShowTradeMarkers((v) => !v)}
              aria-label={showTradeMarkers ? "Hide trade markers" : "Show trade markers"}
              title="Toggle trade markers (green = winning trade, red = losing)"
              className={cn(
                "absolute top-2 right-2 z-10 rounded p-1.5 transition-colors",
                showTradeMarkers ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Flag className="h-4 w-4" />
            </button>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={curve} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
                  tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                {drawMarkers && tradeMarkers.map((m, idx) => (
                  m.end != null && (
                    <ReferenceArea key={`sa-${idx}`} x1={m.t} x2={m.end} fill={m.good ? "#22c55e" : "#ef4444"} fillOpacity={0.07} stroke="none" />
                  )
                ))}
                {drawMarkers && tradeMarkers.map((m, idx) => (
                  <ReferenceLine key={`sl-${idx}`} x={m.t} stroke={m.good ? "#22c55e" : "#ef4444"} strokeOpacity={0.25} strokeWidth={2} strokeDasharray={m.short ? "4 3" : undefined} />
                ))}
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  formatter={((v: any, name: any) => [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`, name === "strategy" ? "Strategy" : "Buy & hold"]) as any}
                  contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                />
                <Line type="monotone" dataKey="buy_hold" stroke="#888" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="strategy" stroke="#26a69a" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="px-2 pb-1 text-[10px] text-muted-foreground">
              {showTradeMarkers && !drawMarkers ? (
                <span className="text-amber-400">
                  Too many trades ({fullTrades ?? tradeMarkers.length}) to draw individual markers — narrow the date range or tighten the entry to see them.
                  {markersTruncated && " Only the first 1,000 are charted; the segment figures above cover every trade."}{" "}
                </span>
              ) : (
                <>Shaded bands = each trade&apos;s in-market window; colour = outcome (green won, red lost); solid entry lines are longs, dashed are shorts. </>
              )}
            </p>
          </div>

          {/* Entry-signal chart */}
          <div className="rounded-md border bg-card p-2">
            <div className="flex items-center gap-3 px-2 pt-1 pb-2">
              <p className="text-xs font-medium text-muted-foreground">Entry signal</p>
              <InfoIcon text="The strategy's per-bar entry scores. A trade opens when the traded side's score reaches the dashed threshold line. Decimation keeps each bucket's strongest bar, so triggering spikes stay visible." />
              <span className="text-xs"><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: "#26a69a" }} />Long score</span>
              <span className="text-xs"><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: "#ef4444" }} />Short score</span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={signalCurve} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
                  tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                {drawMarkers && tradeMarkers.map((m, idx) => (
                  <ReferenceLine key={`sg-${idx}`} x={m.t} stroke={m.good ? "#22c55e" : "#ef4444"} strokeOpacity={0.18} strokeWidth={2} strokeDasharray={m.short ? "4 3" : undefined} />
                ))}
                <ReferenceLine y={0} stroke="var(--border)" />
                <ReferenceLine y={threshold} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.8}
                  label={{ value: `threshold ${threshold.toFixed(2)}`, position: "insideTopRight", fontSize: 10, fill: "#eab308" }} />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  formatter={((v: any, name: any) => [Number(v).toFixed(2), name === "long_score" ? "Long score" : "Short score"]) as any}
                  contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                />
                <Line type="monotone" dataKey="short_score" stroke="#ef4444" strokeWidth={1.2} strokeOpacity={0.85} dot={false} isAnimationActive={false} connectNulls />
                <Line type="monotone" dataKey="long_score" stroke="#26a69a" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="text-xs text-muted-foreground">
            Signal computed from raw OHLCV, trailing windows only (no lookahead). Entries are non-overlapping, held up to {data.hold_bars} bars{data.sl_mode !== "none" ? ", stopped out when the stop level is touched" : ""}{data.tp_mode !== "none" ? ", taking profit per the selected target" : ""}; intra-bar level exits fill at the level (stop wins if both could fill in one bar); {data.fee_bps} bps per round trip. Knobs tuned here are in-sample — trust a setting only if it holds in the second half and on other coins/periods.
          </p>

          {/* The trades themselves, under the charts. */}
          <BacktestTrades
            rows={data.trade_rows ?? []}
            totalTrades={fullTrades}
            scope={scope}
            strategy={strategy}
            params={templateParams}
          />

        </div>
      )}
    </div>

    {/* ── Analytics ── */}
    <div className={cn(activeTab !== "analytics" && "hidden")}>
      {seenAnalytics && <BacktestAnalysis
        data={data?.bucket_analysis}
        isFetching={isFetching}
        isError={!!error}
        useLocal={tzLocal}
        onUseLocalChange={setTzLocal}
        tzOffset={tzOffset}
        onRefresh={() => refetch()}
      />}
    </div>
    </>
  )
}
