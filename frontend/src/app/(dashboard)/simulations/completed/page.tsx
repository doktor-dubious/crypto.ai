"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import {
  Search, Star, Trash2, ArrowUpDown, ChevronDown, ChevronUp, Focus, Info, Flag, ZoomOut,
} from "lucide-react"
import {
  Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  klineSimulationsApi,
  type KlineSimulationResponse, type KlineSimulationPredictionResponse,
} from "@/lib/api"

const PRED_PER_PAGE = 10
const STAR_KEY = "crypt:simPredStars"

// ── Strategy labels (shared with the New Simulation form) ──
export const STRATEGY_LABELS: Record<string, string> = {
  price: "Price",
  kline: "Kline",
  price_volatility: "Price / Volatility",
}
export const VOL_MODE_LABELS: Record<string, string> = {
  vol_targeting: "Vol-targeting position sizing",
  vol_breakout: "Volatility breakout filter",
}
function volModeOf(sim: KlineSimulationResponse): string | undefined {
  const m = sim.config?.["vol_mode"]
  return typeof m === "string" ? m : undefined
}
function strategyLabel(sim: KlineSimulationResponse): string {
  const s = STRATEGY_LABELS[sim.strategy] ?? sim.strategy
  const m = volModeOf(sim)
  return m ? `${s} · ${VOL_MODE_LABELS[m] ?? m}` : s
}

function InfoIcon({ text }: { text: string }) {
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

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function loadStars(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try { return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]")) } catch { return new Set() }
}
function saveStars(s: Set<string>) {
  if (typeof window !== "undefined") localStorage.setItem(STAR_KEY, JSON.stringify([...s]))
}

type PredSortField = "timestamp" | "model_name" | "actual" | "predicted" | "actual_direction" | "model_direction" | "direction" | "error" | "pct_error" | "prob_up" | "in_interval"

// Which forecast value drives the Predicted / direction columns.
const FORECAST_OPTIONS = [
  { value: "prediction", label: "Prediction", col: "Predicted" },
  { value: "q10", label: "Quantile 10", col: "Q10" },
  { value: "q20", label: "Quantile 20", col: "Q20" },
  { value: "q30", label: "Quantile 30", col: "Q30" },
  { value: "q40", label: "Quantile 40", col: "Q40" },
  { value: "q50", label: "Quantile 50", col: "Q50" },
] as const
const Q_IDX: Record<string, number> = { q10: 0, q20: 1, q30: 2, q40: 3, q50: 4 }

type SortField = "name" | "coin" | "quote_asset" | "interval" | "strategy" | "start_date" | "finished_at" | "starred"

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function StatusCell({ sim }: { sim: KlineSimulationResponse }) {
  if (sim.status === "success") {
    return <span className="text-xs font-mono">{sim.finished_at ? format(new Date(sim.finished_at), "MMM d, yyyy HH:mm") : "—"}</span>
  }
  if (sim.status === "pending" || sim.status === "started") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        Running
      </span>
    )
  }
  const label = sim.status === "failure" ? "Failed" : "Stopped"
  const color = sim.status === "failure" ? "text-red-400 bg-red-500/15" : "text-amber-400 bg-amber-500/15"
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", color)}>{label}</span>
}

function SimAnalysis({ sim }: { sim: KlineSimulationResponse }) {
  // Live progress for a running simulation.
  const { data: status } = useQuery({
    queryKey: ["klineSimStatus", sim.id],
    queryFn: () => klineSimulationsApi.status(sim.id),
    enabled: sim.status === "pending" || sim.status === "started",
    refetchInterval: 2000,
  })

  if (sim.status === "pending" || sim.status === "started") {
    const progress = status?.progress ?? 0
    return (
      <div className="space-y-2 py-8">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-muted-foreground truncate">{status?.progress_message ?? "Processing…"}</span>
          <span className="text-xs text-muted-foreground ml-2 shrink-0">{progress}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div className="h-1.5 rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>
    )
  }

  if (sim.status === "failure") {
    return <p className="text-sm text-red-500 py-8">{sim.error ?? "Simulation failed"}</p>
  }

  const result = sim.result
  if (!result) {
    return <p className="text-sm text-muted-foreground py-8">No analysis available.</p>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Total Data</p>
          <p className="text-lg font-semibold">{result.data_points?.toLocaleString()}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Context / Forecasts</p>
          <p className="text-sm font-mono">{result.history_points?.toLocaleString()} / {result.test_points?.toLocaleString()}</p>
        </div>
      </div>

      {result.models && Object.entries(result.models).map(([modelName, resultData]) => {
        const r = resultData as any
        return (
          <div key={modelName} className="rounded-md border p-4 space-y-3">
            {r?.actual_engine && r.actual_engine !== modelName && (
              <p className="text-xs text-amber-500">ran as: {r.actual_engine}</p>
            )}
            {r?.error ? (
              <p className="text-sm text-red-500">{r.error}</p>
            ) : r?.metrics && r?.kline_strategy ? (
              <div className="grid grid-cols-3 gap-2">
                <div title="Share of bars where the model correctly predicted the next candle's direction (up vs down) from the 0/1 shape sequence. 50% = a coin flip."><p className="text-xs text-muted-foreground">Up/Down Accuracy</p><p className="text-lg font-semibold">{r.metrics.direction_accuracy_pct?.toFixed(1)}%</p></div>
                <div title="Number of one-step-ahead up/down forecasts evaluated."><p className="text-xs text-muted-foreground">Forecasts</p><p className="text-lg font-semibold">{r.metrics.test_count?.toLocaleString()}</p></div>
              </div>
            ) : r?.metrics ? (
              <div className="grid grid-cols-3 gap-2">
                <div title="Share of bars where the forecast got the up/down direction right (vs the previous close). 50% = a coin flip."><p className="text-xs text-muted-foreground">Direction Accuracy</p><p className="text-lg font-semibold">{r.metrics.direction_accuracy_pct?.toFixed(1)}%</p></div>
                <div title="Mean Absolute Error — the average absolute gap between actual and predicted close, in price units. Lower is better."><p className="text-xs text-muted-foreground">MAE</p><p className="text-lg font-semibold">${r.metrics.mae?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>
                <div title="Mean Absolute Percentage Error — the average of the per-bar % error (|actual − predicted| / actual). Lower is better."><p className="text-xs text-muted-foreground">MAPE</p><p className="text-lg font-semibold">{r.metrics.mape?.toFixed(2)}%</p></div>
                <div title="Root Mean Squared Error — like MAE but squares the errors, so large misses count much more. In price units; lower is better."><p className="text-xs text-muted-foreground">RMSE</p><p className="text-lg font-semibold">${r.metrics.rmse?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>
                <div title="Pearson correlation between predicted and actual close levels: 1 = perfect, 0 = none, negative = inverse."><p className="text-xs text-muted-foreground">Correlation</p><p className="text-lg font-semibold">{r.metrics.correlation?.toFixed(4)}</p></div>
                <div title="Number of one-step-ahead forecasts evaluated."><p className="text-xs text-muted-foreground">Forecasts</p><p className="text-lg font-semibold">{r.metrics.test_count?.toLocaleString()}</p></div>
              </div>
            ) : null}
            {r?.vol_metrics && (
              <div className="rounded-md border border-dashed p-3" title="Quality of the genuine one-step volatility forecast (the bar's realized range-vol, ln(high/low)). Correlation is predicted vs realized; higher = the model anticipates calm/violent bars well. Direction is ~random net of fees, but volatility is the forecastable signal.">
                <p className="text-xs text-muted-foreground mb-1">Volatility forecast (predicted vs realized range-vol)</p>
                <div className="flex gap-6">
                  <div><span className="text-xs text-muted-foreground">Correlation </span><span className="text-base font-semibold">{r.vol_metrics.corr?.toFixed(4)}</span></div>
                  <div><span className="text-xs text-muted-foreground">MAE </span><span className="text-base font-semibold">{r.vol_metrics.mae}</span></div>
                  <div><span className="text-xs text-muted-foreground">Bars </span><span className="text-base font-semibold">{r.vol_metrics.count?.toLocaleString()}</span></div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const QUANTILE_SERIES = [
  { key: "q10", label: "Q10", idx: 0, color: "#94a3b8" },
  { key: "q20", label: "Q20", idx: 1, color: "#7dd3fc" },
  { key: "q30", label: "Q30", idx: 2, color: "#38bdf8" },
  { key: "q40", label: "Q40", idx: 3, color: "#22d3ee" },
  { key: "q50", label: "Q50", idx: 4, color: "#facc15" },
  { key: "q60", label: "Q60", idx: 5, color: "#fb923c" },
  { key: "q70", label: "Q70", idx: 6, color: "#a855f7" },
  { key: "q80", label: "Q80", idx: 7, color: "#d946ef" },
  { key: "q90", label: "Q90", idx: 8, color: "#ec4899" },
] as const

const SERIES_LABEL: Record<string, string> = {
  actual: "Actual", predicted: "Predicted", band: "P10–P90 band",
  ...Object.fromEntries(QUANTILE_SERIES.map((q) => [q.key, q.label])),
}

function ModelFit({ sim }: { sim: KlineSimulationResponse }) {
  const isKline = sim.strategy === "kline"
  const models = sim.models ?? []
  const [model, setModel] = useState(models[0] ?? "")
  const [series, setSeries] = useState<Set<string>>(() => new Set(["actual", "predicted", "band"]))
  const toggle = (key: string) =>
    setSeries((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  // Drag-to-zoom state. refLeft/refRight bound the in-progress selection; xDomain/
  // yDomain hold the committed zoom (Y rescales to the window so close lines spread).
  const [refLeft, setRefLeft] = useState<number | null>(null)
  const [refRight, setRefRight] = useState<number | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [xDomain, setXDomain] = useState<[number, number] | null>(null)
  const [yDomain, setYDomain] = useState<[number, number] | null>(null)

  const { data, isFetching } = useQuery({
    queryKey: ["simModelFit", sim.id, model],
    queryFn: () => klineSimulationsApi.predictions(sim.id, { model: model || undefined, sort_field: "timestamp", sort_dir: "asc", limit: 100000 }),
    enabled: !isKline,
  })

  const points = useMemo(
    () => (data?.items ?? []).map((p) => {
      const q = p.quantiles
      const pt: Record<string, number | number[] | undefined> = {
        t: new Date(p.timestamp).getTime(),
        actual: p.actual,
        predicted: p.predicted,
        band: q && q.length >= 2 ? [q[0], q[q.length - 1]] : undefined,
      }
      if (q && q.length >= 9) for (const s of QUANTILE_SERIES) pt[s.key] = q[s.idx]
      return pt
    }),
    [data],
  )
  const hasBand = points.some((p) => p.band)
  const hasQuantiles = points.some((p) => p.q50 != null)

  function computeYDomain(lo: number, hi: number): [number, number] | null {
    const keys = ["actual", "predicted", ...QUANTILE_SERIES.map((q) => q.key)].filter((k) => series.has(k))
    const useBand = series.has("band")
    let min = Infinity, max = -Infinity
    for (const p of points) {
      const t = p.t as number
      if (t < lo || t > hi) continue
      for (const k of keys) {
        const v = p[k]
        if (typeof v === "number") { if (v < min) min = v; if (v > max) max = v }
      }
      if (useBand && Array.isArray(p.band)) {
        for (const v of p.band) { if (v < min) min = v; if (v > max) max = v }
      }
    }
    if (min === Infinity) return null
    const pad = (max - min) * 0.05 || Math.abs(max) * 0.01 || 1
    return [min - pad, max + pad]
  }

  function doZoom() {
    setSelecting(false)
    if (refLeft == null || refRight == null || refLeft === refRight) { setRefLeft(null); setRefRight(null); return }
    const lo = Math.min(refLeft, refRight), hi = Math.max(refLeft, refRight)
    setXDomain([lo, hi])
    setYDomain(computeYDomain(lo, hi))
    setRefLeft(null); setRefRight(null)
  }

  function resetZoom() {
    setXDomain(null); setYDomain(null); setRefLeft(null); setRefRight(null); setSelecting(false)
  }

  // Keep the zoomed Y-range in sync when the visible series change.
  useEffect(() => {
    if (xDomain) setYDomain(computeYDomain(xDomain[0], xDomain[1]))
  }, [series, points]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isKline) {
    return (
      <p className="text-sm text-muted-foreground py-8">
        Model Fit isn’t applicable to Kline (up/down) runs — they forecast candle direction, not a price with quantiles. See the Analysis and Predictions tabs.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {models.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="px-3 py-1.5 border border-input rounded-md bg-background text-sm">
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Series</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2 cursor-pointer">
                <span className="max-w-[220px] truncate text-left">
                  {[...series].map((k) => SERIES_LABEL[k] ?? k).join(", ") || "Select series…"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Forecast</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={series.has("predicted")} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggle("predicted")}>Predicted</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={series.has("band")} disabled={!hasBand} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggle("band")}>P10–P90 band</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Quantiles</DropdownMenuLabel>
              {QUANTILE_SERIES.map((q) => (
                <DropdownMenuCheckboxItem key={q.key} checked={series.has(q.key)} disabled={!hasQuantiles} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggle(q.key)}>{q.label}</DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Actual</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={series.has("actual")} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggle("actual")}>Actual price</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isFetching && points.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">Loading…</p>
      ) : points.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">No predictions to plot.</p>
      ) : (
        <>
          <div className="relative rounded-md border bg-card p-2 h-[68vh] min-h-[420px]" style={{ userSelect: "none" }}>
            {xDomain && (
              <button
                onClick={resetZoom}
                className="absolute top-3 right-3 z-10 rounded bg-muted p-1.5 text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                title="Reset zoom"
                aria-label="Reset zoom"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={points}
                margin={{ top: 12, right: 16, bottom: 4, left: 0 }}
                onMouseDown={(e: any) => { if (e && e.activeLabel != null) { setRefLeft(Number(e.activeLabel)); setRefRight(Number(e.activeLabel)); setSelecting(true) } }}
                onMouseMove={(e: any) => { if (selecting && e && e.activeLabel != null) setRefRight(Number(e.activeLabel)) }}
                onMouseUp={doZoom}
                onMouseLeave={() => { if (selecting) doZoom() }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="t" type="number" scale="time"
                  domain={xDomain ?? ["dataMin", "dataMax"]} allowDataOverflow={!!xDomain}
                  tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tickFormatter={(v) => Number(v).toLocaleString()} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64}
                  domain={yDomain ?? ["auto", "auto"]} allowDataOverflow={!!yDomain} />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  formatter={((v: any, name: any) => {
                    if (name === "band") return [Array.isArray(v) ? `${Number(v[0]).toLocaleString()} – ${Number(v[1]).toLocaleString()}` : v, "P10–P90"]
                    return [Number(v).toLocaleString(), SERIES_LABEL[name] ?? name]
                  }) as any}
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                />
                <Legend formatter={(v) => SERIES_LABEL[v as string] ?? v} wrapperStyle={{ fontSize: 12 }} />
                {series.has("band") && hasBand && <Area dataKey="band" stroke="none" fill="#26a69a" fillOpacity={0.12} isAnimationActive={false} connectNulls />}
                {QUANTILE_SERIES.filter((q) => series.has(q.key)).map((q) => (
                  <Line key={q.key} type="monotone" dataKey={q.key} stroke={q.color} strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
                ))}
                {series.has("actual") && <Line type="monotone" dataKey="actual" stroke="#888" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                {series.has("predicted") && <Line type="monotone" dataKey="predicted" stroke="#26a69a" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                {selecting && refLeft != null && refRight != null && (
                  <ReferenceArea x1={refLeft} x2={refRight} strokeOpacity={0.3} fill="#888" fillOpacity={0.12} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">
            Actual vs predicted close over the simulation period. Use the Series menu to add the P10–P90 band or individual quantiles (Q10–Q90). Drag left/right across the chart to zoom into a period (Y rescales so close lines separate); use the zoom-out icon to reset.
          </p>
        </>
      )}
    </div>
  )
}

function PredictionsTable({ simId, isKline }: { simId: string; isKline?: boolean }) {
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<PredSortField>("timestamp")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [model, setModel] = useState<string>("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(() => loadStars())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [forecast, setForecast] = useState<string>("prediction")
  const cacheRef = useRef<Map<string, KlineSimulationPredictionResponse>>(new Map())

  // The forecast value (point prediction or a quantile) used in the direction columns.
  const fcCol = FORECAST_OPTIONS.find((o) => o.value === forecast)?.col ?? "Predicted"
  const fcValue = (r: KlineSimulationPredictionResponse): number | null => {
    if (forecast === "prediction") return r.predicted
    const idx = Q_IDX[forecast]
    return r.quantiles && r.quantiles[idx] != null ? r.quantiles[idx] : null
  }

  const { data } = useQuery({
    queryKey: ["simPredictions", simId, model, sortField, sortDir, page, forecast],
    queryFn: () => klineSimulationsApi.predictions(simId, {
      model: model || undefined,
      sort_field: sortField,
      sort_dir: sortDir,
      limit: PRED_PER_PAGE,
      offset: (page - 1) * PRED_PER_PAGE,
      forecast,
    }),
    enabled: !showOnlySelected, // when filtering to selected we render from the cache
  })
  const total = data?.total ?? 0
  const models = data?.models ?? []

  // Accumulate loaded rows so "show only selected" can render rows across pages.
  useEffect(() => {
    if (data?.items) { const c = cacheRef.current; data.items.forEach((r) => c.set(r.id, r)) }
  }, [data])

  // Drop the filter automatically once nothing is selected.
  useEffect(() => {
    if (showOnlySelected && selectedIds.size === 0) { setShowOnlySelected(false); setPage(1) }
  }, [selectedIds.size, showOnlySelected])

  function toggleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); saveStars(n); return n })
  }
  async function selectByDirection(direction: "correct" | "faulty") {
    const res = await klineSimulationsApi.predictions(simId, { model: model || undefined, direction, forecast, limit: 100000 })
    res.items.forEach((r) => cacheRef.current.set(r.id, r))
    setSelectedIds(new Set(res.items.map((r) => r.id)))
  }
  function handleSort(field: PredSortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
    setPage(1)
  }
  function PSortHeader({ field, label, align }: { field: PredSortField; label: string; align?: "right" }) {
    const active = sortField === field
    return (
      <button onClick={() => handleSort(field)} className={cn("flex items-center gap-1 font-medium hover:text-foreground transition-colors", align === "right" && "ml-auto")}>
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  // Sorted client-side view of the selected rows (used by "show only selected").
  const getVal = (r: KlineSimulationPredictionResponse): number => {
    const fv = fcValue(r)
    const md = r.prev_close == null || fv == null ? null : fv - r.prev_close
    const ad = r.prev_close == null ? null : r.actual - r.prev_close
    switch (sortField) {
      case "timestamp": return new Date(r.timestamp).getTime()
      case "prob_up": return r.prob_up ?? -1
      case "in_interval": return r.in_interval == null ? -1 : r.in_interval ? 1 : 0
      case "predicted": return fv ?? -Infinity
      case "actual_direction": return ad ?? -Infinity
      case "model_direction": return md ?? -Infinity
      case "direction": return md != null && md > 0 ? (ad != null && ad > 0 ? 2 : ad != null && ad < 0 ? 1 : 0) : 0
      default: return (r as unknown as Record<string, number>)[sortField] ?? 0
    }
  }
  const selectedRows: KlineSimulationPredictionResponse[] | null = showOnlySelected
    ? [...selectedIds]
        .map((id) => cacheRef.current.get(id))
        .filter((r): r is KlineSimulationPredictionResponse => !!r)
        .sort((a, b) => { const d = getVal(a) - getVal(b); return sortDir === "asc" ? d : -d })
    : null

  const viewTotal = showOnlySelected ? (selectedRows?.length ?? 0) : total
  const totalPages = Math.max(1, Math.ceil(viewTotal / PRED_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const rows: KlineSimulationPredictionResponse[] = showOnlySelected
    ? (selectedRows ?? []).slice((safePage - 1) * PRED_PER_PAGE, safePage * PRED_PER_PAGE)
    : (data?.items ?? [])

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  const covTotal = data?.coverage_total ?? 0
  const covInside = data?.coverage_inside ?? 0
  const covPct = covTotal > 0 ? Math.round((covInside / covTotal) * 100) : null
  const fmt0 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  const fmt2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} predictions</p>
          {!isKline && covPct !== null && (
            <p className="text-sm text-muted-foreground" title="Share of actuals that fell inside the model's 80% (P10–P90) band. Ideal ≈ 80%.">
              Calibration: <span className="font-medium text-foreground">{covPct}%</span> inside 80% band
              <span className="text-xs"> ({covInside.toLocaleString()}/{covTotal.toLocaleString()})</span>
            </p>
          )}
          {!isKline && data?.mape != null && (
            <p className="text-sm text-muted-foreground" title="Mean Absolute Percentage Error: the average of the per-bar % Error across the whole run.">
              MAPE: <span className="font-medium text-foreground">{data.mape.toFixed(2)}%</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isKline && (
            <select value={forecast} onChange={(e) => { setForecast(e.target.value); setPage(1) }} className="px-3 py-1.5 border border-input rounded-md bg-background text-sm" title="Which forecast value drives the Predicted / direction columns.">
              {FORECAST_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {models.length > 1 && (
            <select value={model} onChange={(e) => { setModel(e.target.value); setPage(1) }} className="px-3 py-1.5 border border-input rounded-md bg-background text-sm">
              <option value="">All models</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="border rounded-md">
        <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 pl-4">
                <div className="flex items-center gap-0.5">
                  <Checkbox
                    checked={allSelected ? true : selectedIds.size > 0 ? "indeterminate" : false}
                    onCheckedChange={(c) => setSelectedIds((prev) => {
                      const n = new Set(prev)
                      if (c) rows.forEach((r) => n.add(r.id)); else rows.forEach((r) => n.delete(r.id))
                      return n
                    })}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors"><ChevronDown className="h-3 w-3" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => setSelectedIds(new Set(rows.map((r) => r.id)))}>Select all</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSelectedIds(new Set(starredIds))}>Starred</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => selectByDirection("correct")}>Correct Direction</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => selectByDirection("faulty")}>Faulty Direction</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableHead>
              <TableHead><PSortHeader field="timestamp" label="Timestamp" /></TableHead>
              <TableHead className="text-right" title="The actual close of the previous bar — the price the forecast is made from.">Previous</TableHead>
              <TableHead className="text-right"><PSortHeader field="actual" label="Actual" align="right" /></TableHead>
              <TableHead className="text-right" title="Realized move: Actual − Previous."><PSortHeader field="actual_direction" label="Actual Direction" align="right" /></TableHead>
              {isKline ? (
                <>
                  <TableHead className="text-center" title="The model's directional call for this bar: Up when P(up) ≥ 50%, else Down.">Forecast</TableHead>
                  <TableHead className="text-right" title="The model's forecast of the next up/down symbol — its probability the bar closes up.">
                    <PSortHeader field="prob_up" label="P(up)" align="right" />
                  </TableHead>
                  <TableHead className="text-center" title="Did the Up/Down call match the actual direction? ✓ = correct, ✗ = wrong.">
                    <PSortHeader field="direction" label="Direction" />
                  </TableHead>
                </>
              ) : (
                <>
                  <TableHead className="text-right" title="The forecast value selected above (point prediction or a quantile)."><PSortHeader field="predicted" label={fcCol} align="right" /></TableHead>
                  <TableHead className="text-right" title={`Forecast move: ${fcCol} − Previous.`}><PSortHeader field="model_direction" label={`${fcCol} Direction`} align="right" /></TableHead>
                  <TableHead className="text-center" title={`Directional hit when the forecast (${fcCol}) points up: ✓ if it actually rose, ✗ if it fell. Blank when the forecast points down.`}><PSortHeader field="direction" label="Direction" /></TableHead>
                  <TableHead className="text-right" title="Signed error: Actual − Predicted (green = model under-predicted, red = over-predicted)."><PSortHeader field="error" label="Error" align="right" /></TableHead>
                  <TableHead className="text-right"><PSortHeader field="pct_error" label="% Error" align="right" /></TableHead>
                  <TableHead className="text-right whitespace-nowrap" title="The model's 80% prediction band: P10 to P90. There's an estimated 80% chance the close lands between these two prices.">P10–P90</TableHead>
                  <TableHead className="text-right" title="Modeled probability that this bar's close is higher than the previous close (1 − the model's CDF at the previous close, read off the quantiles).">
                    <PSortHeader field="prob_up" label="P(up)" align="right" />
                  </TableHead>
                  <TableHead className="text-center" title="Did the actual close fall inside the model's 80% band [P10, P90]? A well-calibrated model lands inside ≈80% of the time.">
                    <PSortHeader field="in_interval" label="In 80%" />
                  </TableHead>
                </>
              )}
              <TableHead className="w-10 text-center"><Star className="h-4 w-4 opacity-40 mx-auto" /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={isKline ? 9 : 14} className="text-center text-sm text-muted-foreground py-8">No predictions</TableCell></TableRow>
            ) : rows.map((r) => {
              const fv = fcValue(r)
              const md = r.prev_close == null || fv == null ? null : fv - r.prev_close
              const ad = r.prev_close == null ? null : r.actual - r.prev_close
              // Kline strategy: the model makes a binary Up/Down call (Up when
              // P(up) ≥ 50%); a hit is when that call matches the actual move.
              const callUp = r.prob_up != null && r.prob_up >= 0.5
              const klineHit = ad != null && ad !== 0 && (callUp === (ad > 0))
              return (
              <TableRow key={r.id} onContextMenu={(e) => { e.preventDefault(); toggleStar(r.id) }} className="cursor-default">
                <TableCell className="pl-4">
                  <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={(c) => setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(r.id) : n.delete(r.id); return n })} />
                </TableCell>
                <TableCell className="text-xs font-mono whitespace-nowrap">{format(new Date(r.timestamp), "yyyy-MM-dd HH:mm")}</TableCell>
                <TableCell className="text-right text-sm font-mono text-muted-foreground">{r.prev_close == null ? "—" : fmt2(r.prev_close)}</TableCell>
                <TableCell className="text-right text-sm font-mono">{fmt2(r.actual)}</TableCell>
                <TableCell className={cn("text-right text-sm font-mono", ad == null ? "text-muted-foreground" : ad > 0 ? "text-green-500" : ad < 0 ? "text-red-500" : "")}>
                  {ad == null ? "—" : `${ad >= 0 ? "+" : ""}${fmt2(ad)}`}
                </TableCell>
                {isKline ? (
                  <>
                    <TableCell className="text-center text-sm font-medium">
                      {r.prob_up == null ? <span className="text-muted-foreground">—</span> : callUp ? <span className="text-green-500">Up</span> : <span className="text-red-500">Down</span>}
                    </TableCell>
                    <TableCell className={cn("text-right text-sm font-mono", r.prob_up == null ? "text-muted-foreground" : r.prob_up >= 0.5 ? "text-green-500" : "text-red-500")}>
                      {r.prob_up == null ? "—" : `${(r.prob_up * 100).toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {ad == null || ad === 0 ? null : klineHit ? <span className="text-green-500">✓</span> : <span className="text-red-500">✗</span>}
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-right text-sm font-mono">{fv == null ? "—" : fmt2(fv)}</TableCell>
                    <TableCell className={cn("text-right text-sm font-mono", md == null ? "text-muted-foreground" : md > 0 ? "text-green-500" : md < 0 ? "text-red-500" : "")}>
                      {md == null ? "—" : `${md >= 0 ? "+" : ""}${fmt2(md)}`}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {md != null && md > 0
                        ? (ad != null && ad > 0
                            ? <span className="text-green-500">✓</span>
                            : ad != null && ad < 0
                              ? <span className="text-red-500">✗</span>
                              : null)
                        : null}
                    </TableCell>
                    <TableCell className={cn("text-right text-sm font-mono", r.error > 0 ? "text-green-500" : r.error < 0 ? "text-red-500" : "")}>
                      {`${r.error >= 0 ? "+" : ""}${fmt2(r.error)}`}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">{r.pct_error.toFixed(2)}%</TableCell>
                    <TableCell className="text-right text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {r.quantiles ? `${fmt0(r.quantiles[0])} – ${fmt0(r.quantiles[r.quantiles.length - 1])}` : "—"}
                    </TableCell>
                    <TableCell className={cn("text-right text-sm font-mono", r.prob_up == null ? "text-muted-foreground" : r.prob_up >= 0.5 ? "text-green-500" : "text-red-500")}>
                      {r.prob_up == null ? "—" : `${(r.prob_up * 100).toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {r.in_interval == null ? <span className="text-muted-foreground">—</span> : r.in_interval ? <span className="text-green-500">✓</span> : <span className="text-amber-500">✗</span>}
                    </TableCell>
                  </>
                )}
                <TableCell className="text-center w-10">
                  <button onClick={() => toggleStar(r.id)} className="hover:text-amber-400 transition-colors" aria-label="Toggle star">
                    <Star className={cn("h-4 w-4", starredIds.has(r.id) ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                  </button>
                </TableCell>
              </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {viewTotal > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Showing {(safePage - 1) * PRED_PER_PAGE + 1}–{Math.min(safePage * PRED_PER_PAGE, viewTotal)} of {viewTotal.toLocaleString()}
          </span>
          {totalPages > 1 && (
            <Pagination className="w-auto mx-0">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} />
                </PaginationItem>
                {buildPaginationPages(safePage, totalPages).map((p, i) =>
                  p === "ellipsis" ? (
                    <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={safePage === p} onClick={() => setPage(p)}>{p}</PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-1 py-1.5 border-t">
          <span className="text-xs text-muted-foreground">Selected {selectedIds.size} of {total.toLocaleString()} predictions</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() => { setShowOnlySelected((v) => !v); setPage(1) }}
            title={showOnlySelected ? "Show all" : "Show only selected"}
          >
            <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
          </Button>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, hint, tone, info }: { label: string; value: string; hint?: string; tone?: "good" | "bad"; info?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        {info && <InfoIcon text={info} />}
      </div>
      <p className={cn("text-lg font-semibold", tone === "good" && "text-green-500", tone === "bad" && "text-red-500")}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function BacktestTab({ sim }: { sim: KlineSimulationResponse }) {
  const [threshold, setThreshold] = useState(0.6)
  const [feeBps, setFeeBps] = useState(15)
  const [minEdge, setMinEdge] = useState(0)
  const [coverFees, setCoverFees] = useState(false)
  const [allowShort, setAllowShort] = useState(false)
  const [volMode, setVolMode] = useState<string>("")
  const [positionSizing, setPositionSizing] = useState<string>("none")
  const [pyramidSteps, setPyramidSteps] = useState(4)
  const [showTradeMarkers, setShowTradeMarkers] = useState(true)
  // Whether this run stored a genuine volatility forecast (the "Forecast
  // volatility" box at creation). If not, the vol strategies fall back to the
  // price band-width proxy.
  const hasVolForecast = sim.config?.["forecast_vol"] === true
  // Volatility strategies don't apply to Kline runs (no price band, no vol
  // series): vol-targeting silently equals None and vol-breakout never trades.
  const isKline = sim.strategy === "kline"
  const effVolMode = isKline ? "" : volMode

  const { data, isFetching, error } = useQuery({
    queryKey: ["simBacktest", sim.id, threshold, feeBps, minEdge, coverFees, allowShort, effVolMode, positionSizing, pyramidSteps],
    queryFn: () => klineSimulationsApi.backtest(sim.id, { threshold, fee_bps: feeBps, min_edge_pct: minEdge, cover_fees: coverFees, allow_short: allowShort, vol_mode: effVolMode || undefined, position_sizing: positionSizing, pyramid_steps: pyramidSteps }),
    retry: false,
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
      good: m.ret >= 0,
    })),
    [data],
  )

  const beatsBH = data ? data.total_return_pct > data.buy_hold_return_pct : false
  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-md border p-4">
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Confidence threshold (P(up) ≥)</label>
            <InfoIcon text="Go long only when the model's probability that this bar closes higher than the previous close — P(up) — is at least this value. Higher = fewer, higher-conviction trades." />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={0.5} max={0.9} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="flex-1" />
            <span className="text-sm font-mono w-10 text-right">{threshold.toFixed(2)}</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Round-trip fee (bps)</label>
            <InfoIcon text="Trading cost charged per complete round trip (buy + sell), in basis points. 1 bp = 0.01%, so 15 bps = 0.15%. Binance spot taker fees are ~10 bps." />
          </div>
          <Input type="number" value={feeBps} min={0} max={100} step={2.5} onChange={(e) => setFeeBps(Number(e.target.value))} className="h-9 mt-1" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Min predicted move (%)</label>
            <InfoIcon text="Only trade when the point forecast clears the previous close by at least this percentage. Raising it filters out low-conviction bars whose edge can't cover fees (0 = no filter)." />
          </div>
          <Input type="number" value={minEdge} min={0} max={20} step={0.1} onChange={(e) => setMinEdge(Number(e.target.value))} className="h-9 mt-1" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Volatility strategy</label>
            <InfoIcon text="How the same forecast is turned into trades. None: go long at full size on every signal. Vol-targeting: size each long inversely to the predicted 80%-band width (smaller on violent bars). Vol-breakout: only take the long when predicted band width exceeds its 20-bar trailing average (a vol expansion)." />
          </div>
          <select value={effVolMode} onChange={(e) => setVolMode(e.target.value)} disabled={isKline} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm disabled:opacity-50 disabled:cursor-not-allowed">
            <option value="">None (price)</option>
            <option value="vol_targeting">Vol-targeting</option>
            <option value="vol_breakout">Vol-breakout</option>
          </select>
          <div className="mt-1 h-4">
            {isKline ? (
              <span className="text-[10px] text-muted-foreground" title="Volatility strategies need a price band / volatility series, which Kline (up/down) runs don't produce. They only forecast the candle direction.">
                n/a for Kline runs
              </span>
            ) : effVolMode && data?.vol_source ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                  data.vol_source === "forecast" ? "bg-green-500/15 text-green-500" : "bg-amber-500/15 text-amber-500",
                )}
                title={data.vol_source === "forecast"
                  ? "Using this run's genuine volatility forecast (pred_vol)."
                  : "No vol forecast stored for this run — using the predicted price band width (P90−P10) as a proxy."}
              >
                vol: {data.vol_source === "forecast" ? "forecast" : "band proxy"}
              </span>
            ) : !hasVolForecast ? (
              <span className="text-[10px] text-muted-foreground" title="This run was created without 'Forecast volatility', so vol strategies use the price band width (P90−P10). Re-run with the box ticked for a genuine forecast.">
                no vol forecast · uses band proxy
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">genuine vol forecast available</span>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Position sizing</label>
            <InfoIcon text="How big each long is. None: full size on every signal. Conviction-weighted: size scales with how far P(up) clears the threshold (stronger signal = bigger position). Pyramiding-on-streak: start small and add to the position over consecutive signal bars, reaching full size after a few. Sizing multiplies whatever the volatility strategy decides; each size change is a real fill and pays fees." />
          </div>
          <select value={positionSizing} onChange={(e) => setPositionSizing(e.target.value)} className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm">
            <option value="none">None (full size)</option>
            <option value="conviction">Conviction-weighted</option>
            <option value="pyramiding">Pyramiding-on-streak</option>
          </select>
          <div className="mt-1 min-h-4">
            {positionSizing === "conviction" ? (
              <span className="text-[10px] text-muted-foreground">size ∝ P(up) above threshold</span>
            ) : positionSizing === "pyramiding" ? (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>full size after</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={pyramidSteps}
                  onChange={(e) => setPyramidSteps(Math.max(1, Math.min(50, Math.round(Number(e.target.value)) || 1)))}
                  className="h-6 w-14 px-1.5 text-[11px]"
                />
                <span>bars ({(100 / pyramidSteps).toFixed(0)}%/bar)</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Fee-aware entry filter */}
        <label className="col-span-2 md:col-span-4 flex items-start gap-2.5 cursor-pointer border-t pt-3 mt-1">
          <Checkbox checked={coverFees} onCheckedChange={(v) => setCoverFees(!!v)} className="mt-0.5 shrink-0" />
          <span className="text-xs">
            <span className="font-medium">Only trade when forecast covers fees</span>
            <InfoIcon text="Only take a long when the point forecast's move over the previous close exceeds the round-trip fee (added on top of any minimum predicted move). This skips trades whose expected gross edge can't pay for entering and exiting." />
            <span className="block text-muted-foreground mt-0.5">
              Requires forecast move ≥ {(feeBps / 100).toFixed(2)}% (round-trip fee){minEdge > 0 ? ` + ${minEdge}% min edge` : ""}
              {coverFees && data?.effective_min_edge_pct != null
                ? ` → effective ≥ ${data.effective_min_edge_pct.toFixed(2)}%`
                : ""}
            </span>
          </span>
        </label>

        {/* Long/short toggle */}
        <label className="col-span-2 md:col-span-4 flex items-start gap-2.5 cursor-pointer border-t pt-3 mt-1">
          <Checkbox checked={allowShort} onCheckedChange={(v) => setAllowShort(!!v)} className="mt-0.5 shrink-0" />
          <span className="text-xs">
            <span className="font-medium">Allow short positions (long/short)</span>
            <InfoIcon text="When on, the strategy also goes SHORT for the next bar when P(up) ≤ 1 − threshold (the symmetric down-signal), profiting when price falls. Off = long-only (down-signals just stay in cash). Trading fees are symmetric (same per side as a long, matching Binance commission), but funding / borrow costs that real shorts pay are NOT modeled — so short results are optimistic by that amount." />
            <span className="block text-muted-foreground mt-0.5">
              {allowShort
                ? `Short when P(up) ≤ ${(1 - threshold).toFixed(2)}${data?.short_bars != null ? ` · ${data.short_bars} short bars` : ""} — funding/borrow not modeled`
                : "Long-only — down-forecasts stay in cash"}
            </span>
          </span>
        </label>
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground py-8">No quantile-based predictions to backtest (the model produced no quantiles).</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground py-8">{isFetching ? "Running backtest…" : "—"}</p>
      ) : (
        <>
          {/* Metrics */}
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            <Metric label="Strategy return" value={fmtPct(data.total_return_pct)} tone={data.total_return_pct >= 0 ? "good" : "bad"} hint={beatsBH ? "beats buy & hold" : "trails buy & hold"} info="Total return of the thresholded strategy over the whole period, after fees, compounded bar by bar." />
            <Metric label="Buy & hold" value={fmtPct(data.buy_hold_return_pct)} tone={data.buy_hold_return_pct >= 0 ? "good" : "bad"} info="Total return of simply holding the coin over the same bars (one round-trip fee) — the baseline the strategy has to beat." />
            <Metric label="Sharpe (annualized)" value={data.sharpe.toFixed(2)} tone={data.sharpe >= 0 ? "good" : "bad"} info="Risk-adjusted return: mean per-bar return ÷ its volatility, scaled to a yearly figure. Higher is better; above 1 is good, below 0 means losing." />
            <Metric label="Max drawdown" value={`${data.max_drawdown_pct.toFixed(1)}%`} tone="bad" info="The largest peak-to-trough drop in the strategy's equity curve — the worst loss you would have had to sit through." />
            <Metric label="Trades" value={data.n_trades.toLocaleString()} hint={data.allow_short && data.short_bars ? `${data.exposure_pct.toFixed(0)}% in mkt · ${data.long_bars}L/${data.short_bars}S` : `${data.exposure_pct.toFixed(0)}% in market`} info="A trade is one in-market campaign (entry → exit), regardless of how many fills it took. Win rate and avg/trade are measured per campaign. In long/short mode a flip from long to short ends one campaign and starts another." />
            <Metric label="Fills" value={(data.n_fills ?? 0).toLocaleString()} hint={data.n_fills && data.n_trades ? `${(data.n_fills / data.n_trades).toFixed(1)}× per trade` : undefined} info="Actual exchange orders (buys + sells). Every position-size change is one fill that pays a fee, so scaling strategies (conviction, pyramiding) produce more fills than trades — this is where their extra fee drag shows up." />
            <Metric label="Win rate" value={`${data.win_rate_pct.toFixed(1)}%`} />
            <Metric label="Avg / trade" value={fmtPct(data.avg_return_per_trade_pct)} tone={data.avg_return_per_trade_pct >= 0 ? "good" : "bad"} />
            <Metric label="Bars" value={data.n_bars.toLocaleString()} />
          </div>

          {/* Equity curve */}
          <div className="relative rounded-md border bg-card p-2">
            <button
              type="button"
              onClick={() => setShowTradeMarkers((v) => !v)}
              aria-label={showTradeMarkers ? "Hide trade markers" : "Show trade markers"}
              title={showTradeMarkers ? "Hide trade markers (green = winning trade, red = losing)" : "Show trade markers (green = winning trade, red = losing)"}
              className={cn(
                "absolute top-2 right-2 z-10 rounded p-1.5 transition-colors",
                showTradeMarkers ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Flag className="h-4 w-4" />
            </button>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={curve} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
                  tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                {showTradeMarkers && tradeMarkers.map((m, idx) => (
                  <ReferenceLine
                    key={`tm-${idx}`}
                    x={m.t}
                    stroke={m.good ? "#22c55e" : "#ef4444"}
                    strokeOpacity={0.25}
                    strokeWidth={2}
                  />
                ))}
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  formatter={((v: any, name: any) => [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`, name === "strategy" ? "Strategy" : "Buy & hold"]) as any}
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                />
                <Line type="monotone" dataKey="buy_hold" stroke="#888" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="strategy" stroke="#26a69a" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="text-xs text-muted-foreground">
            {data.allow_short ? "Long/short, 1-bar holds." : "Long-only, 1-bar holds."} Go long when P(up) ≥ {threshold.toFixed(2)}{data.allow_short ? `, short when P(up) ≤ ${(1 - threshold).toFixed(2)}` : ""}{minEdge > 0 ? ` and the point forecast clears the last close by ≥ ${minEdge}%` : ""};
            {coverFees && ` only when the forecast move also covers the round-trip fee (effective ≥ ${(data.effective_min_edge_pct ?? 0).toFixed(2)}%);`}
            {" "}{feeBps} bps charged per round trip{data.allow_short ? " (shorts pay the same commission; funding/borrow not modeled)" : ""}. Green = strategy, grey = buy & hold.
            {data.vol_mode === "vol_targeting" && ` Position size is scaled inversely to ${data.vol_source === "forecast" ? "the genuine volatility forecast" : "the predicted 80%-band width"} (vol targeting).`}
            {data.vol_mode === "vol_breakout" && ` Longs are only taken when ${data.vol_source === "forecast" ? "the forecasted volatility" : "the predicted band width"} exceeds its 20-bar trailing average (vol expansion).`}
            {data.position_sizing === "conviction" && " Each long is sized in proportion to how far P(up) clears the threshold (conviction-weighted)."}
            {data.position_sizing === "pyramiding" && ` Each long starts small and scales up over consecutive signal bars, reaching full size after ${data.pyramid_steps ?? pyramidSteps} bars (pyramiding).`}
            {showTradeMarkers && " Vertical lines mark each trade entry (green = winning trade, red = losing); toggle with the flag icon."}
          </p>
        </>
      )}
    </div>
  )
}

export default function SimulationsPage() {
  const queryClient = useQueryClient()

  // Master table state
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("finished_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [selectedSimId, setSelectedSimId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("details")
  const [detailMaximized, setDetailMaximized] = useState(false)
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  // Single-simulation delete (from the detail pane's Actions tab)
  const [simDeleteDialogOpen, setSimDeleteDialogOpen] = useState(false)
  const [simDeleteUnderstood, setSimDeleteUnderstood] = useState(false)
  const [simDeleteConfirmText, setSimDeleteConfirmText] = useState("")

  const { data: listData } = useQuery({
    queryKey: ["klineSimulations", search, sortField, sortDir],
    queryFn: () => klineSimulationsApi.list({ search, sort_field: sortField, sort_dir: sortDir, limit: 200 }),
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? []
      return items.some((s) => s.status === "pending" || s.status === "started") ? 2000 : false
    },
  })
  const sims = listData?.items ?? []
  const visibleSims = showOnlySelected ? sims.filter((s) => selectedIds.has(s.id)) : sims
  const selectedSim = useMemo(() => sims.find((s) => s.id === selectedSimId) ?? null, [sims, selectedSimId])

  // Drop the "show only selected" filter once nothing is selected.
  useEffect(() => {
    if (showOnlySelected && selectedIds.size === 0) setShowOnlySelected(false)
  }, [selectedIds.size, showOnlySelected])

  const starMutation = useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) => klineSimulationsApi.update(id, { starred }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["klineSimulations"] }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => klineSimulationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["klineSimulations"] })
      toast.success("Simulation deleted")
    },
  })

  function openDeleteDialog() {
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    await Promise.all(ids.map((id) => deleteMutation.mutateAsync(id)))
    if (selectedSimId && ids.includes(selectedSimId)) setSelectedSimId(null)
    setSelectedIds(new Set())
    setDeleteDialogOpen(false)
  }

  function openSimDeleteDialog() {
    setSimDeleteUnderstood(false)
    setSimDeleteConfirmText("")
    setSimDeleteDialogOpen(true)
  }

  async function handleSimDelete() {
    if (!selectedSim) return
    const id = selectedSim.id
    await deleteMutation.mutateAsync(id)
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
    setSelectedSimId(null)
    setSimDeleteDialogOpen(false)
  }

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  // A failed run leads with the Error tab; otherwise open on Details.
  function defaultTabFor(sim: KlineSimulationResponse) {
    return sim.status === "failure" ? "error" : "details"
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button onClick={() => handleSort(field)} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors text-left">
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  useEffect(() => {
    const el = tabsListRef.current?.querySelector('[data-state="active"]') as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selectedSim, detailMaximized])

  const allSelected = visibleSims.length > 0 && visibleSims.every((s) => selectedIds.has(s.id))

  // Distinct coins across the loaded simulations, for the header "Select <coin>" items.
  const coinSymbols = useMemo(
    () => [...new Set(sims.map((s) => s.coin_symbol).filter((c): c is string => !!c))].sort(),
    [sims],
  )
  const selectSimsBy = (pred: (s: KlineSimulationResponse) => boolean) =>
    setSelectedIds(new Set(sims.filter(pred).map((s) => s.id)))

  return (
    <>
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Master table ── */}
      <div className={cn("flex flex-col shrink-0", detailMaximized && selectedSim && "hidden")}>
        <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-background">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">Simulations</span>
            <InfoIcon text="A simulation is a walk-forward backtest: for every bar in the date range the model forecasts one step ahead using only the data before it, then each forecast is scored against what actually happened." />
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search simulations..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-7 pl-8 w-52 text-sm" />
          </div>
        </div>

        <div className="overflow-y-auto max-h-[45vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-4">
                  <div className="flex items-center gap-0.5">
                    <Checkbox
                      checked={allSelected ? true : selectedIds.size > 0 ? "indeterminate" : false}
                      onCheckedChange={(c) => setSelectedIds(c ? new Set(visibleSims.map((s) => s.id)) : new Set())}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors">
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => selectSimsBy(() => true)}>Select All</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => selectSimsBy((s) => s.starred)}>Starred</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => selectSimsBy((s) => s.status === "failure")}>Select failed</DropdownMenuItem>
                        {coinSymbols.length > 0 && <DropdownMenuSeparator />}
                        {coinSymbols.map((coin) => (
                          <DropdownMenuItem key={coin} onClick={() => selectSimsBy((s) => s.coin_symbol === coin)}>
                            Select {coin}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead><SortHeader field="name" label="Name" /></TableHead>
                <TableHead><SortHeader field="coin" label="Coin" /></TableHead>
                <TableHead><SortHeader field="quote_asset" label="Trading Pair" /></TableHead>
                <TableHead><SortHeader field="interval" label="Timeframe" /></TableHead>
                <TableHead><SortHeader field="strategy" label="Strategy" /></TableHead>
                <TableHead><SortHeader field="start_date" label="Date Range" /></TableHead>
                <TableHead><SortHeader field="finished_at" label="Finished" /></TableHead>
                <TableHead className="w-10 text-center">
                  <button onClick={() => handleSort("starred")} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors mx-auto">
                    <Star className={cn("h-4 w-4", sortField === "starred" ? "" : "opacity-40")} />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSims.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">No simulations yet</TableCell></TableRow>
              ) : visibleSims.map((sim) => (
                <TableRow
                  key={sim.id}
                  data-state={selectedSimId === sim.id ? "selected" : undefined}
                  onClick={() => { setSelectedSimId(sim.id); setActiveTab(defaultTabFor(sim)) }}
                  onContextMenu={(e) => { e.preventDefault(); starMutation.mutate({ id: sim.id, starred: !sim.starred }) }}
                  className="cursor-pointer"
                >
                  <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(sim.id)}
                      onCheckedChange={(c) => {
                        setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(sim.id) : n.delete(sim.id); return n })
                        if (c) { setSelectedSimId(sim.id); setActiveTab(defaultTabFor(sim)) }
                        else if (selectedSimId === sim.id) setSelectedSimId(null)
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-sm max-w-[16rem] truncate">{sim.name || <span className="text-muted-foreground italic">Untitled</span>}</TableCell>
                  <TableCell className="font-mono font-medium text-sm">{sim.coin_symbol}</TableCell>
                  <TableCell className="font-mono text-sm">{sim.coin_symbol}{sim.quote_asset}</TableCell>
                  <TableCell className="text-sm">{sim.interval}</TableCell>
                  <TableCell className="text-xs">{strategyLabel(sim)}</TableCell>
                  <TableCell className="text-xs font-mono">{sim.start_date} → {sim.end_date}</TableCell>
                  <TableCell><StatusCell sim={sim} /></TableCell>
                  <TableCell className="text-center w-10" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => starMutation.mutate({ id: sim.id, starred: !sim.starred })} className="hover:text-amber-400 transition-colors" aria-label="Toggle star">
                      <Star className={cn("h-4 w-4", sim.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
            <span className="text-xs text-muted-foreground">Selected {selectedIds.size} of {sims.length}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 cursor-pointer"
                onClick={() => setShowOnlySelected((v) => !v)}
                title={showOnlySelected ? "Show all" : "Show only selected"}
              >
                <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                onClick={openDeleteDialog}
                title="Delete selected"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Detail pane ── */}
      {selectedSim && (
        <>
          <hr className={cn("my-8", detailMaximized && "hidden")} />
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col gap-0">
              <div className="relative w-full">
                <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex justify-start">
                  {selectedSim.status === "failure" && (
                    <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer text-destructive data-[state=active]:text-destructive" value="error">Error</TabsTrigger>
                  )}
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="details">Details</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="analysis">Analysis</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="modelfit">Model Fit</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="predictions">Predictions</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="backtest">Backtest</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="actions">Actions</TabsTrigger>
                  <div
                    className="ml-auto flex items-center pr-2 pl-3 mb-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setDetailMaximized((v) => !v)}
                    aria-label={detailMaximized ? "Normalize" : "Maximize"}
                    title={detailMaximized ? "Normalize" : "Maximize"}
                  >
                    {detailMaximized ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
                  </div>
                </TabsList>
                <div
                  className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                  style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
                />
              </div>

              {selectedSim.status === "failure" && (
                <TabsContent value="error" className="max-w-2xl mt-6 pl-[2px]">
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 space-y-1">
                    <p className="text-sm font-semibold text-destructive">Error</p>
                    <p className="text-sm font-mono text-foreground/80 whitespace-pre-wrap break-words">
                      {selectedSim.error ?? "No error message available."}
                    </p>
                  </div>
                </TabsContent>
              )}

              <TabsContent value="details" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <FieldRow label="ID">
                  <div className="relative">
                    <Input value={selectedSim.id} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono text-xs" />
                    <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                      <CopyIcon size={16} className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => { navigator.clipboard.writeText(selectedSim.id); toast.success("Copied to clipboard") }} />
                    </AnimateIcon>
                  </div>
                </FieldRow>
                <FieldRow label="Name"><Input value={selectedSim.name ?? ""} readOnly placeholder="Untitled" className="opacity-70 cursor-default" /></FieldRow>
                {selectedSim.description && (
                  <FieldRow label="Description"><p className="text-sm whitespace-pre-wrap text-muted-foreground">{selectedSim.description}</p></FieldRow>
                )}
                <FieldRow label="Coin"><Input value={selectedSim.coin_symbol ?? ""} readOnly className="opacity-70 cursor-default font-mono" /></FieldRow>
                <FieldRow label="Trading Pair"><Input value={`${selectedSim.coin_symbol ?? ""}${selectedSim.quote_asset}`} readOnly className="opacity-70 cursor-default font-mono" /></FieldRow>
                <FieldRow label="Timeframe"><Input value={selectedSim.interval} readOnly className="opacity-70 cursor-default" /></FieldRow>
                <FieldRow label="Simulation Strategy"><Input value={strategyLabel(selectedSim)} readOnly className="opacity-70 cursor-default" /></FieldRow>
                <FieldRow label={selectedSim.models.length > 1 ? "Models" : "Model"}><Input value={selectedSim.models.join(", ")} readOnly className="opacity-70 cursor-default font-mono" /></FieldRow>
                <FieldRow label="Date Range"><Input value={`${selectedSim.start_date} → ${selectedSim.end_date}`} readOnly className="opacity-70 cursor-default font-mono" /></FieldRow>
                {(() => {
                  const cfg = selectedSim.config as { strategy_name?: string; parameters?: Record<string, string> } | null
                  const entries = Object.entries(cfg?.parameters ?? {})
                  if (!cfg?.strategy_name && entries.length === 0) return null
                  return (
                    <>
                      {cfg?.strategy_name && (
                        <FieldRow label="Strategy"><Input value={cfg.strategy_name} readOnly className="opacity-70 cursor-default" /></FieldRow>
                      )}
                      {entries.length > 0 && (
                        <FieldRow label="Strategy parameters">
                          <div className="flex flex-wrap gap-1.5">
                            {entries.map(([k, v]) => (
                              <span key={k} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-mono">
                                <span className="text-muted-foreground">{k}</span>=<span>{String(v)}</span>
                              </span>
                            ))}
                          </div>
                        </FieldRow>
                      )}
                    </>
                  )
                })()}
              </TabsContent>

              <TabsContent value="analysis" className="max-w-4xl mt-6 pl-[2px] pb-8">
                <SimAnalysis sim={selectedSim} />
              </TabsContent>

              <TabsContent value="modelfit" className="mt-6 pl-[2px] pb-8">
                <ModelFit sim={selectedSim} />
              </TabsContent>

              <TabsContent value="predictions" className="mt-6 pl-[2px] pb-8 overflow-x-auto">
                {selectedSim.status === "success" || selectedSim.status === "stopped" ? (
                  <PredictionsTable simId={selectedSim.id} isKline={selectedSim.strategy === "kline"} />
                ) : (
                  <p className="text-sm text-muted-foreground py-8">Predictions will be available once the simulation completes.</p>
                )}
              </TabsContent>

              <TabsContent value="backtest" className="mt-6 pl-[2px] pb-8 overflow-x-auto">
                {selectedSim.status === "success" || selectedSim.status === "stopped" ? (
                  <BacktestTab sim={selectedSim} />
                ) : (
                  <p className="text-sm text-muted-foreground py-8">Backtest will be available once the simulation completes.</p>
                )}
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="actions" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <div className="rounded-md border border-destructive/30 p-4 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-destructive">Delete simulation</p>
                    <p className="text-xs text-muted-foreground">Permanently delete this simulation and all of its predictions. This action cannot be undone.</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="shrink-0"
                    onClick={openSimDeleteDialog}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete simulation
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}
    </div>

    {/* ── Bulk Delete Confirmation Dialog ── */}
    <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive">Are you absolutely sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the {selectedIds.size} selected {selectedIds.size === 1 ? "simulation" : "simulations"} and remove {selectedIds.size === 1 ? "it" : "them"} from the system.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
            <Checkbox
              checked={deleteUnderstood}
              onCheckedChange={(v) => setDeleteUnderstood(!!v)}
              className="mt-0.5 shrink-0"
            />
            <span className="text-sm">I understand that this will permanently delete the selected simulations and all associated data.</span>
          </label>
          <FieldRow label='Type "delete" to confirm'>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="delete"
            />
          </FieldRow>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={!deleteUnderstood || deleteConfirmText !== "delete" || deleteMutation.isPending}
          >
            Delete {selectedIds.size} {selectedIds.size === 1 ? "simulation" : "simulations"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Single Simulation Delete Confirmation Dialog ── */}
    <Dialog open={simDeleteDialogOpen} onOpenChange={setSimDeleteDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive">Are you absolutely sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the simulation
            {selectedSim?.name ? <> &ldquo;<span className="font-medium">{selectedSim.name}</span>&rdquo;</> : null}
            {" "}and all of its predictions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
            <Checkbox
              checked={simDeleteUnderstood}
              onCheckedChange={(v) => setSimDeleteUnderstood(!!v)}
              className="mt-0.5 shrink-0"
            />
            <span className="text-sm">I understand that this will permanently delete this simulation and all associated data.</span>
          </label>
          <FieldRow label='Type "delete" to confirm'>
            <Input
              value={simDeleteConfirmText}
              onChange={(e) => setSimDeleteConfirmText(e.target.value)}
              placeholder="delete"
            />
          </FieldRow>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setSimDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleSimDelete}
            disabled={!simDeleteUnderstood || simDeleteConfirmText !== "delete" || deleteMutation.isPending}
          >
            Delete simulation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
