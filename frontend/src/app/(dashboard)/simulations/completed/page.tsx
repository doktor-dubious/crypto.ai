"use client"

import { useState, useMemo, useRef, useEffect, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { useCustomer } from "@/components/providers/customer-provider"
import { simulationsApi, customerConfigurationApi, type CompletedSimulationResponse, type ZeroShotResponse, type ModelFitOutlet, type ModelFitResponse, type FilteredOverviewResponse } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "simulation_from" | "created_at" | "status" | "starred"

type ScenarioColumn = "delivered" | "eo" | "predicted" | "upper_bound" | "lower_bound"
const SCENARIO_OPTIONS: { value: ScenarioColumn; label: string }[] = [
  { value: "delivered",   label: "Delivered" },
  { value: "eo",          label: "Economical Optimal" },
  { value: "predicted",   label: "Predicted" },
]

type WeekdayFilter = "all" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | "mon-fri" | "mon-sat"

const WEEKDAY_OPTIONS: { value: WeekdayFilter; label: string; days: number[] | null }[] = [
  { value: "all",     label: "All days",           days: null },
  { value: "mon",     label: "Monday",             days: [1] },
  { value: "tue",     label: "Tuesday",            days: [2] },
  { value: "wed",     label: "Wednesday",          days: [3] },
  { value: "thu",     label: "Thursday",           days: [4] },
  { value: "fri",     label: "Friday",             days: [5] },
  { value: "sat",     label: "Saturday",           days: [6] },
  { value: "sun",     label: "Sunday",             days: [7] },
  { value: "mon-fri", label: "Monday \u2013 Friday",  days: [1, 2, 3, 4, 5] },
  { value: "mon-sat", label: "Monday \u2013 Saturday", days: [1, 2, 3, 4, 5, 6] },
]

type SimStatus = "success" | "failure" | "revoked"

const STATUS_BADGE: Record<SimStatus, { variant: "success" | "destructive" | "warning"; label: string }> = {
  success: { variant: "success", label: "statusSuccess" },
  failure: { variant: "destructive", label: "statusFailure" },
  revoked: { variant: "warning", label: "statusRevoked" },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function countDays(from: string, to: string): number {
  const msPerDay = 86400000
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / msPerDay) + 1
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—"
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
}

function formatCurrency(n: number | null | undefined, symbol: string): string {
  if (n == null) return "—"
  return `${symbol}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
      <span className="text-sm font-medium">{value ?? "—"}</span>
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider pt-3 pb-1">
      {label}
    </p>
  )
}

// ─── Zero Shot table ──────────────────────────────────────────────────────────

function ZeroShotTable({ data }: { data: ZeroShotResponse }) {
  const rows: { name: string; count: number; muted?: boolean }[] = [
    { name: "0 (Perfect)",   count: data.zero_shot },
    { name: "+1",            count: data.zero_shot_plus_1 },
    { name: "-1",            count: data.zero_shot_minus_1 },
    { name: "+2",            count: data.zero_shot_plus_2 },
    { name: "-2",            count: data.zero_shot_minus_2 },
    { name: "+ mul",         count: data.zero_shot_plus_mul },
    { name: "- mul",         count: data.zero_shot_minus_mul },
    { name: "No sales data", count: data.no_actual_data, muted: true },
  ]
  const pct = (n: number) =>
    data.total > 0 ? `${((n / data.total) * 100).toFixed(1)}%` : "—"
  const fmt = (n: number) => n.toLocaleString()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Accuracy</TableHead>
          <TableHead className="text-right">Count</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell className={cn("font-medium", row.muted && "text-[var(--muted-foreground)]")}>{row.name}</TableCell>
            <TableCell className={cn("text-right tabular-nums", row.muted && "text-[var(--muted-foreground)]")}>
              {fmt(row.count)}
              <span className="ml-1.5 text-[var(--muted-foreground)] font-normal">({pct(row.count)})</span>
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2">
          <TableCell className="font-medium text-[var(--muted-foreground)]">Total</TableCell>
          <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">{fmt(data.total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

// ─── Overview components ──────────────────────────────────────────────────────

type TFunc = ReturnType<typeof useTranslations<"simulations.completed">>

interface OverviewSectionData {
  total_delivered: number | null
  total_sold: number | null
  total_returned: number | null
  diff_delivered: number | null
  lost_sale: number | null
  diff_return: number | null
  more_sale: number | null
  g1: number | null
  g2: number | null
  g3: number | null
  g4: number | null
}

function OverviewSection({ label, data, t, currencySymbol, actual }: {
  label: string
  data: OverviewSectionData
  t: TFunc
  currencySymbol: string
  actual?: { delivered: number | null; sold: number | null; returned: number | null } | null
}) {
  const thBase = "px-2 py-1.5 text-center text-[11px] font-medium text-[var(--muted-foreground)] border border-border/40 whitespace-nowrap"
  const tdBase = "px-2 py-1.5 text-center text-sm tabular-nums border border-border/40"
  const tdLabel = "px-2 py-1.5 text-left text-xs text-[var(--muted-foreground)] border border-border/40 whitespace-nowrap"

  const total = (data.g1 ?? 0) + (data.g2 ?? 0) + (data.g3 ?? 0) + (data.g4 ?? 0)
  const hasAny = data.g1 != null || data.g2 != null || data.g3 != null || data.g4 != null

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={cn(thBase, "text-left w-12")} />
            <th colSpan={3} className={cn(thBase, "bg-[var(--muted)]/40")}>{t("overviewUnits")}</th>
            <th colSpan={4} className={cn(thBase, "bg-[var(--muted)]/20")}>{t("overviewProfit")}</th>
          </tr>
          <tr>
            <th className={cn(thBase, "text-left")} />
            <th className={cn(thBase, "bg-[var(--muted)]/40")}>{t("overviewColDelivered")}</th>
            <th className={cn(thBase, "bg-[var(--muted)]/40")}>{t("overviewColSold")}</th>
            <th className={cn(thBase, "bg-[var(--muted)]/40")}>{t("overviewColReturned")}</th>
            <th className={cn(thBase, "bg-[var(--muted)]/20 max-w-[120px] whitespace-normal leading-tight")}>{t("overviewColG1")}</th>
            <th className={cn(thBase, "bg-[var(--muted)]/20 max-w-[120px] whitespace-normal leading-tight")}>{t("overviewColG2")}</th>
            <th className={cn(thBase, "bg-[var(--muted)]/20 max-w-[120px] whitespace-normal leading-tight")}>{t("overviewColG3")}</th>
            <th className={cn(thBase, "bg-[var(--muted)]/20 max-w-[120px] whitespace-normal leading-tight")}>{t("overviewColG4")}</th>
          </tr>
        </thead>
        <tbody>
          {actual && (
            <tr>
              <td className={tdLabel}>{t("overviewRowActual")}</td>
              <td className={tdBase}>{formatNumber(actual.delivered)}</td>
              <td className={tdBase}>{formatNumber(actual.sold)}</td>
              <td className={tdBase}>{formatNumber(actual.returned)}</td>
              <td className={tdBase} />
              <td className={tdBase} />
              <td className={tdBase} />
              <td className={tdBase} />
            </tr>
          )}
          <tr>
            <td className={tdLabel}>{t("overviewRowTotal")}</td>
            <td className={tdBase}>{formatNumber(data.total_delivered)}</td>
            <td className={tdBase}>{formatNumber(data.total_sold)}</td>
            <td className={tdBase}>{formatNumber(data.total_returned)}</td>
            <td className={cn(tdBase, data.g1 != null && data.g1 < 0 && "text-red-500")}>{formatCurrency(data.g1, currencySymbol)}</td>
            <td className={cn(tdBase, data.g2 != null && data.g2 < 0 && "text-red-500")}>{formatCurrency(data.g2, currencySymbol)}</td>
            <td className={cn(tdBase, data.g3 != null && data.g3 < 0 && "text-red-500")}>{formatCurrency(data.g3, currencySymbol)}</td>
            <td className={cn(tdBase, data.g4 != null && data.g4 < 0 && "text-red-500")}>{formatCurrency(data.g4, currencySymbol)}</td>
          </tr>
          <tr>
            <td className={tdLabel}>{t("overviewRowDelta")}</td>
            <td className={tdBase}>{formatNumber(data.diff_delivered)}</td>
            <td className={cn(tdBase, "text-red-500 font-medium")}>{formatNumber(data.lost_sale)}</td>
            <td className={tdBase}>{formatNumber(data.diff_return)}</td>
            <td className={tdBase} />
            <td className={tdBase} />
            <td className={tdBase} />
            <td className={tdBase} />
          </tr>
          <tr>
            <td className={tdLabel}>{t("overviewRowDelta")}</td>
            <td className={tdBase} />
            <td className={tdBase}>{formatNumber(data.more_sale)}</td>
            <td className={tdBase} />
            <td className={tdBase} />
            <td className={tdBase} />
            <td className={tdBase} />
            <td className={tdBase} />
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border/60">
            <td colSpan={4} className={cn(tdLabel, "text-right font-semibold border-t-2 border-border/60")}>
              {t("overviewRowResult")}
            </td>
            <td colSpan={4} className={cn(tdBase, "text-right font-semibold border-t-2 border-border/60", hasAny && total < 0 && "text-red-500")}>
              {hasAny ? formatCurrency(total, currencySymbol) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── Model Fit ────────────────────────────────────────────────────────────────

type ModelFitSeriesKey = "delivered" | "eo" | "predicted" | "upper_bound" | "lower_bound"

const MODEL_FIT_SERIES: { key: ModelFitSeriesKey; label: string; color: string }[] = [
  { key: "delivered",   label: "Delivered",          color: "hsl(var(--chart-2, 160 60% 45%))" },
  { key: "eo",          label: "Economical Optimal",  color: "hsl(var(--chart-3, 30 80% 55%))"  },
  { key: "predicted",   label: "Predicted",           color: "hsl(var(--chart-4, 280 65% 60%))" },
  { key: "upper_bound", label: "Upper Bound",         color: "hsl(var(--chart-5, 0 72% 51%))"   },
  { key: "lower_bound", label: "Lower Bound",         color: "hsl(var(--chart-6, 200 70% 50%))" },
]

const MODEL_FIT_CHART_CONFIG: ChartConfig = {
  actual_sale: { label: "Actual Sale", color: "hsl(var(--chart-1, 220 70% 50%))" },
  ...Object.fromEntries(MODEL_FIT_SERIES.map((s) => [s.key, { label: s.label, color: s.color }])),
}

const OUTLET_PAGE_SIZE = 10

function ModelFitSeriesCombobox({
  value,
  onChange,
}: {
  value: Set<ModelFitSeriesKey>
  onChange: (v: Set<ModelFitSeriesKey>) => void
}) {
  function toggle(key: ModelFitSeriesKey) {
    const next = new Set(value)
    next.has(key) ? next.delete(key) : next.add(key)
    onChange(next)
  }

  const label = value.size === 0
    ? "No series"
    : value.size === MODEL_FIT_SERIES.length
    ? "All series"
    : MODEL_FIT_SERIES.filter((s) => value.has(s.key)).map((s) => s.label).join(", ")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-8 max-w-56 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer flex items-center gap-2 truncate">
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {MODEL_FIT_SERIES.map((s) => (
          <DropdownMenuItem key={s.key} onSelect={(e) => { e.preventDefault(); toggle(s.key) }} className="flex items-center gap-2 cursor-pointer">
            <div
              className={cn(
                "h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0",
                value.has(s.key) ? "border-transparent" : "border-input"
              )}
              style={value.has(s.key) ? { backgroundColor: s.color } : undefined}
            >
              {value.has(s.key) && <span className="text-white text-[10px] leading-none">✓</span>}
            </div>
            {s.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ModelFitTab({ simulationId, simFrom, simTo, weekdays, weekdayFilter, onWeekdayChange }: {
  simulationId: string
  simFrom: string | null
  simTo: string | null
  weekdays: number[] | null
  weekdayFilter: WeekdayFilter
  onWeekdayChange: (v: WeekdayFilter) => void
}) {
  const [fromDate, setFromDate] = useState(simFrom ?? "")
  const [toDate, setToDate]     = useState(simTo ?? "")
  const [selectedSeries, setSelectedSeries] = useState<Set<ModelFitSeriesKey>>(new Set(["delivered"]))
  const [outletSearch, setOutletSearch] = useState("")
  const [outletPage, setOutletPage]     = useState(1)
  const [selectedOutletIds, setSelectedOutletIds] = useState<Set<string>>(new Set())
  const [allSelected, setAllSelected] = useState(true)

  // Fetch the base data (all outlets, full date range) to get the outlet list
  const { data: baseData } = useQuery({
    queryKey: ["simulation-model-fit-base", simulationId],
    queryFn: () => simulationsApi.getModelFit(simulationId),
    staleTime: 5 * 60_000,
  })

  const outlets: ModelFitOutlet[] = baseData?.outlets ?? []

  // Filtered + paginated outlet list
  const filteredOutlets = useMemo(() => {
    const q = outletSearch.toLowerCase()
    return outlets.filter((o) => !q || o.name.toLowerCase().includes(q))
  }, [outlets, outletSearch])
  const outletTotalPages = Math.max(1, Math.ceil(filteredOutlets.length / OUTLET_PAGE_SIZE))
  const safePage = Math.min(outletPage, outletTotalPages)
  const pagedOutlets = filteredOutlets.slice((safePage - 1) * OUTLET_PAGE_SIZE, safePage * OUTLET_PAGE_SIZE)

  // Active filter params
  const activeOutletIds = allSelected ? undefined : Array.from(selectedOutletIds)
  const activeFrom = fromDate || undefined
  const activeTo   = toDate   || undefined

  const { data: fitData, isLoading } = useQuery({
    queryKey: ["simulation-model-fit", simulationId, activeOutletIds, activeFrom, activeTo, weekdays],
    queryFn: () => simulationsApi.getModelFit(simulationId, {
      outletIds: activeOutletIds,
      fromDate: activeFrom,
      toDate: activeTo,
      weekdays: weekdays ?? undefined,
    }),
    staleTime: 30_000,
  })

  const chartData = (fitData ?? baseData)?.data ?? []

  function toggleOutlet(id: string) {
    setAllSelected(false)
    setSelectedOutletIds((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function handleSelectAll() {
    setAllSelected(true)
    setSelectedOutletIds(new Set())
  }

  const xFormatter = (v: string) => {
    const d = new Date(v)
    return `${d.getDate()}/${d.getMonth() + 1}`
  }

  return (
    <div className="flex gap-4 h-full">
      {/* ── Left: outlet selector ── */}
      <div className="w-52 shrink-0 flex flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Filter outlets…"
            value={outletSearch}
            onChange={(e) => { setOutletSearch(e.target.value); setOutletPage(1) }}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto border rounded-md divide-y divide-border/40 text-xs">
          {/* All row */}
          <button
            onClick={handleSelectAll}
            className={cn(
              "w-full text-left px-3 py-1.5 hover:bg-[var(--muted)]/40 transition-colors flex items-center gap-2",
              allSelected && "bg-[var(--muted)]/60 font-medium"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full shrink-0", allSelected ? "bg-primary" : "bg-transparent border border-border")} />
            All outlets
          </button>
          {pagedOutlets.map((o) => {
            const sel = !allSelected && selectedOutletIds.has(o.id)
            return (
              <button
                key={o.id}
                onClick={() => toggleOutlet(o.id)}
                className={cn(
                  "w-full text-left px-3 py-1.5 hover:bg-[var(--muted)]/40 transition-colors flex items-center gap-2 truncate",
                  sel && "bg-[var(--muted)]/60"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", sel ? "bg-primary" : "bg-transparent border border-border")} />
                <span className="truncate">{o.name}</span>
              </button>
            )
          })}
        </div>
        {outletTotalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <button onClick={() => setOutletPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="hover:text-foreground disabled:opacity-30">‹</button>
            <span>{safePage} / {outletTotalPages}</span>
            <button onClick={() => setOutletPage((p) => Math.min(outletTotalPages, p + 1))} disabled={safePage === outletTotalPages} className="hover:text-foreground disabled:opacity-30">›</button>
          </div>
        )}
      </div>

      {/* ── Right: date range + chart ── */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <label className="shrink-0">From</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-7 w-36 text-xs" />
            <label className="shrink-0">To</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-7 w-36 text-xs" />
            {(fromDate || toDate) && (
              <button onClick={() => { setFromDate(simFrom ?? ""); setToDate(simTo ?? "") }} className="text-xs text-[var(--muted-foreground)] hover:text-foreground underline">Reset</button>
            )}
          </div>
          <ModelFitSeriesCombobox value={selectedSeries} onChange={setSelectedSeries} />
          <WeekdayCombobox value={weekdayFilter} onChange={onWeekdayChange} />
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">No data</div>
        ) : (
          <ChartContainer config={MODEL_FIT_CHART_CONFIG} className="flex-1 min-h-0">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
              <XAxis dataKey="date" tickFormatter={xFormatter} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="actual_sale"
                name="Actual Sale"
                stroke="var(--color-actual_sale)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              {MODEL_FIT_SERIES.filter((s) => selectedSeries.has(s.key)).map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </div>
    </div>
  )
}

// ─── Scenario combobox ────────────────────────────────────────────────────────

function ScenarioCombobox({ value, onChange, className }: { value: ScenarioColumn; onChange: (v: ScenarioColumn) => void; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ScenarioColumn)}
      className={cn("h-8 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer", className)}
    >
      {SCENARIO_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function WeekdayCombobox({ value, onChange, className }: { value: WeekdayFilter; onChange: (v: WeekdayFilter) => void; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as WeekdayFilter)}
      className={cn("h-8 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer", className)}
    >
      {WEEKDAY_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function scenarioOverviewData(sim: CompletedSimulationResponse, scenario: ScenarioColumn): OverviewSectionData | null {
  switch (scenario) {
    case "delivered":
      if (sim.d_total_delivered == null) return null
      return {
        total_delivered: sim.d_total_delivered, total_sold: sim.d_total_sold, total_returned: sim.d_total_returned,
        diff_delivered: sim.d_diff_delivered, lost_sale: sim.d_lost_sale, diff_return: sim.d_diff_return,
        more_sale: sim.d_more_sale, g1: sim.d_g1, g2: sim.d_g2, g3: sim.d_g3, g4: sim.d_g4,
      }
    case "eo":
      if (sim.eo_total_delivered == null) return null
      return {
        total_delivered: sim.eo_total_delivered, total_sold: sim.eo_total_sold, total_returned: sim.eo_total_returned,
        diff_delivered: sim.eo_diff_delivered, lost_sale: sim.eo_lost_sale, diff_return: sim.eo_diff_return,
        more_sale: sim.eo_more_sale, g1: sim.eo_g1, g2: sim.eo_g2, g3: sim.eo_g3, g4: sim.eo_g4,
      }
    case "predicted":
      if (sim.p_total_delivered == null) return null
      return {
        total_delivered: sim.p_total_delivered, total_sold: sim.p_total_sold, total_returned: sim.p_total_returned,
        diff_delivered: sim.p_diff_delivered, lost_sale: sim.p_lost_sale, diff_return: sim.p_diff_return,
        more_sale: sim.p_more_sale, g1: sim.p_g1, g2: sim.p_g2, g3: sim.p_g3, g4: sim.p_g4,
      }
    default:
      return null
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SimulationsCompletedPage() {
  const t = useTranslations("simulations.completed")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const deepLinkTaskId = searchParams.get("task_id")

  // ── Table state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state
  const [selected, setSelected] = useState<CompletedSimulationResponse | null>(null)
  const [activeTab, setActiveTab] = useState("tab1")
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Scenario selector (shared between Overview and Zero Shot tabs)
  const [scenario, setScenario] = useState<ScenarioColumn>("delivered")

  // ── Weekday filter (shared between Overview, Zero Shot, and Model Fit tabs)
  const [weekday, setWeekday] = useState<WeekdayFilter>("all")
  const weekdayDays = WEEKDAY_OPTIONS.find((o) => o.value === weekday)?.days ?? null

  // ── Delete dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: listData, isLoading } = useQuery({
    queryKey: ["simulations-completed", activeCustomer?.id],
    queryFn: () => simulationsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  const { data: customerConfig } = useQuery({
    queryKey: ["customer-configuration", activeCustomer?.id],
    queryFn: () => customerConfigurationApi.get(activeCustomer!.id),
    enabled: !!activeCustomer,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const currencySymbol = customerConfig?.currency_symbol ?? ""

  const { data: zeroShot, isLoading: zeroShotLoading } = useQuery({
    queryKey: ["simulation-zero-shot", selected?.simulation_id, scenario, weekday],
    queryFn: () => simulationsApi.getZeroShot(selected!.simulation_id!, scenario, weekdayDays ?? undefined),
    enabled: !!selected?.simulation_id && activeTab === "tab4",
    retry: false,
  })

  const { data: overviewFiltered } = useQuery({
    queryKey: ["simulation-overview-filtered", selected?.simulation_id, scenario, weekday],
    queryFn: () => simulationsApi.getOverview(selected!.simulation_id!, scenario, weekdayDays ?? undefined),
    enabled: !!selected?.simulation_id && activeTab === "tab2" && weekdayDays != null,
    staleTime: 30_000,
  })

  const simulations = listData?.items ?? []

  // ── Deep-link: select and focus simulation from task_id query param ──────
  const handledTaskIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!deepLinkTaskId || simulations.length === 0) return
    if (handledTaskIdRef.current === deepLinkTaskId) return
    const match = simulations.find((s) => s.task_id === deepLinkTaskId)
    if (!match) return
    setSelected(match)
    setSelectedIds(new Set([match.id]))
    setShowOnlySelected(true)
    setActiveTab(match.status === "failure" ? "tab0" : "tab1")
    handledTaskIdRef.current = deepLinkTaskId
  }, [deepLinkTaskId, simulations])

  // ── Mutations ─────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (recordId: string) => simulationsApi.deleteByRecordId(recordId),
    onSuccess: (_, recordId) => {
      queryClient.invalidateQueries({ queryKey: ["simulations-completed"] })
      if (selected?.id === recordId) setSelected(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(recordId); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  // ── Tab indicator ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selected])

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? simulations.filter((s) => selectedIds.has(s.id))
      : simulations

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (s) => s.name?.toLowerCase().includes(q) ||
               s.engine?.toLowerCase().includes(q) ||
               (s.simulation_from ?? "").includes(q) ||
               (s.simulation_to ?? "").includes(q)
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name":            va = a.name ?? "";            vb = b.name ?? "";            break
        case "simulation_from": va = a.simulation_from ?? ""; vb = b.simulation_from ?? ""; break
        case "created_at":      va = a.created_at;            vb = b.created_at;            break
        case "status":          va = a.status;                vb = b.status;                break
        case "starred":         va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [simulations, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((s) => selectedIds.has(s.id))
  const somePageSelected = pageItems.some((s) => selectedIds.has(s.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((s) => n.delete(s.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((s) => n.add(s.id)); return n })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function openDeleteDialog() {
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!selected) return
    await deleteMutation.mutateAsync(selected.id)
    setDeleteDialogOpen(false)
    setSelected(null)
  }

  function openBulkDeleteDialog() {
    setBulkDeleteUnderstood(false)
    setBulkDeleteConfirmText("")
    setBulkDeleteDialogOpen(true)
  }

  async function handleBulkDelete() {
    const recordIds = simulations
      .filter((s) => selectedIds.has(s.id))
      .map((s) => s.id)
    for (const id of recordIds) await deleteMutation.mutateAsync(id)
    setSelectedIds(new Set())
    setBulkDeleteDialogOpen(false)
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 font-medium hover:text-foreground transition-colors text-left"
      >
        {label}
        {active
          ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className="flex flex-col shrink-0">
        {/* Toolbar */}
        <div className="flex items-center justify-end px-4 py-2 shrink-0 bg-background">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }}
              className="h-7 pl-8 w-52 text-xs"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-y-auto max-h-[45vh]">
          {isLoading || !activeCustomer ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--muted-foreground)]">
              <p className="text-sm">{t("noSimulations")}</p>
              <p className="text-xs opacity-60">{t("noSimulationsHint")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-4">
                    <div className="flex items-center gap-0.5">
                      <Checkbox
                        checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                        onCheckedChange={handleHeaderCheckbox}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors cursor-pointer">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(simulations.map((s) => s.id)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(simulations.filter((s) => s.status === "success").map((s) => s.id)))}>
                            {t("selectCompleted")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(simulations.filter((s) => s.status === "revoked").map((s) => s.id)))}>
                            {t("selectCancelled")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(simulations.filter((s) => s.status === "failure").map((s) => s.id)))}>
                            {t("selectFailed")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setSelectedIds(new Set(simulations.filter((s) => starredIds.has(s.id)).map((s) => s.id)))}
                          >
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="simulation_from" label={t("colPeriod")} /></TableHead>
                  <TableHead><SortHeader field="created_at" label={t("colRunDate")} /></TableHead>
                  <TableHead><SortHeader field="status" label={t("colStatus")} /></TableHead>
                  <TableHead className="w-10 text-center">
                    <button
                      onClick={() => handleSort("starred")}
                      className="flex items-center gap-1 font-medium hover:text-foreground transition-colors cursor-pointer"
                    >
                      <Star className={cn("h-4 w-4", sortField === "starred" ? "" : "opacity-40")} />
                      {sortField === "starred" && (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((sim) => (
                  <TableRow
                    key={sim.id}
                    data-state={selected?.id === sim.id ? "selected" : undefined}
                    onClick={() => { setSelected(sim); setActiveTab(sim.status === "failure" ? "tab0" : "tab1") }}
                    onContextMenu={(e) => { e.preventDefault(); handleStar(sim.id) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(sim.id)}
                        onCheckedChange={(c) => setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(sim.id) : n.delete(sim.id); return n })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {sim.name ?? <span className="text-[var(--muted-foreground)] italic">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)]">
                      {sim.simulation_from && sim.simulation_to
                        ? `${formatDate(sim.simulation_from)} – ${formatDate(sim.simulation_to)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)]">{formatDateTime(sim.created_at)}</TableCell>
                    <TableCell>
                      {(() => {
                        const s = STATUS_BADGE[sim.status as SimStatus]
                        return s ? <Badge variant={s.variant} className="text-xs">{t(s.label as Parameters<typeof t>[0])}</Badge> : null
                      })()}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleStar(sim.id)} className="hover:text-amber-400 transition-colors cursor-pointer" aria-label="Toggle star">
                        <Star className={cn("h-4 w-4", starredIds.has(sim.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination + selection bar */}
        <div className="shrink-0 border-t bg-background mt-4">
          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-1.5">
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("showing", {
                  from: (safePage - 1) * ITEMS_PER_PAGE + 1,
                  to: Math.min(safePage * ITEMS_PER_PAGE, filtered.length),
                  total: filtered.length,
                })}
              </span>
              {totalPages > 1 && (
                <Pagination className="w-auto mx-0">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} />
                    </PaginationItem>
                    {buildPaginationPages(safePage, totalPages).map((p, i) =>
                      p === "ellipsis" ? (
                        <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink isActive={safePage === p} onClick={() => setCurrentPage(p)}>{p}</PaginationLink>
                        </PaginationItem>
                      )
                    )}
                    <PaginationItem>
                      <PaginationNext onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-[var(--muted)]/30">
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("selectedCount", { selected: selectedIds.size, total: filtered.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1.5 px-2 cursor-pointer"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  title={showOnlySelected ? "Show all" : "Show only selected"}
                >
                  <Focus className={cn("h-3.5 w-3.5", showOnlySelected && "text-primary")} />
                  {showOnlySelected && <span className="text-xs">Show all</span>}
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                  onClick={openBulkDeleteDialog}
                  title="Delete selected"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail pane ── */}
      {selected && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-t">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
            <div className="relative w-full">
              <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                {selected.status === "failure" && (
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 text-destructive data-[state=active]:text-destructive" value="tab0">{t("tabError")}</TabsTrigger>
                )}
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabStats")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabZeroShot")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab5">{t("tabModelFit")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabActions")}</TabsTrigger>
              </TabsList>
              <div
                className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
              />
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ─ Error ─ */}
              {selected.status === "failure" && (
                <TabsContent value="tab0" className="max-w-2xl mt-6 px-4">
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-xs font-semibold text-destructive mb-2">{t("tabError")}</p>
                    <p className="text-xs text-[var(--muted-foreground)] font-mono whitespace-pre-wrap break-all">
                      {selected.error ?? "No error message available."}
                    </p>
                  </div>
                </TabsContent>
              )}

              {/* ─ Details ─ */}
              <TabsContent value="tab1" className="space-y-3 max-w-2xl mt-6 px-4">
                <StatRow label="ID" value={<span className="font-mono text-xs opacity-70">{selected.simulation_id ?? selected.id}</span>} />
                <StatRow label={t("fieldName")} value={selected.name ?? "—"} />
                <StatRow label={t("fieldDescription")} value={selected.description ?? "—"} />
                <StatRow label={t("fieldGroup")} value={selected.outlet_group_name ?? "—"} />
                <StatRow
                  label={t("fieldSimulationType")}
                  value={
                    selected.engine === "same_draw" ? "Same Draw"
                    : selected.engine === "same_sale" ? "Same Sale"
                    : "Prediction Strategy"
                  }
                />
                <StatRow label={t("fieldPredictionStrategy")} value={selected.prediction_strategy_name ?? "—"} />
                <StatRow
                  label={t("fieldPeriod")}
                  value={
                    selected.simulation_from && selected.simulation_to
                      ? `${formatDate(selected.simulation_from)} – ${formatDate(selected.simulation_to)} (${countDays(selected.simulation_from, selected.simulation_to)} days)`
                      : "—"
                  }
                />
                <StatRow
                  label={t("fieldExecutionPeriod")}
                  value={
                    selected.started_at && selected.ended_at
                      ? `${formatDateTime(selected.started_at)} – ${formatDateTime(selected.ended_at)} (${formatDuration(selected.started_at, selected.ended_at)})`
                      : selected.started_at
                      ? formatDateTime(selected.started_at)
                      : "—"
                  }
                />
                <StatRow label={t("fieldEngine")} value={selected.engine ?? "—"} />
                <StatRow label={t("fieldDelay")} value={selected.delay != null ? `${selected.delay} days` : "—"} />
                <StatRow label={t("fieldOutlets")} value={selected.outlet_count} />
              </TabsContent>

              {/* ─ Overview ─ */}
              <TabsContent value="tab2" className="mt-6 px-4">
                {selected.status !== "success" ? (
                  <div className="text-sm text-[var(--muted-foreground)] italic">
                    Stats are only available for completed simulations.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ScenarioCombobox value={scenario} onChange={setScenario} />
                      <WeekdayCombobox value={weekday} onChange={setWeekday} />
                    </div>
                    {weekdayDays != null ? (
                      !overviewFiltered ? (
                        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
                      ) : (
                        <OverviewSection
                          label={SCENARIO_OPTIONS.find((o) => o.value === scenario)?.label ?? ""}
                          t={t}
                          currencySymbol={currencySymbol}
                          data={overviewFiltered}
                          actual={overviewFiltered.actual_total_sale != null ? {
                            delivered: overviewFiltered.actual_total_delivered,
                            sold: overviewFiltered.actual_total_sale,
                            returned: overviewFiltered.actual_total_returned,
                          } : null}
                        />
                      )
                    ) : (
                      (() => {
                        const overviewData = scenarioOverviewData(selected, scenario)
                        if (!overviewData) return (
                          <div className="text-sm text-[var(--muted-foreground)] italic">
                            No data available for this scenario.
                          </div>
                        )
                        return (
                          <OverviewSection
                            label={SCENARIO_OPTIONS.find((o) => o.value === scenario)?.label ?? ""}
                            t={t}
                            currencySymbol={currencySymbol}
                            data={overviewData}
                            actual={selected.actual_total_sale != null ? {
                              delivered: selected.actual_total_delivered,
                              sold: selected.actual_total_sale,
                              returned: selected.actual_total_returned,
                            } : null}
                          />
                        )
                      })()
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ─ Zero Shot ─ */}
              <TabsContent value="tab4" className="mt-6 px-4">
                <div className="space-y-4 w-fit min-w-0">
                  <div className="flex items-center gap-2 w-full">
                    <ScenarioCombobox value={scenario} onChange={setScenario} className="flex-1" />
                    <WeekdayCombobox value={weekday} onChange={setWeekday} className="flex-1" />
                  </div>
                  {!selected.simulation_id ? (
                    <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)] italic">No data</div>
                  ) : zeroShotLoading ? (
                    <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">Loading…</div>
                  ) : !zeroShot ? (
                    <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">No data</div>
                  ) : (
                    <ZeroShotTable data={zeroShot} />
                  )}
                </div>
              </TabsContent>

              {/* ─ Model Fit ─ */}
              <TabsContent value="tab5" className="mt-4 px-4 h-full">
                {!selected.simulation_id ? (
                  <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)] italic">No data</div>
                ) : (
                  <ModelFitTab
                    simulationId={selected.simulation_id}
                    simFrom={selected.simulation_from}
                    simTo={selected.simulation_to}
                    weekdays={weekdayDays}
                    weekdayFilter={weekday}
                    onWeekdayChange={setWeekday}
                  />
                )}
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="tab3" className="max-w-2xl mt-6 px-4">
                <div className="rounded-md border border-destructive/30 p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-destructive">{t("deleteButton")}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{t("deleteZoneDescription")}</p>
                  </div>
                  <Button variant="destructive" size="sm" className="shrink-0 cursor-pointer" onClick={openDeleteDialog}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    {t("deleteButton")}
                  </Button>
                </div>
              </TabsContent>

            </div>
          </Tabs>
        </div>
      )}

      {/* ── Single delete dialog ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteAbsoluteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteAbsoluteDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("deleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm")}</label>
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteDialogOpen(false)}>{t("deleteCancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={handleDelete}
              disabled={!deleteUnderstood || deleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
            >
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete dialog ── */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("bulkDeleteTitle", { count: selectedIds.size })}</DialogTitle>
            <DialogDescription>{t("bulkDeleteDescription", { count: selectedIds.size })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={bulkDeleteUnderstood} onCheckedChange={(v) => setBulkDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("bulkDeleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm")}</label>
              <Input value={bulkDeleteConfirmText} onChange={(e) => setBulkDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)}>{t("deleteCancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={handleBulkDelete}
              disabled={!bulkDeleteUnderstood || bulkDeleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
            >
              {t("bulkDeleteConfirm", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
