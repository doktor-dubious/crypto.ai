"use client"

// Per-trade analysis popup (Paper Trade → detail pane → Trades → row click).
// Shows the klines leading up to / following the buy and the sell (with a gap
// divider when the two windows are far apart), highlights the bars the entry /
// exit decision was built from (streak run, channel window, hold span, …) and
// explains under the chart why the buy and the sell happened there.

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Bar, BarChart, Cell, ComposedChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { TradeAnalysis, TradeAnalysisKline } from "@/lib/api"

const UP_COLOR = "#26a69a"
const DOWN_COLOR = "#ef5350"
const ENTRY_MARK = "#f59e0b"   // amber — bars the entry signal was built from
const EXIT_MARK = "#8b5cf6"    // violet — bars the exit decision was built from
const AXIS_WIDTH = 64
const PRICE_HEIGHT = 320
const VOLUME_HEIGHT = 80
const CHART_MARGIN_TOP = 8

type ChartPoint = {
  k: string
  time: number | null
  open: number
  high: number
  low: number
  close: number
  volume: number
  hl: [number, number]
  up: boolean
  gap?: boolean
  entryMark?: boolean
  exitMark?: boolean
  isEntry?: boolean
  isExit?: boolean
  side: "long" | "short"
}

/** Candlestick glyph + trade-analysis decorations. Beyond the plain candle it
 *  draws: a full-height tint behind signal bars, the gap divider, and the ▲/▼
 *  entry-exit markers attached to their bars. */
function Candle(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: ChartPoint
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props
  if (!payload) return null
  const centerX = x + width / 2
  const plotTop = CHART_MARGIN_TOP
  const plotBottom = CHART_MARGIN_TOP + PRICE_HEIGHT - 16

  if (payload.gap) {
    return (
      <g>
        <line
          x1={centerX} x2={centerX} y1={plotTop} y2={plotBottom}
          stroke="var(--border)" strokeDasharray="2 6" strokeWidth={1.5}
        />
      </g>
    )
  }

  const { high, low, open, close, up } = payload
  const color = up ? UP_COLOR : DOWN_COLOR
  const range = high - low
  const valueToY = (v: number) => (range === 0 ? y : y + ((high - v) / range) * height)
  const openY = valueToY(open)
  const closeY = valueToY(close)
  const bodyY = Math.min(openY, closeY)
  const bodyHeight = Math.max(Math.abs(closeY - openY), 1)
  const bodyWidth = Math.max(width * 0.7, 1)

  // Buy renders as an emerald ▲ under the bar, sell as a red ▼ above it —
  // whichever of entry/exit is the buy depends on the trade's side.
  const buyGlyph = (yPos: number) => (
    <path d={`M ${centerX - 5} ${yPos + 10} L ${centerX + 5} ${yPos + 10} L ${centerX} ${yPos + 2} Z`} fill="#10b981" />
  )
  const sellGlyph = (yPos: number) => (
    <path d={`M ${centerX - 5} ${yPos - 10} L ${centerX + 5} ${yPos - 10} L ${centerX} ${yPos - 2} Z`} fill="#ef4444" />
  )
  const entryIsBuy = payload.side === "long"

  return (
    <g>
      {(payload.entryMark || payload.exitMark) && (
        <rect
          x={x - 1} y={plotTop} width={width + 2} height={plotBottom - plotTop}
          fill={payload.entryMark ? ENTRY_MARK : EXIT_MARK} fillOpacity={0.1}
        />
      )}
      <line x1={centerX} x2={centerX} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={centerX - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyHeight} fill={color} />
      {payload.isEntry && (entryIsBuy ? buyGlyph(y + height) : sellGlyph(y))}
      {payload.isExit && (entryIsBuy ? sellGlyph(y) : buyGlyph(y + height))}
    </g>
  )
}

function formatTick(time: number, interval: string) {
  const d = new Date(time)
  if (/m|h/.test(interval)) {
    return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" })
}

function CandleTooltip({
  active, payload, interval,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartPoint }>
  interval: string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  if (p.gap || p.time == null) return null
  const color = p.up ? UP_COLOR : DOWN_COLOR
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 8 })
  return (
    <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">
        {new Date(p.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: /m|h/.test(interval) ? "short" : undefined })}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
        <span className="text-muted-foreground">O</span><span className="text-right">{fmt(p.open)}</span>
        <span className="text-muted-foreground">H</span><span className="text-right">{fmt(p.high)}</span>
        <span className="text-muted-foreground">L</span><span className="text-right">{fmt(p.low)}</span>
        <span className="text-muted-foreground">C</span><span className="text-right" style={{ color }}>{fmt(p.close)}</span>
        <span className="text-muted-foreground">Vol</span><span className="text-right">{p.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </div>
    </div>
  )
}

/**
 * The popup is driven entirely by its analysis payload, so the CALLER supplies
 * the fetch. A paper trade is looked up by (template, run, seq); a BACKTEST
 * trade has no stored row and is posted instead. Same chart either way — that
 * is the point: the two must not be able to disagree about what a signal is.
 */
export function TradeAnalysisDialog({
  open,
  queryKey,
  queryFn,
  onClose,
}: {
  open: boolean
  queryKey: unknown[]
  queryFn: () => Promise<TradeAnalysis>
  onClose: () => void
}) {
  const t = useTranslations("paperTrade")

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn,
    enabled: open,
    staleTime: 60_000,
  })

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!data) return []
    const side = data.trade.side
    const entryMs = Date.parse(data.trade.entry_time)
    const exitMs = data.trade.exit_time ? Date.parse(data.trade.exit_time) : null
    const entryMarks = new Set((data.entry_signal?.mark_times ?? []).map((s) => Date.parse(s)))
    const exitMarks = new Set((data.exit_signal?.mark_times ?? []).map((s) => Date.parse(s)))
    const toPoint = (kl: TradeAnalysisKline, i: number, prefix: string): ChartPoint => {
      const time = Date.parse(kl.open_time)
      return {
        k: `${prefix}${i}`,
        time,
        open: kl.open, high: kl.high, low: kl.low, close: kl.close, volume: kl.volume,
        hl: [kl.low, kl.high],
        up: kl.close >= kl.open,
        // Exit tint wins where the hold span overlaps the entry-signal bars —
        // except on the entry bar itself, which stays an entry-signal bar.
        entryMark: entryMarks.has(time) && (!exitMarks.has(time) || time === entryMs),
        exitMark: exitMarks.has(time) && !(entryMarks.has(time) && time === entryMs),
        isEntry: time === entryMs,
        isExit: exitMs != null && time === exitMs,
        side,
      }
    }
    const points = data.entry_klines.map((kl, i) => toPoint(kl, i, "e"))
    if (data.exit_klines.length > 0) {
      const lows = points.map((p) => p.low)
      const highs = points.map((p) => p.high)
      const mid = (Math.min(...lows) + Math.max(...highs)) / 2
      points.push({
        k: "gap", time: null, open: mid, high: mid, low: mid, close: mid,
        volume: 0, hl: [mid, mid], up: true, gap: true, side,
      })
      points.push(...data.exit_klines.map((kl, i) => toPoint(kl, i, "x")))
    }
    return points
  }, [data])

  const priceDomain = useMemo<[number, number]>(() => {
    const bars = chartData.filter((p) => !p.gap)
    if (bars.length === 0) return [0, 1]
    let min = Infinity
    let max = -Infinity
    for (const p of bars) {
      if (p.low < min) min = p.low
      if (p.high > max) max = p.high
    }
    const pad = (max - min) * 0.06 || max * 0.05 || 1
    return [min - pad, max + pad]
  }, [chartData])

  const timeByKey = useMemo(() => {
    const m: Record<string, number | null> = {}
    for (const p of chartData) m[p.k] = p.time
    return m
  }, [chartData])

  const priceFmt = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 6 : 2 })

  // ── Explanation texts (composed from the signal's structured data) ─────────
  const sideWord = (s: string) => (s === "long" ? t("analysisSideLong") : t("analysisSideShort"))
  const entryText = useMemo(() => {
    const sig = data?.entry_signal
    if (!sig || !data) return null
    const d = sig.data as Record<string, string | number | boolean>
    const common = { threshold: `${d.threshold}`, side: sideWord(data.trade.side), window: `${d.window}` }
    switch (sig.kind) {
      case "streak": {
        const dir = data.trade.side === "long" ? t("analysisDirDown") : t("analysisDirUp")
        let text = t("explainEntryStreak", { n: `${d.n}`, dir, threshold: `${d.threshold}`, side: common.side })
        if (d.voldiv) text += ` ${t("explainEntryStreakVoldiv")}`
        return text
      }
      case "range": return t("explainEntryRange", common)
      case "momentum": return t("explainEntryMomentum", common)
      case "sweep": return t("explainEntrySweep", common)
      case "takerflow": return t("explainEntryTakerflow", common)
      case "indicator": return t("explainEntryIndicator", { ...common, indicator: `${d.indicator}` })
      default: return t("explainEntrySwings", common)
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const exitText = useMemo(() => {
    if (!data) return null
    if (data.trade.status === "open" || data.trade.exit_time == null) return t("explainExitOpen")
    const sig = data.exit_signal
    if (!sig) return null
    const d = sig.data as Record<string, string | number>
    switch (sig.kind) {
      case "hold_max": return t("explainExitHoldMax", { holdBars: `${d.hold_bars}` })
      case "stop": return t("explainExitStop", { mode: `${d.mode}`, value: `${d.value}` })
      case "take_profit": return t("explainExitTakeProfit", { mode: `${d.mode}`, value: `${d.value}` })
      default: return t("explainExitReversal", { threshold: `${d.threshold}` })
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const tr = data?.trade
  const dtFmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—")

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[1000px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {t("analysisTitle")}
            {data && (
              <span className="font-normal text-sm text-[var(--muted-foreground)]">
                {data.symbol}/{data.quote_asset} · {data.interval}
              </span>
            )}
            {tr && (
              <Badge
                variant="outline"
                className={cn("text-xs", tr.side === "long" ? "border-emerald-500/40 text-emerald-500" : "border-red-500/40 text-red-500")}
              >
                {tr.side}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <p className="py-16 text-center text-sm text-[var(--muted-foreground)]">{t("analysisLoading")}</p>
        )}
        {isError && (
          <p className="py-16 text-center text-sm text-red-500">{t("analysisError")}</p>
        )}
        {data && chartData.filter((p) => !p.gap).length === 0 && (
          <p className="py-16 text-center text-sm text-[var(--muted-foreground)]">{t("analysisNoKlines")}</p>
        )}

        {data && chartData.filter((p) => !p.gap).length > 0 && tr && (
          <div className="space-y-3">
            {/* Trade summary line */}
            <div className="flex items-center gap-4 flex-wrap text-xs text-[var(--muted-foreground)]">
              <span>
                {t("analysisEntry")}{" "}
                <span className="font-mono text-foreground">{priceFmt(tr.entry_price)}</span>{" "}
                · {dtFmt(tr.entry_time)}
              </span>
              {tr.exit_time != null && (
                <span>
                  {t("analysisExit")}{" "}
                  <span className="font-mono text-foreground">{tr.exit_price == null ? "—" : priceFmt(tr.exit_price)}</span>{" "}
                  · {dtFmt(tr.exit_time)}
                </span>
              )}
              {tr.realized_pnl != null && (
                <span>
                  P/L{" "}
                  <span className={cn("font-mono", tr.realized_pnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {tr.realized_pnl >= 0 ? "+" : ""}{tr.realized_pnl.toFixed(2)}
                  </span>
                  {tr.ret != null && (
                    <span className="font-mono"> ({(tr.ret * 100).toFixed(2)}%)</span>
                  )}
                </span>
              )}
              {data.gap_bars > 0 && <span>{t("analysisGap", { n: data.gap_bars })}</span>}
            </div>

            {/* Price candlesticks + volume */}
            <div className="rounded-md border bg-card">
              <ResponsiveContainer width="100%" height={PRICE_HEIGHT}>
                <ComposedChart data={chartData} margin={{ top: CHART_MARGIN_TOP, right: 12, bottom: 0, left: 0 }}>
                  <XAxis dataKey="k" hide />
                  <YAxis
                    orientation="right" width={AXIS_WIDTH} domain={priceDomain}
                    tickFormatter={priceFmt} tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  />
                  <Tooltip
                    content={<CandleTooltip interval={data.interval} />}
                    isAnimationActive={false}
                    cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                  />
                  <ReferenceLine
                    y={tr.entry_price} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.7}
                    label={{ value: priceFmt(tr.entry_price), position: "left", fontSize: 10, fill: "#10b981" }}
                  />
                  {tr.exit_price != null && (
                    <ReferenceLine
                      y={tr.exit_price} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.7}
                      label={{ value: priceFmt(tr.exit_price), position: "left", fontSize: 10, fill: "#ef4444" }}
                    />
                  )}
                  <Bar dataKey="hl" shape={<Candle />} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={VOLUME_HEIGHT}>
                <BarChart data={chartData} margin={{ top: 0, right: 12, bottom: 4, left: 0 }}>
                  <XAxis
                    dataKey="k"
                    tickFormatter={(k: string) => {
                      const time = timeByKey[k]
                      return time == null ? "⋯" : formatTick(time, data.interval)
                    }}
                    tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={42}
                  />
                  <YAxis orientation="right" width={AXIS_WIDTH} hide domain={[0, "dataMax"]} />
                  <Tooltip
                    content={<CandleTooltip interval={data.interval} />}
                    isAnimationActive={false}
                    cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }}
                  />
                  <Bar dataKey="volume" isAnimationActive={false}>
                    {chartData.map((p) => (
                      <Cell
                        key={p.k}
                        fill={p.entryMark ? ENTRY_MARK : p.exitMark ? EXIT_MARK : p.up ? UP_COLOR : DOWN_COLOR}
                        fillOpacity={p.gap ? 0 : p.entryMark || p.exitMark ? 0.75 : 0.4}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Why the buy / the sell happened */}
            <div className="grid gap-3 sm:grid-cols-2">
              {entryText && (
                <div className="rounded-md border p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: ENTRY_MARK }} />
                    {tr.side === "long" ? t("analysisWhyBuy") : t("analysisWhySell")}
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{entryText}</p>
                </div>
              )}
              {exitText && (
                <div className="rounded-md border p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: EXIT_MARK }} />
                    {tr.side === "long" ? t("analysisWhySell") : t("analysisWhyBuy")}
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{exitText}</p>
                </div>
              )}
            </div>

            {/* AI verdict, when the trade went through the confirmation gate */}
            {tr.ai_verdict != null && (
              <div className="rounded-md border p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      tr.ai_verdict === "GO"
                        ? "border-emerald-500/40 text-emerald-500"
                        : tr.ai_verdict === "ERROR"
                          ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                          : "border-red-500/40 text-red-500",
                    )}
                  >
                    {tr.ai_verdict === "GO" ? t("aiGo") : tr.ai_verdict === "ERROR" ? t("aiError") : t("aiNoGo")}
                  </Badge>
                  {t("colAiVerdict")}
                </div>
                {tr.ai_explanation && (
                  <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{tr.ai_explanation}</p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
