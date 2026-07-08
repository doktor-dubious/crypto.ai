"use client"

// Swing/crest signal explorer (Trading → Strategies → Trend Swings).
// Pure kline analysis over an explicit scope — no simulation required. The
// composite is built from raw OHLCV signals (volume/range spike, wick
// pressure, taker tilt, participation, streak, stretch + sweep/divergence
// flags), z-scored on trailing windows only. A simulation enters only via the
// optional model-confirmation filter (confirmSimId), which borrows a run's
// stored P(up) forecasts. Moved here from the simulations/completed "Swings"
// tab, which analyzed the same data but misleadingly lived under a run.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useRegisterTemplateBridge } from "@/components/trading/template-context"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { Flag, Info } from "lucide-react"
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
  Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { swingAnalysisApi, type SwingScope } from "@/lib/api"

export interface SwingsExplorerProps {
  scope: SwingScope
  // Simulation whose stored P(up) forecasts back the model-confirmation
  // filter; null = the filter is unavailable for this scope.
  confirmSimId: string | null
  confirmSimName?: string | null
}

// Theme-aware recharts tooltip styling — the library default is a white box
// that ignores dark mode. CSS variables track the active theme.
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
// ── Swings tab: signal-composite crest/swing backtest over the run's klines ──
// Needs no model forecast: the composite is built from raw OHLCV signals
// (volume/range spike, wick pressure, taker tilt, participation, streak,
// stretch + sweep/divergence flags), z-scored on trailing windows only.
const SWING_FEE_PRESETS = [
  { value: 4, label: "Futures maker (4 bps RT)" },
  { value: 10, label: "Futures taker (10 bps RT)" },
  { value: 20, label: "Spot taker (20 bps RT)" },
] as const

// Composite members, toggleable individually. z components are equal-weight
// averaged; flags add a +0.25 bonus each when firing.
const SWING_SIGNALS = [
  {
    key: "streak", label: "Streak state", flag: false,
    info: "Length of the run of consecutive same-direction closes (down-runs feed the bottom signal, up-runs the top signal). The one directional signal proven in this data: after 4+ same-direction bars the probability the next bar reverses rises to ~55–60%, monotonically with run length.",
  },
  {
    key: "volume", label: "Volume spike", flag: false,
    info: "Bar volume relative to its trailing 50-bar median, z-scored. Swings are climactic, not quiet: the turn bar runs 1.4–1.6× normal volume (panic selling at bottoms, blow-off buying at tops), with the ramp starting 2–3 bars earlier.",
  },
  {
    key: "range", label: "Range spike", flag: false,
    info: "Bar range volatility, ln(high/low), relative to its trailing 50-bar median, z-scored. Like volume, the candle range expands sharply at the turn (1.3–1.5× normal) — reversals happen on violent bars.",
  },
  {
    key: "trades", label: "Participation", flag: false,
    info: "Number of individual trades in the bar vs its trailing median, z-scored. Participation swells 2–3 bars ahead of a swing (1.3–1.4× normal at the turn), strongest at bottoms — a crowd rushing for the exit marks the low.",
  },
  {
    key: "avg_trade", label: "Avg trade size", flag: false,
    info: "Average trade size (volume ÷ trade count) vs its trailing median, z-scored. Separates many small panicked retail orders from few large absorbing ones; mildly elevated (~1.1×) at swing bars.",
  },
  {
    key: "wick", label: "Wick pressure", flag: false,
    info: "6-bar average of the wick fraction on the far side of the move: upper wicks into a top (sellers repeatedly pushing the close off the highs), lower wicks into a bottom. Runs ~5–13% above normal during the final bars before a turn — one of the few genuinely LEADING signatures.",
  },
  {
    key: "taker", label: "Taker tilt", flag: false,
    info: "Taker-buy ratio: the share of volume from aggressive (market-order) buyers. Buyers dominate into tops and flip to net selling right after; mirrored at bottoms. For the bottom signal, seller dominance counts positively — capitulation flow.",
  },
  {
    key: "stretch", label: "Stretch (z20)", flag: false,
    info: "How far price sits from its 20-bar average, in standard deviations (z20). Overstretched tends to snap back — buying below −2σ earned +7.6 bps/6 bars on BTC 15m. Interacts with the breakout veto: stretched-up WITH 2× volume is momentum and is never faded.",
  },
  {
    key: "sweep", label: "Sweep", flag: true,
    info: "Failed-breakout flag: the bar trades beyond the prior 12-bar extreme intra-bar but closes back inside it — the classic stop-hunt print where a breakout attempt is rejected. Adds +0.25 to the composite when firing.",
  },
  {
    key: "voldiv", label: "Volume divergence", flag: true,
    info: "The 3rd same-direction bar prints on LOWER volume than the 1st — the move is advancing on dwindling participation. The strongest confirmed conditioner in the research: it roughly doubled the streak-fade edge on every dataset. Adds +0.25 when firing.",
  },
  {
    key: "decel", label: "Deceleration", flag: true,
    info: "Three same-direction bars with each move smaller than the last — momentum exhausting into the turn. Weak on its own in the research, but a cheap confirmation. Adds +0.25 when firing.",
  },
] as const

// Distinct line colours for component overlays on the composite-signal chart.
const SWING_COMPONENT_COLORS: Record<string, string> = {
  streak: "#60a5fa", volume: "#f59e0b", range: "#a78bfa", trades: "#34d399",
  avg_trade: "#f472b6", wick: "#22d3ee", taker: "#fb923c", stretch: "#eab308",
}

export function SwingsExplorer({ scope, confirmSimId, confirmSimName }: SwingsExplorerProps) {
  const [threshold, setThreshold] = useState(1.0)
  const [holdBars, setHoldBars] = useState(6)
  const [feeBps, setFeeBps] = useState<number>(4)
  const [side, setSide] = useState("long")
  const [useModel, setUseModel] = useState(false)
  const [slMode, setSlMode] = useState("none")
  const [slValue, setSlValue] = useState(2)
  const [tpMode, setTpMode] = useState("none")
  const [tpValue, setTpValue] = useState(3)
  const [showTradeMarkers, setShowTradeMarkers] = useState(true)
  // Which chart (if any) is maximized to a full-viewport overlay.
  const [maximizedChart, setMaximizedChart] = useState<"equity" | "signal" | null>(null)
  useEffect(() => {
    if (!maximizedChart) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMaximizedChart(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [maximizedChart])
  // Disabled composite members (default: none — all signals participate).
  const [disabledSignals, setDisabledSignals] = useState<Set<string>>(new Set())
  // Per-member contribution percentages (missing = 100 = equal-weight baseline).
  const [weightPct, setWeightPct] = useState<Record<string, number>>({})
  // Component series overlaid on the composite-signal chart (default: none).
  const [overlay, setOverlay] = useState<Set<string>>(new Set())
  // Composite total lines on the signal chart, toggleable like the components.
  const [showLongLine, setShowLongLine] = useState(true)
  const [showShortLine, setShowShortLine] = useState(true)

  const enabledParam = useMemo(() => {
    if (disabledSignals.size === 0) return undefined
    return SWING_SIGNALS.filter((s) => !disabledSignals.has(s.key)).map((s) => s.key).join(",")
  }, [disabledSignals])

  const weightsParam = useMemo(() => {
    const parts = Object.entries(weightPct)
      .filter(([, pct]) => pct !== 100)
      .map(([k, pct]) => `${k}:${pct}`)
    return parts.length ? parts.join(",") : undefined
  }, [weightPct])

  // Signal knobs saved in a template. Scope and the model-confirmation filter
  // (useModel/confirmSimId — coin-specific) are excluded; the Set is stored as
  // an array so it JSON-serializes.
  const templateParams = useMemo(() => ({
    threshold, holdBars, feeBps, side, slMode, slValue, tpMode, tpValue,
    disabledSignals: [...disabledSignals], weightPct,
  }), [threshold, holdBars, feeBps, side, slMode, slValue, tpMode, tpValue, disabledSignals, weightPct])

  function applyTemplate(p: Record<string, unknown>) {
    if (typeof p.threshold === "number") setThreshold(p.threshold)
    if (typeof p.holdBars === "number") setHoldBars(p.holdBars)
    if (typeof p.feeBps === "number") setFeeBps(p.feeBps)
    if (typeof p.side === "string") setSide(p.side)
    if (typeof p.slMode === "string") setSlMode(p.slMode)
    if (typeof p.slValue === "number") setSlValue(p.slValue)
    if (typeof p.tpMode === "string") setTpMode(p.tpMode)
    if (typeof p.tpValue === "number") setTpValue(p.tpValue)
    if (Array.isArray(p.disabledSignals)) setDisabledSignals(new Set(p.disabledSignals as string[]))
    if (p.weightPct && typeof p.weightPct === "object") setWeightPct(p.weightPct as Record<string, number>)
  }

  // Persist every selection so it survives leaving and returning to the page.
  // Reuses the template serialization plus the view toggles the template omits;
  // scope is persisted separately by the scope picker. confirmSimId is a coin-
  // specific prop, so only the useModel toggle is remembered here.
  const storageKey = "crypt:swingsExplorer"
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw)
        applyTemplate(saved)
        if (typeof saved.useModel === "boolean") setUseModel(saved.useModel)
        if (typeof saved.showTradeMarkers === "boolean") setShowTradeMarkers(saved.showTradeMarkers)
        if (Array.isArray(saved.overlay)) setOverlay(new Set(saved.overlay as string[]))
        if (typeof saved.showLongLine === "boolean") setShowLongLine(saved.showLongLine)
        if (typeof saved.showShortLine === "boolean") setShowShortLine(saved.showShortLine)
      }
    } catch { /* ignore malformed storage */ }
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        ...templateParams, useModel, showTradeMarkers,
        overlay: [...overlay], showLongLine, showShortLine,
      }))
    } catch { /* ignore quota/serialization errors */ }
  }, [restored, templateParams, useModel, showTradeMarkers, overlay, showLongLine, showShortLine])

  // Expose params + scope + apply fn to the topbar template modal.
  useRegisterTemplateBridge(
    "swings",
    () => templateParams,
    applyTemplate,
    () => ({ coin_id: scope.coin_id, quote_asset: scope.quote_asset, interval: scope.interval }),
  )

  // The model-confirmation filter needs a simulation's stored forecasts.
  const confirmId = useModel && confirmSimId ? confirmSimId : undefined
  const scopeKey = `${scope.coin_id}:${scope.quote_asset}:${scope.interval}:${scope.start_date}:${scope.end_date}`

  const { data, isFetching, error } = useQuery({
    queryKey: ["swingAnalysis", scopeKey, threshold, holdBars, feeBps, side, confirmId ?? "none", enabledParam ?? "all", slMode, slValue, tpMode, tpValue, weightsParam ?? "eq"],
    queryFn: () => swingAnalysisApi.analyze(scope, {
      threshold, hold_bars: holdBars, fee_bps: feeBps, side, confirm_sim_id: confirmId, signals: enabledParam,
      sl_mode: slMode, sl_value: slValue, tp_mode: tpMode, tp_value: tpValue, weights: weightsParam,
    }),
    // Wait until saved selections are restored so we don't fire a throwaway
    // analysis with default params on every page visit.
    enabled: restored,
    retry: false,
    // Keep the previous results (charts, segments) on screen while a knob
    // change or scope change recomputes — no blanking to a spinner.
    placeholderData: keepPreviousData,
  })

  const toggleSignal = (key: string) =>
    setDisabledSignals((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })

  // Auto-optimizer: bounded server-side sweep (fee/model-confirmation taken
  // from the current knobs), tuned on the first half, judged on the second.
  const optimize = useMutation({
    mutationFn: () => swingAnalysisApi.optimize(scope, { fee_bps: feeBps, confirm_sim_id: confirmId }),
  })
  // Sweep results belong to the scope they ran on — clear them when the
  // coin/pair/timeframe/date-range changes so a stale table can't mislead.
  const resetOptimize = optimize.reset
  useEffect(() => {
    resetOptimize()
  }, [scopeKey, resetOptimize])
  const applyCombo = (combo: NonNullable<typeof optimize.data>["results"][number]) => {
    setThreshold(combo.threshold)
    setHoldBars(combo.hold_bars)
    setSide(combo.side)
    setSlMode(combo.sl_mode)
    setSlValue(combo.sl_value)
    setTpMode(combo.tp_mode)
    setTpValue(combo.tp_value)
    setDisabledSignals(new Set(SWING_SIGNALS.map((s) => s.key).filter((k) => !combo.signals.includes(k))))
    setWeightPct({})
  }

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
      // Hold window end — used to shade the period during which new signals are ignored.
      end: m.exit_timestamp ? new Date(m.exit_timestamp).getTime() : null,
      good: m.ret >= 0,
      short: m.side === "short",
    })),
    [data],
  )
  // Every marker is 2 SVG reference elements per chart (entry line + hold
  // band); past a few hundred trades that's thousands of nodes and the
  // browser's render thread locks up. Skip individual markers on busy ranges.
  const MARKER_DRAW_LIMIT = 300
  const drawMarkers = showTradeMarkers && tradeMarkers.length <= MARKER_DRAW_LIMIT
  const signalCurve = useMemo(
    () => (data?.signal_curve ?? []).map((p) => ({ ...p, t: new Date(p.timestamp).getTime() })),
    [data],
  )
  const toggleOverlay = (key: string) =>
    setOverlay((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  const signalLabel = (key: string) => SWING_SIGNALS.find((s) => s.key === key)?.label ?? key

  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
  const tCol = (t: number) => (t >= 3 ? "text-green-500" : t >= 2 ? "text-amber-400" : t <= -2 ? "text-red-400" : "text-muted-foreground")
  // The overfitting check: does the edge survive in BOTH halves?
  const halves = (data?.segments ?? []).filter((s) => s.label !== "Full range")
  const consistent = halves.length === 2 && halves.every((s) => s.avg_net_bps > 0)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-md border p-4">
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Signal threshold (σ)</label>
            <InfoIcon text="Enter a trade when the swing composite — the average z-score of the reversal signals (volume/range spike, wick pressure, taker tilt, participation swell, streak, stretch) plus bonuses for sweep/volume-divergence/deceleration flags — reaches this many standard deviations. Higher = fewer, stronger setups." />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={0.25} max={2.5} step={0.25} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="flex-1" />
            <span className="text-sm font-mono w-10 text-right">{threshold.toFixed(2)}</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Hold max (bars)</label>
            <InfoIcon text="Maximum holding period — the time-stop backstop. A trade exits here at the latest; a stop loss, take profit, or reversal exit can end it earlier. With SL/TP set to None this is the classic fixed hold (the measured forward-return edge peaked around 6 bars in the research)." />
          </div>
          <Input type="number" value={holdBars} min={1} max={96} onChange={(e) => setHoldBars(Math.max(1, Math.min(96, Math.round(Number(e.target.value)) || 1)))} className="h-9 mt-1" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Stop loss</label>
            <InfoIcon text={
              <div className="space-y-1.5">
                <p>Exit early when the trade moves against you. Intra-bar touches fill at the level; when a stop and target could both fill in one bar, the stop wins (conservative).</p>
                <p><span className="font-semibold">Fixed %</span> — a static stop that far below entry (above for shorts).</p>
                <p><span className="font-semibold">ATR ×</span> — k times the trailing 14-bar ATR (Wilder&apos;s Average True Range; on gapless 24/7 crypto bars this equals the average high−low candle height). Volatility-adaptive: the stop sits outside the current noise band, wherever that band is.</p>
                <p><span className="font-semibold">Swing structure</span> — below the prior 12-bar low being bought (above the prior high for shorts): &quot;the reversal thesis is invalidated&quot;.</p>
                <p><span className="font-semibold">Trailing ATR ×</span> — follows the best close since entry at k ATRs, ratcheting up (never down) to lock in profit as the move runs.</p>
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
                <p>Exit early when the trade pays. All variants are capped by Hold max.</p>
                <p><span className="font-semibold">None</span> — hold to the bar cap.</p>
                <p><span className="font-semibold">Fixed %</span> — a static target that far above entry (below for shorts).</p>
                <p><span className="font-semibold">Resistance</span> — the prior 12-bar high: sell into the last known ceiling (mirrored floor for shorts); skipped if entry is already beyond it.</p>
                <p><span className="font-semibold">Mean touch</span> — exit when price reverts to its 20-bar average; the natural target for these entries, which are stretched away from the mean.</p>
                <p><span className="font-semibold">Opposite signal</span> — hold until the composite detects the NEXT reversal (a top signal for longs, respecting the breakout veto; a bottom signal for shorts).</p>
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
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Fees</label>
            <InfoIcon text="Round-trip trading cost. Swing entries fade into a turn, so resting limit orders (maker) are realistic — futures maker is the preset where the measured edges (3–7 bps/bar) survive. Spot taker is the pessimistic bound." />
          </div>
          <select value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
            {SWING_FEE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Side</label>
            <InfoIcon text="Long = buy signal-detected bottoms only (capitulation was the stronger signature in every dataset). Short = fade detected tops (subject to the breakout veto: a top signal on >2σ stretch AND >2x volume is momentum, not a crest — it is skipped, never faded). Funding/borrow costs of real shorts are not modeled." />
          </div>
          <select value={side} onChange={(e) => setSide(e.target.value)} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
            <option value="long">Long (buy bottoms)</option>
            <option value="short">Short (fade tops)</option>
            <option value="both">Both</option>
          </select>
        </div>
        {/* Composite membership: toggle individual signals on/off */}
        <div className="col-span-2 md:col-span-4 border-t pt-3 mt-1">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs font-medium text-muted-foreground">Signal components</span>
            <InfoIcon text="The composite = the equal-weight AVERAGE of the enabled z-scored components, plus +0.25 per enabled confirming flag that fires. Untick a signal to remove it from the composite entirely. The % box scales that signal's contribution relative to the equal-weight baseline: 100% = unchanged, 200% = double, 50% = half, 0% = muted but still diluting the average (unlike unticking). Flags scale their +0.25 bonus the same way. Warning: 11 weights is a big overfitting surface — tune on one half, confirm on the other." />
            {(disabledSignals.size > 0 || Object.values(weightPct).some((p) => p !== 100)) && (
              <button onClick={() => { setDisabledSignals(new Set()); setWeightPct({}) }} className="text-[10px] text-muted-foreground underline hover:text-foreground cursor-pointer">
                reset all
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {SWING_SIGNALS.map((s) => {
              const disabled = disabledSignals.has(s.key)
              const pct = weightPct[s.key] ?? 100
              return (
                <span key={s.key} className="flex items-center gap-1 text-xs">
                  {/* InfoIcon sits OUTSIDE the label so hovering/clicking it never toggles the checkbox */}
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <Checkbox
                      checked={!disabled}
                      onCheckedChange={() => toggleSignal(s.key)}
                      className="h-3.5 w-3.5"
                    />
                    <span className={cn(disabled && "text-muted-foreground line-through")}>
                      {s.label}{s.flag ? <span className="text-muted-foreground"> (flag)</span> : null}
                    </span>
                  </label>
                  <span className={cn("flex items-center", disabled && "opacity-40 pointer-events-none")}>
                    <Input
                      type="number"
                      min={0}
                      max={500}
                      step={25}
                      value={pct}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(500, Math.round(Number(e.target.value))))
                        setWeightPct((prev) => ({ ...prev, [s.key]: Number.isFinite(v) ? v : 100 }))
                      }}
                      className={cn("h-5 w-14 px-1 text-[11px] text-right", pct !== 100 && "border-primary/60 text-primary")}
                      title="Contribution vs the equal-weight baseline (100 = unchanged)"
                    />
                    <span className="text-[10px] text-muted-foreground ml-0.5">%</span>
                  </span>
                  <InfoIcon text={s.info} />
                </span>
              )
            })}
          </div>
        </div>

        <label className={cn(
          "col-span-2 md:col-span-4 flex items-start gap-2.5 border-t pt-3 mt-1",
          confirmSimId ? "cursor-pointer" : "opacity-60",
        )}>
          <Checkbox checked={useModel && !!confirmSimId} disabled={!confirmSimId} onCheckedChange={(v) => setUseModel(!!v)} className="mt-0.5 shrink-0" />
          <span className="text-xs">
            <span className="font-medium">Require model confirmation</span>
            <InfoIcon text="Only take a swing trade when the selected simulation's stored forecast agrees: the next bar's P(up) must be ≥ 0.5 for longs (≤ 0.5 for shorts). Tests whether the AI forecast adds anything on top of the raw signals. Pick a simulation matching this scope in the selector above to enable." />
            <span className="block text-muted-foreground mt-0.5">
              {!confirmSimId
                ? "Select a matching simulation above to enable this filter."
                : useModel && data && !data.model_available
                  ? "The selected simulation has no stored P(up) forecasts — filter has no effect."
                  : `Entry also needs the next-bar P(up) from “${confirmSimName ?? "the selected simulation"}” to agree with the trade direction.`}
            </span>
          </span>
        </label>

        {/* Auto-optimizer */}
        <div className="col-span-2 md:col-span-4 border-t pt-3 mt-1 flex items-start gap-3">
          <Button size="sm" className="h-7 shrink-0 cursor-pointer" disabled={optimize.isPending} onClick={() => optimize.mutate()}>
            {optimize.isPending ? "Sweeping…" : "Auto-optimize"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Sweeps ~650 curated combinations of threshold, hold, side, SL/TP and three signal subsets (equal weights, fees and model-confirmation as currently set). Tunes on the <span className="font-medium">first half</span> of the range and reports each winner&apos;s untouched <span className="font-medium">second half</span> — judge by the validation column, not train.
            <InfoIcon text="Rankings use the train-half edge t-statistic (significance-aware, so many solid trades beat a few lucky ones); combos with under 10 train or 3 validation trades are dropped. Even so, the validation column is itself picked-over across ~650 tries — a real setting should also survive on other coins and periods. Per-signal % weights are deliberately not swept: a continuous 11-dimensional space is pure overfitting surface." />
          </span>
        </div>
      </div>

      {/* Optimizer results */}
      {optimize.isError && (
        <p className="text-sm text-red-400">Optimization failed: {(optimize.error as Error).message || "request error"}</p>
      )}
      {optimize.data && (
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Evaluated {optimize.data.evaluated}/{optimize.data.total_combos} combinations{optimize.data.partial ? " (time budget hit — partial sweep)" : ""} at {optimize.data.fee_bps} bps fees{optimize.data.use_model && optimize.data.model_available ? ", with model confirmation" : ""}. Train ≤ {format(new Date(optimize.data.split_at), "MMM d, yyyy")} &lt; validation.
            {optimize.data.results.length === 0 && " No combination produced enough trades in both halves."}
            {optimize.data.results.length > 0 && optimize.data.results.every((r) => r.val.avg_net_bps <= 0) && (
              <span className="text-amber-400"> None of the top train-half settings held up in validation — on this run the honest conclusion is that no swept setting generalizes.</span>
            )}
          </p>
          {optimize.data.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="pr-3 py-1 font-medium">Setting</th>
                    <th className="pr-3 py-1 font-medium" title="Performance on the tuning half — flattered by selection.">Train (tuned)</th>
                    <th className="pr-3 py-1 font-medium" title="Performance on the untouched second half — the honest column.">Validation</th>
                    <th className="pr-3 py-1 font-medium">Full return</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {optimize.data.results.map((r, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="pr-3 py-1.5 font-mono">
                        thr {r.threshold.toFixed(2)} · hold {r.hold_bars} · {r.side}
                        {r.sl_mode !== "none" ? ` · SL ${r.sl_mode}` : ""}{r.tp_mode !== "none" ? ` · TP ${r.tp_mode}` : ""}
                        {" · "}{r.signals.length === SWING_SIGNALS.length ? "all signals" : `${r.signals.length} signals`}
                      </td>
                      <td className="pr-3 py-1.5 font-mono whitespace-nowrap">
                        <span className={r.train.avg_net_bps >= 0 ? "text-green-500" : "text-red-400"}>{r.train.avg_net_bps >= 0 ? "+" : ""}{r.train.avg_net_bps.toFixed(1)} bps</span>
                        <span className="text-muted-foreground"> t={r.train.edge_t.toFixed(1)} n={r.train.n_trades}</span>
                      </td>
                      <td className="pr-3 py-1.5 font-mono whitespace-nowrap">
                        <span className={r.val.avg_net_bps >= 0 ? "text-green-500" : "text-red-400"}>{r.val.avg_net_bps >= 0 ? "+" : ""}{r.val.avg_net_bps.toFixed(1)} bps</span>
                        <span className="text-muted-foreground"> t={r.val.edge_t.toFixed(1)} n={r.val.n_trades}</span>
                      </td>
                      <td className="pr-3 py-1.5 font-mono">
                        <span className={r.full.total_return_pct >= 0 ? "text-green-500" : "text-red-400"}>{r.full.total_return_pct >= 0 ? "+" : ""}{r.full.total_return_pct.toFixed(1)}%</span>
                      </td>
                      <td className="py-1.5 text-right">
                        <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] cursor-pointer" onClick={() => applyCombo(r)} title="Apply this combination to the knobs above (weights reset to 100%)">
                          Apply
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error ? (
        <p className="text-sm text-muted-foreground py-8">Swing analysis failed: {(error as Error).message || "request error"}</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground py-8">{isFetching ? "Analyzing swings… (large ranges can take a little while on the first run)" : "—"}</p>
      ) : (
        <div className={cn("space-y-4", isFetching && "opacity-60 transition-opacity")} title={isFetching ? "Recomputing…" : undefined}>
          {isFetching && <p className="text-xs text-muted-foreground animate-pulse">Recomputing…</p>}
          {/* Per-segment stats — the first/second-half split is the overfitting check */}
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
                    <span className="text-xs font-mono text-muted-foreground" title="Significance needs at least 2 trades — a single trade is an anecdote, not evidence.">t=—</span>
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
              ? <span className="text-green-500">Edge is positive in both halves — consistent with a real signal (still confirm on another coin/period).</span>
              : <span className="text-amber-400">Edge does not hold in both halves — treat the full-range number as curve-fit until it does.</span>)}
            <span className="text-muted-foreground"> {data.long_entries} long / {data.short_entries} short entries{data.vetoed_tops > 0 ? ` · ${data.vetoed_tops} top signals vetoed as high-volume breakouts` : ""}.</span>
            {(data.sl_mode !== "none" || data.tp_mode !== "none") && (
              <span className="text-muted-foreground" title="How each trade actually ended: stopped out, hit its profit target, exited on the opposite signal, or ran to the Hold-max bar cap.">
                {" "}Exits: {data.exit_counts.stop ?? 0} stop · {data.exit_counts.take_profit ?? 0} take-profit · {data.exit_counts.reversal ?? 0} reversal · {data.exit_counts.hold_max ?? 0} hold-max.
              </span>
            )}
          </p>

          {/* Equity curve */}
          <div className={cn(
            "relative rounded-md border bg-card p-2",
            maximizedChart === "equity" && "fixed inset-4 z-50 bg-background shadow-2xl flex flex-col",
          )}>
            <button
              type="button"
              onClick={() => setShowTradeMarkers((v) => !v)}
              aria-label={showTradeMarkers ? "Hide trade markers" : "Show trade markers"}
              title={showTradeMarkers ? "Hide trade markers (green = winning trade, red = losing)" : "Show trade markers (green = winning trade, red = losing)"}
              className={cn(
                "absolute top-2 right-9 z-10 rounded p-1.5 transition-colors",
                showTradeMarkers ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Flag className="h-4 w-4" />
            </button>
            <div
              className="absolute top-2 right-2 z-10 rounded p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
              onClick={() => setMaximizedChart((v) => (v === "equity" ? null : "equity"))}
              aria-label={maximizedChart === "equity" ? "Normalize" : "Maximize"}
              title={maximizedChart === "equity" ? "Normalize" : "Maximize"}
            >
              {maximizedChart === "equity" ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
            </div>
            <div className={maximizedChart === "equity" ? "flex-1 min-h-0" : undefined}>
            <ResponsiveContainer width="100%" height={maximizedChart === "equity" ? "100%" : 320}>
              <LineChart data={curve} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
                  tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                {/* Shaded band = the hold window (entry → fixed exit) during
                    which new signals are ignored; the line marks the entry. */}
                {drawMarkers && tradeMarkers.map((m, idx) => (
                  m.end != null && (
                    <ReferenceArea key={`sma-${idx}`} x1={m.t} x2={m.end} fill={m.good ? "#22c55e" : "#ef4444"} fillOpacity={0.07} stroke="none" />
                  )
                ))}
                {drawMarkers && tradeMarkers.map((m, idx) => (
                  <ReferenceLine key={`sm-${idx}`} x={m.t} stroke={m.good ? "#22c55e" : "#ef4444"} strokeOpacity={0.25} strokeWidth={2} strokeDasharray={m.short ? "4 3" : undefined} />
                ))}
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  formatter={((v: any, name: any) => [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`, name === "strategy" ? "Swing strategy" : "Buy & hold"]) as any}
                  contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                />
                <Line type="monotone" dataKey="buy_hold" stroke="#888" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="strategy" stroke="#26a69a" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            </div>
            <p className="px-2 pb-1 text-[10px] text-muted-foreground">
              {showTradeMarkers && !drawMarkers ? (
                <span className="text-amber-400">Too many trades ({tradeMarkers.length}) to draw individual entry lines and hold bands without freezing the browser — narrow the date range (or raise the threshold) to see them. </span>
              ) : (
                <>Shaded bands = each trade&apos;s in-market window (entry line → exit). Colour is the <span className="font-medium">outcome</span> — green won, red lost — not the direction; solid entry lines are longs, dashed are shorts. While a band is open, new signals are ignored. </>
              )}
            </p>
          </div>

          {/* Composite signal over time, with optional per-component overlays.
              Decimation keeps each bucket's strongest bar, so the spikes that
              actually trigger entries are always visible. */}
          <div className={cn(
            "rounded-md border bg-card p-2",
            maximizedChart === "signal" && "fixed inset-4 z-50 bg-background shadow-2xl flex flex-col",
          )}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-1 pb-2">
              <span className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Composite signal</p>
                <InfoIcon text="The total signal per bar: the equal-weight average of the enabled z-scored components plus +0.25 per firing flag. A trade is entered when the traded side's composite reaches the dashed threshold line. Hover the chart to read exact values; tick components below to overlay their individual contributions (direction-aware for the traded side — positive pushes toward entry)." />
              </span>
              <label className="flex items-center gap-1 text-xs cursor-pointer select-none" title="The total long (bottom) composite — the equal-weight average of the enabled components + flag bonuses, per bar.">
                <Checkbox checked={showLongLine} onCheckedChange={() => setShowLongLine((v) => !v)} className="h-3 w-3" />
                <span className="inline-block w-3 h-0.5 align-middle" style={{ background: "#26a69a" }} />
                <span className={showLongLine ? "" : "text-muted-foreground line-through"}>Long (bottom) signal</span>
              </label>
              <label className="flex items-center gap-1 text-xs cursor-pointer select-none" title="The total short (top) composite — same construction, mirrored for fading tops.">
                <Checkbox checked={showShortLine} onCheckedChange={() => setShowShortLine((v) => !v)} className="h-3 w-3" />
                <span className="inline-block w-3 h-0.5 align-middle" style={{ background: "#ef4444" }} />
                <span className={showShortLine ? "" : "text-muted-foreground line-through"}>Short (top) signal</span>
              </label>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 ml-auto">
                {SWING_SIGNALS.filter((s) => !s.flag).map((s) => (
                  <label key={s.key} className="flex items-center gap-1 text-[11px] cursor-pointer select-none">
                    <Checkbox checked={overlay.has(s.key)} onCheckedChange={() => toggleOverlay(s.key)} className="h-3 w-3" />
                    <span style={{ color: overlay.has(s.key) ? SWING_COMPONENT_COLORS[s.key] : undefined }} className={overlay.has(s.key) ? "" : "text-muted-foreground"}>
                      {s.label}
                    </span>
                  </label>
                ))}
              </span>
              <div
                className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
                onClick={() => setMaximizedChart((v) => (v === "signal" ? null : "signal"))}
                aria-label={maximizedChart === "signal" ? "Normalize" : "Maximize"}
                title={maximizedChart === "signal" ? "Normalize" : "Maximize"}
              >
                {maximizedChart === "signal" ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
              </div>
            </div>
            <div className={maximizedChart === "signal" ? "flex-1 min-h-0" : undefined}>
            <ResponsiveContainer width="100%" height={maximizedChart === "signal" ? "100%" : 260}>
              <LineChart data={signalCurve} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
                  tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tickFormatter={(v) => `${v.toFixed(1)}σ`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                {/* Hold-window shading: signals inside a band are ignored —
                    trades are non-overlapping (one bet at a time). */}
                {drawMarkers && tradeMarkers.map((m, idx) => (
                  m.end != null && (
                    <ReferenceArea key={`sga-${idx}`} x1={m.t} x2={m.end} fill={m.good ? "#22c55e" : "#ef4444"} fillOpacity={0.07} stroke="none" />
                  )
                ))}
                {drawMarkers && tradeMarkers.map((m, idx) => (
                  <ReferenceLine key={`sg-${idx}`} x={m.t} stroke={m.good ? "#22c55e" : "#ef4444"} strokeOpacity={0.18} strokeWidth={2} strokeDasharray={m.short ? "4 3" : undefined} />
                ))}
                <ReferenceLine y={0} stroke="var(--border)" />
                <ReferenceLine y={threshold} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.8}
                  label={{ value: `threshold ${threshold.toFixed(2)}σ`, position: "insideTopRight", fontSize: 10, fill: "#eab308" }} />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  formatter={((v: any, name: any) => [
                    `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}σ`,
                    name === "long_score" ? "Long signal (total)" : name === "short_score" ? "Short signal (total)" : signalLabel(String(name)),
                  ]) as any}
                  contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                />
                {[...overlay].map((key) => (
                  <Line key={key} type="monotone" dataKey={key} stroke={SWING_COMPONENT_COLORS[key]}
                    strokeWidth={1} strokeOpacity={0.7} dot={false} isAnimationActive={false} connectNulls />
                ))}
                {showShortLine && <Line type="monotone" dataKey="short_score" stroke="#ef4444" strokeWidth={1.2} strokeOpacity={0.85} dot={false} isAnimationActive={false} connectNulls />}
                {showLongLine && <Line type="monotone" dataKey="long_score" stroke="#26a69a" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />}
              </LineChart>
            </ResponsiveContainer>
            </div>
            {data.components_side === "short" && overlay.size > 0 && (
              <p className="px-2 pb-1 text-[10px] text-muted-foreground">Component overlays show top-side (short) contributions, matching the traded side.</p>
            )}
          </div>

          {/* Signal composition at entry */}
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-xs font-medium text-muted-foreground">Signal contribution at entry (mean z)</p>
              <InfoIcon text="Each signal's average direction-aware contribution at the bars actually entered on: positive = it pushed the composite toward taking the trade, near 0 = it wasn't a factor. Flags show the fraction of entries where they fired (0–1). Greyed = currently excluded from the composite, but still measured so you can see what it would have said." />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {data.signals.map((sg) => {
                const info = SWING_SIGNALS.find((s) => s.key === sg.key)?.info
                const tip = [info, sg.enabled ? undefined : "Currently EXCLUDED from the composite (toggle above)."]
                  .filter(Boolean).join(" — ")
                return (
                  <span key={sg.key} className={cn("text-xs cursor-help", !sg.enabled && "opacity-45")} title={tip || undefined}>
                    <span className="text-muted-foreground">{sg.name}</span>{" "}
                    <span className="font-mono font-medium">{sg.mean_z_at_entry == null ? "—" : `${sg.mean_z_at_entry >= 0 ? "+" : ""}${sg.mean_z_at_entry.toFixed(1)}`}</span>
                    {sg.weight !== 1 && <span className="font-mono text-primary text-[10px]" title="Contribution multiplier applied to this signal"> ×{sg.weight.toFixed(2).replace(/\.?0+$/, "")}</span>}
                  </span>
                )
              })}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Signal-only strategy computed from raw OHLCV — no model forecast involved{useModel && data.model_available ? " (except the P(up) confirmation filter)" : ""}. All signals use trailing windows only (no lookahead). Entries are non-overlapping, held up to {data.hold_bars} bars{data.sl_mode !== "none" ? ", stopped out earlier when the stop level is touched" : ""}{data.tp_mode !== "none" ? ", taking profit earlier per the selected target" : ""}; intra-bar level exits fill at the level (stop wins if both could fill in one bar); {data.fee_bps} bps charged per round trip. Knobs tuned here are in-sample — with SL/TP in play the parameter space is large, so trust a setting only if it also holds in the second half and on other coins/periods.
          </p>
        </div>
      )}
    </div>
  )
}
