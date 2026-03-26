"use client"

import { useState, useMemo, useRef, useEffect, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp, Info, CalendarIcon, RotateCcw, Globe,
} from "lucide-react"
import { format } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
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
import { simulationsApi, customerConfigurationApi, outletGroupsApi, type CompletedSimulationResponse, type ZeroShotResponse, type ModelFitOutlet, type ModelFitResponse, type FilteredOverviewResponse, type AccuracyStatsResponse, type DataDumpRow, type DataDumpResponse } from "@/lib/api"
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ComposedChart, LineChart, Line, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts"

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

type SimStatus = "success" | "failure" | "revoked" | "continued"

const STATUS_BADGE: Record<SimStatus, { variant: "success" | "destructive" | "warning" | "muted"; label: string }> = {
  success: { variant: "success", label: "statusSuccess" },
  failure: { variant: "destructive", label: "statusFailure" },
  revoked: { variant: "warning", label: "statusRevoked" },
  continued: { variant: "muted", label: "statusContinued" },
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
  const withData = data.total - data.no_actual_data
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
  const within1 = data.zero_shot + data.zero_shot_plus_1 + data.zero_shot_minus_1
  const within2 = within1 + data.zero_shot_plus_2 + data.zero_shot_minus_2
  const pct = (n: number) =>
    withData > 0 ? `${((n / withData) * 100).toFixed(1)}%` : "—"
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
              {!row.muted && <span className="ml-1.5 text-[var(--muted-foreground)] font-normal">({pct(row.count)})</span>}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 bg-[var(--muted)]/20">
          <TableCell className="font-medium">Within ±1</TableCell>
          <TableCell className="text-right tabular-nums">
            {fmt(within1)}
            <span className="ml-1.5 text-[var(--muted-foreground)] font-normal">({pct(within1)})</span>
          </TableCell>
        </TableRow>
        <TableRow className="bg-[var(--muted)]/20">
          <TableCell className="font-medium">Within ±2</TableCell>
          <TableCell className="text-right tabular-nums">
            {fmt(within2)}
            <span className="ml-1.5 text-[var(--muted-foreground)] font-normal">({pct(within2)})</span>
          </TableCell>
        </TableRow>
        <TableRow className="border-t-2">
          <TableCell className="font-medium text-[var(--muted-foreground)]">Total</TableCell>
          <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">
            {fmt(withData)}
            {data.no_actual_data > 0 && (
              <span className="ml-1.5 font-normal text-xs">({fmt(data.no_actual_data)} excl.)</span>
            )}
          </TableCell>
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

function OverviewSection({ label, data, t, currencySymbol, actual, pct }: {
  label: string
  data: OverviewSectionData
  t: TFunc
  currencySymbol: string
  actual?: { delivered: number | null; sold: number | null; returned: number | null } | null
  pct?: { sold_out_pct: number | null; actual_sold_out_pct: number | null; default_cost: number | null; default_profit: number | null } | null
}) {
  const thBase = "px-2 py-1.5 text-center text-[11px] font-medium text-[var(--muted-foreground)] border border-border/40 whitespace-nowrap"
  const tdBase = "px-2 py-1.5 text-center text-sm tabular-nums border border-border/40"
  const tdLabel = "px-2 py-1.5 text-left text-xs text-[var(--muted-foreground)] border border-border/40 whitespace-nowrap"

  const total = (data.g1 ?? 0) + (data.g2 ?? 0) + (data.g3 ?? 0) + (data.g4 ?? 0)
  const hasAny = data.g1 != null || data.g2 != null || data.g3 != null || data.g4 != null

  const returnRate = data.total_delivered && data.total_delivered > 0
    ? ((data.total_returned ?? 0) / data.total_delivered * 100).toFixed(1)
    : null
  const sellThrough = data.total_delivered && data.total_delivered > 0
    ? ((data.total_sold ?? 0) / data.total_delivered * 100).toFixed(1)
    : null
  const actualReturnRate = actual?.delivered && actual.delivered > 0
    ? ((actual.returned ?? 0) / actual.delivered * 100).toFixed(1)
    : null
  const actualSellThrough = actual?.delivered && actual.delivered > 0
    ? ((actual.sold ?? 0) / actual.delivered * 100).toFixed(1)
    : null
  const idealReturnRate = pct?.default_cost != null && pct?.default_profit != null && pct.default_profit > 0
    ? (pct.default_cost / pct.default_profit * 100).toFixed(1)
    : null

  const thInfo = (label: string, info: string) => (
    <span className="inline-flex items-center gap-0.5 justify-center">
      {label}
      <UiTooltip>
        <TooltipTrigger asChild>
          <Info className="h-3 w-3 text-muted-foreground cursor-help shrink-0" />
        </TooltipTrigger>
        <UiTooltipContent side="top" className="max-w-xs text-xs">
          {info}
        </UiTooltipContent>
      </UiTooltip>
    </span>
  )

  return (
    <div>
      <TooltipProvider delayDuration={200}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={cn(thBase, "text-left w-12")} />
                <th colSpan={3} className={cn(thBase, "bg-[var(--muted)]/40")}>{t("overviewUnits")}</th>
                <th colSpan={4} className={cn(thBase, "bg-[var(--muted)]/10")}>{t("overviewPct")}</th>
                <th colSpan={4} className={cn(thBase, "bg-[var(--muted)]/20")}>{t("overviewProfit")}</th>
              </tr>
              <tr>
                <th className={cn(thBase, "text-left")} />
                <th className={cn(thBase, "bg-[var(--muted)]/40")}>{t("overviewColDelivered")}</th>
                <th className={cn(thBase, "bg-[var(--muted)]/40")}>{t("overviewColSold")}</th>
                <th className={cn(thBase, "bg-[var(--muted)]/40")}>{t("overviewColReturned")}</th>
                <th className={cn(thBase, "bg-[var(--muted)]/10")}>{thInfo(t("overviewColSoldOut"), t("overviewColSoldOutInfo"))}</th>
                <th className={cn(thBase, "bg-[var(--muted)]/10")}>{thInfo(t("overviewSellThrough"), t("overviewSellThroughInfo"))}</th>
                <th className={cn(thBase, "bg-[var(--muted)]/10")}>{thInfo(t("overviewReturnRate"), t("overviewReturnRateInfo"))}</th>
                <th className={cn(thBase, "bg-[var(--muted)]/10")}>{thInfo(t("overviewColIdealReturn"), t("overviewColIdealReturnInfo"))}</th>
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
                  <td className={tdBase}>{pct?.actual_sold_out_pct != null ? `${pct.actual_sold_out_pct}%` : "—"}</td>
                  <td className={tdBase}>{actualSellThrough != null ? `${actualSellThrough}%` : "—"}</td>
                  <td className={tdBase}>{actualReturnRate != null ? `${actualReturnRate}%` : "—"}</td>
                  <td className={tdBase}>{idealReturnRate != null ? `${idealReturnRate}%` : "—"}</td>
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
                <td className={tdBase}>{pct?.sold_out_pct != null ? `${pct.sold_out_pct}%` : "—"}</td>
                <td className={tdBase}>{sellThrough != null ? `${sellThrough}%` : "—"}</td>
                <td className={tdBase}>{returnRate != null ? `${returnRate}%` : "—"}</td>
                <td className={tdBase}>{idealReturnRate != null ? `${idealReturnRate}%` : "—"}</td>
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
                <td className={tdBase} />
                <td className={tdBase} />
                <td className={tdBase} />
                <td className={tdBase} />
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border/60">
                <td colSpan={8} className={cn(tdLabel, "text-right font-semibold border-t-2 border-border/60")}>
                  {t("overviewRowResult")}
                </td>
                <td colSpan={4} className={cn(tdBase, "text-right font-semibold border-t-2 border-border/60", hasAny && total < 0 && "text-red-500")}>
                  {hasAny ? formatCurrency(total, currencySymbol) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </TooltipProvider>
    </div>
  )
}

// ─── Model Fit ────────────────────────────────────────────────────────────────

type ModelFitSeriesKey =
  | "delivered" | "eo" | "predicted" | "upper_bound" | "lower_bound"
  | "sim_sold" | "sim_returned" | "sim_profit"
  | "actual_delivered" | "actual_sold" | "actual_returned" | "actual_profit"
  | "diff_delivered" | "diff_sold" | "diff_returned" | "diff_profit"

type ModelFitSeriesGroup = { label: string; items: { key: ModelFitSeriesKey; label: string; color: string }[] }

const MODEL_FIT_SERIES_GROUPS: ModelFitSeriesGroup[] = [
  {
    label: "Simulation",
    items: [
      { key: "delivered",    label: "Delivered",          color: "hsl(var(--chart-2, 160 60% 45%))" },
      { key: "eo",           label: "Economical Optimal", color: "hsl(var(--chart-3, 30 80% 55%))"  },
      { key: "predicted",    label: "Predicted",          color: "hsl(var(--chart-4, 280 65% 60%))" },
      { key: "upper_bound",  label: "Upper Bound",        color: "hsl(var(--chart-5, 0 72% 51%))"   },
      { key: "lower_bound",  label: "Lower Bound",        color: "hsl(var(--chart-6, 200 70% 50%))" },
      { key: "sim_sold",     label: "Sold",               color: "hsl(140 50% 55%)" },
      { key: "sim_returned", label: "Returned",           color: "hsl(140 50% 70%)" },
      { key: "sim_profit",   label: "Profit",             color: "hsl(100 60% 40%)" },
    ],
  },
  {
    label: "Actual",
    items: [
      { key: "actual_delivered", label: "Actual Delivered", color: "hsl(220 60% 45%)" },
      { key: "actual_sold",      label: "Actual Sold",      color: "hsl(220 60% 60%)" },
      { key: "actual_returned",  label: "Actual Returned",  color: "hsl(220 60% 75%)" },
      { key: "actual_profit",    label: "Actual Profit",    color: "hsl(260 50% 55%)" },
    ],
  },
  {
    label: "Difference",
    items: [
      { key: "diff_delivered", label: "Diff Delivered", color: "hsl(35 90% 50%)" },
      { key: "diff_sold",     label: "Diff Sold",      color: "hsl(35 70% 60%)" },
      { key: "diff_returned", label: "Diff Returned",  color: "hsl(35 50% 70%)" },
      { key: "diff_profit",   label: "Diff Profit",    color: "hsl(15 80% 50%)" },
    ],
  },
]

const MODEL_FIT_ALL_SERIES = MODEL_FIT_SERIES_GROUPS.flatMap((g) => g.items)

const MODEL_FIT_CHART_CONFIG: ChartConfig = {
  actual_sale: { label: "Actual Sale", color: "hsl(var(--chart-1, 220 70% 50%))" },
  _zero: { label: "Zero", color: "hsl(var(--muted-foreground))" },
  ...Object.fromEntries(MODEL_FIT_ALL_SERIES.map((s) => [s.key, { label: s.label, color: s.color }])),
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
    : value.size === MODEL_FIT_ALL_SERIES.length
    ? "All series"
    : MODEL_FIT_ALL_SERIES.filter((s) => value.has(s.key)).map((s) => s.label).join(", ")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-8 max-w-56 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer flex items-center gap-2 truncate">
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto">
        <div className="flex divide-x divide-border">
          {MODEL_FIT_SERIES_GROUPS.map((group) => (
            <div key={group.label} className="min-w-[160px]">
              <div className="px-2 py-1.5 text-xs font-semibold text-[var(--muted-foreground)]">{group.label}</div>
              {group.items.map((s) => (
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
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatsInfoItem({ label, info, value }: { label: string; info: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[var(--muted-foreground)]">
      {label}
      <UiTooltip>
        <TooltipTrigger asChild>
          <Info className="h-3 w-3 text-muted-foreground cursor-help shrink-0" />
        </TooltipTrigger>
        <UiTooltipContent side="top" className="max-w-xs text-xs">
          {info}
        </UiTooltipContent>
      </UiTooltip>
      : <span className="font-medium text-foreground tabular-nums">{value}</span>
    </span>
  )
}

function ModelFitStatsBar({ stats, t }: { stats: AccuracyStatsResponse | undefined; t: TFunc }) {
  if (!stats || stats.mae == null) return null
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-4 text-xs border rounded-md px-3 py-1.5 bg-[var(--muted)]/20">
        <StatsInfoItem label={t("statsMAE")} info={t("statsMAEInfo")} value={stats.mae.toFixed(2)} />
        <StatsInfoItem label={t("statsRMSE")} info={t("statsRMSEInfo")} value={stats.rmse.toFixed(2)} />
        <StatsInfoItem label={t("statsBias")} info={t("statsBiasInfo")} value={(stats.bias >= 0 ? "+" : "") + stats.bias.toFixed(2)} />
        {stats.mape != null && (
          <StatsInfoItem label={t("statsMAPE")} info={t("statsMAPEInfo")} value={`${stats.mape.toFixed(1)}%`} />
        )}
        {stats.r_squared != null && (
          <StatsInfoItem label={t("statsR2")} info={t("statsR2Info")} value={stats.r_squared.toFixed(3)} />
        )}
        <StatsInfoItem label={t("statsN")} info={t("statsNInfo")} value={stats.count.toLocaleString()} />
      </div>
    </TooltipProvider>
  )
}

function ModelFitTab({ simulationId, simFrom, simTo, weekdays, weekdayFilter, onWeekdayChange, selectedOutletIds, setSelectedOutletIds, allSelected, setAllSelected }: {
  simulationId: string
  simFrom: string | null
  simTo: string | null
  weekdays: number[] | null
  weekdayFilter: WeekdayFilter
  onWeekdayChange: (v: WeekdayFilter) => void
  selectedOutletIds: Set<string>
  setSelectedOutletIds: React.Dispatch<React.SetStateAction<Set<string>>>
  allSelected: boolean
  setAllSelected: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const t = useTranslations("simulations.completed")
  const [fromDate, setFromDate] = useState(simFrom ?? "")
  const [toDate, setToDate]     = useState(simTo ?? "")
  const [selectedSeries, setSelectedSeries] = useState<Set<ModelFitSeriesKey>>(new Set(["delivered", "predicted", "actual_sold"]))
  const [outletSearch, setOutletSearch] = useState("")
  const [outletPage, setOutletPage]     = useState(1)

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

  // Derive accuracy stats scenario from selected series (first match wins)
  const statsScenario: ScenarioColumn = selectedSeries.has("delivered") ? "delivered"
    : selectedSeries.has("eo") ? "eo"
    : selectedSeries.has("predicted") ? "predicted"
    : "delivered"

  const { data: accuracyStats } = useQuery({
    queryKey: ["simulation-accuracy-stats", simulationId, statsScenario, weekdays],
    queryFn: () => simulationsApi.getAccuracyStats(simulationId, statsScenario, weekdays ?? undefined),
    staleTime: 60_000,
  })

  const rawChartData = (fitData ?? baseData)?.data ?? []

  // Whether to show confidence band
  const showBand = selectedSeries.has("upper_bound") && selectedSeries.has("lower_bound")

  // Whether any difference series is selected
  const showDiff = selectedSeries.has("diff_delivered") || selectedSeries.has("diff_sold") || selectedSeries.has("diff_returned") || selectedSeries.has("diff_profit")
  const diffKeys: Set<ModelFitSeriesKey> = useMemo(() => new Set(["diff_delivered", "diff_sold", "diff_returned", "diff_profit"]), [])
  const onlyDiffSelected = selectedSeries.size > 0 && [...selectedSeries].every((k) => diffKeys.has(k))

  // Add derived _band_base and _band_range for stacked area confidence band + difference series
  const chartData = useMemo(() => {
    if (!showBand && !showDiff && !onlyDiffSelected) return rawChartData
    return rawChartData.map((d) => ({
      ...d,
      ...(showBand ? {
        _band_base: d.lower_bound ?? 0,
        _band_range: d.upper_bound != null && d.lower_bound != null
          ? Math.max(0, d.upper_bound - d.lower_bound)
          : 0,
      } : {}),
      ...(showDiff ? {
        diff_delivered: d.delivered != null && d.actual_delivered != null ? d.delivered - d.actual_delivered : null,
        diff_sold: d.sim_sold != null && d.actual_sold != null ? d.sim_sold - d.actual_sold : null,
        diff_returned: d.sim_returned != null && d.actual_returned != null ? d.sim_returned - d.actual_returned : null,
        diff_profit: d.sim_profit != null && d.actual_profit != null ? d.sim_profit - d.actual_profit : null,
      } : {}),
      ...(onlyDiffSelected ? { _zero: 0 } : {}),
    }))
  }, [rawChartData, showBand, showDiff, onlyDiffSelected])

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

        <ModelFitStatsBar stats={accuracyStats} t={t} />

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">No data</div>
        ) : (
          <ChartContainer config={MODEL_FIT_CHART_CONFIG} className="flex-1 min-h-0">
            {(() => {
              const profitKeys: Set<ModelFitSeriesKey> = new Set(["sim_profit", "actual_profit", "diff_profit"])
              const showProfitAxis = !onlyDiffSelected && MODEL_FIT_ALL_SERIES.some((s) => profitKeys.has(s.key) && selectedSeries.has(s.key))
              const showBothProfits = selectedSeries.has("sim_profit") && selectedSeries.has("actual_profit")
              const profitLossMap = showBothProfits
                ? new Map(chartData.map((d) => [d.date, d.actual_profit != null && d.sim_profit != null && d.actual_profit > d.sim_profit]))
                : null
              return (
                <ComposedChart data={chartData} margin={{ top: 4, right: showProfitAxis ? 8 : 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis
                    dataKey="date"
                    tick={profitLossMap ? (props: { x: string | number; y: string | number; payload: { value: string } }) => {
                      const isLoss = profitLossMap.get(props.payload.value)
                      return (
                        <text x={props.x} y={Number(props.y) + 12} textAnchor="middle" fontSize={11} fill={isLoss ? "hsl(0 72% 51%)" : "currentColor"} fontWeight={isLoss ? 600 : 400}>
                          {xFormatter(props.payload.value)}
                        </text>
                      )
                    } : { fontSize: 11 }}
                    tickFormatter={profitLossMap ? undefined : xFormatter}
                  />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={40} />
                  {showProfitAxis && (
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={50} />
                  )}
                  <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => {
                    const key = MODEL_FIT_ALL_SERIES.find((s) => s.label === name)?.key
                    if (key && (profitKeys.has(key) || diffKeys.has(key)) && typeof value === "number") return value.toFixed(2)
                    return String(value)
                  }} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {showBand && (
                    <>
                      <Area
                        type="monotone"
                        dataKey="_band_base"
                        stackId="confidence"
                        stroke="none"
                        fill="transparent"
                        connectNulls
                        legendType="none"
                        name="_band_base"
                        isAnimationActive={false}
                        yAxisId="left"
                      />
                      <Area
                        type="monotone"
                        dataKey="_band_range"
                        stackId="confidence"
                        stroke="none"
                        fill="hsl(var(--chart-5, 0 72% 51%))"
                        fillOpacity={0.12}
                        connectNulls
                        legendType="none"
                        name="Confidence Band"
                        isAnimationActive={false}
                        yAxisId="left"
                      />
                    </>
                  )}
                  {onlyDiffSelected && (
                    <Line
                      type="linear"
                      dataKey="_zero"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      strokeOpacity={0.5}
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      tooltipType="none"
                      isAnimationActive={false}
                      yAxisId="left"
                    />
                  )}
                  {MODEL_FIT_ALL_SERIES.filter((s) => selectedSeries.has(s.key)).map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      yAxisId={profitKeys.has(s.key) && !onlyDiffSelected ? "right" : "left"}
                    />
                  ))}
                </ComposedChart>
              )
            })()}
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

// ─── Data Dump ──────────────────────────────────────────────────────────────

const DUMP_PAGE_SIZE = 25
type DumpSortField = "outlet_name" | "date" | "profit" | "scenario_delivery" | "actual_delivered" | "starred"

function GTooltipHead({ label, info }: { label: string; info: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b border-dotted border-current">{label}</span>
        </TooltipTrigger>
        <UiTooltipContent side="top" className="max-w-xs text-xs">{info}</UiTooltipContent>
      </UiTooltip>
    </TooltipProvider>
  )
}

function DataDumpTab({
  simulationId,
  customerId,
  simFrom,
  simTo,
  currencySymbol,
  selectedOutletIds: ddSelectedOutletIds,
  setSelectedOutletIds: setDdSelectedOutletIds,
  allSelected: ddAllOutlets,
  setAllSelected: setDdAllOutlets,
}: {
  simulationId: string
  customerId: string
  simFrom: string | null
  simTo: string | null
  currencySymbol: string
  selectedOutletIds: Set<string>
  setSelectedOutletIds: React.Dispatch<React.SetStateAction<Set<string>>>
  allSelected: boolean
  setAllSelected: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const t = useTranslations("simulations.completed")

  // ── Filter state
  const [ddScenario, setDdScenario] = useState<ScenarioColumn>("delivered")
  const [ddDateRange, setDdDateRange] = useState<DateRange | undefined>(() => {
    const from = simFrom ? new Date(simFrom + "T00:00:00") : undefined
    const to = simTo ? new Date(simTo + "T00:00:00") : undefined
    return from && to ? { from, to } : undefined
  })
  const [ddDatePickerOpen, setDdDatePickerOpen] = useState(false)
  const [ddGroupId, setDdGroupId] = useState<string | null>(null)
  const [ddOutletSearch, setDdOutletSearch] = useState("")
  const [ddOutletPage, setDdOutletPage] = useState(1)
  const [ddGroup, setDdGroup] = useState<string | null>(null)

  // Derive ISO strings from date range
  const ddFromDate = ddDateRange?.from ? format(ddDateRange.from, "yyyy-MM-dd") : ""
  const ddToDate = ddDateRange?.to ? format(ddDateRange.to, "yyyy-MM-dd") : ""

  // ── Table state
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<DumpSortField>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [showOnlyChecked, setShowOnlyChecked] = useState(false)

  // ── Outlet groups
  const { data: groups } = useQuery({
    queryKey: ["outlet-groups", customerId],
    queryFn: () => outletGroupsApi.list(customerId),
    staleTime: 5 * 60_000,
  })

  // ── Outlet list (from model-fit-base)
  const { data: baseData } = useQuery({
    queryKey: ["simulation-model-fit-base", simulationId],
    queryFn: () => simulationsApi.getModelFit(simulationId),
    staleTime: 5 * 60_000,
  })

  // ── Outlet group members
  const { data: groupOutlets } = useQuery({
    queryKey: ["outlet-group-outlets", ddGroupId],
    queryFn: () => outletGroupsApi.getOutlets(ddGroupId!),
    enabled: !!ddGroupId,
    staleTime: 5 * 60_000,
  })

  // ── Determine effective outlet IDs from group + individual selection
  const resolvedOutletIds = useMemo(() => {
    let ids: string[] | undefined = undefined
    if (ddGroupId && groupOutlets) {
      const groupIds = new Set(groupOutlets.map((o) => o.id))
      if (!ddAllOutlets) {
        ids = Array.from(ddSelectedOutletIds).filter((id) => groupIds.has(id))
      } else {
        ids = Array.from(groupIds)
      }
    } else if (!ddAllOutlets && ddSelectedOutletIds.size > 0) {
      ids = Array.from(ddSelectedOutletIds)
    }
    return ids
  }, [ddGroupId, groupOutlets, ddAllOutlets, ddSelectedOutletIds])

  // ── Debounced search for server-side filtering
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1) }, [ddScenario, resolvedOutletIds, ddFromDate, ddToDate, debouncedSearch, sortField, sortDir, ddGroup])

  // Map client sort fields to server sort fields (profit/starred are client-only)
  const serverSortBy = (sortField === "profit" || sortField === "starred") ? "date" : sortField
  const serverSortDir = (sortField === "profit" || sortField === "starred") ? "asc" : sortDir

  // ── Fetch data dump (server-side paginated)
  const { data: dumpData, isLoading } = useQuery({
    queryKey: ["simulation-data-dump", simulationId, ddScenario, resolvedOutletIds, ddFromDate, ddToDate, currentPage, serverSortBy, serverSortDir, debouncedSearch, ddGroup],
    queryFn: () => simulationsApi.getDataDump(simulationId, {
      column: ddScenario,
      outletIds: resolvedOutletIds,
      fromDate: ddFromDate || undefined,
      toDate: ddToDate || undefined,
      limit: DUMP_PAGE_SIZE,
      offset: (currentPage - 1) * DUMP_PAGE_SIZE,
      sortBy: serverSortBy,
      sortDir: serverSortDir,
      search: debouncedSearch || undefined,
      group: ddGroup || undefined,
    }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })

  const allRows = dumpData?.rows ?? []
  const totalCount = dumpData?.total_count ?? 0

  const rowKey = (r: DataDumpRow) => `${r.outlet_id}::${r.date}`
  const rowProfit = (r: DataDumpRow) => r.g1 ?? r.g2 ?? r.g3 ?? r.g4 ?? null

  // ── Outlet selector list
  const outlets: ModelFitOutlet[] = baseData?.outlets ?? []
  const filteredOutlets = useMemo(() => {
    const q = ddOutletSearch.toLowerCase()
    let list = outlets
    if (ddGroupId && groupOutlets) {
      const groupIds = new Set(groupOutlets.map((o) => o.id))
      list = list.filter((o) => groupIds.has(o.id))
    }
    return list.filter((o) => !q || o.name.toLowerCase().includes(q))
  }, [outlets, ddOutletSearch, ddGroupId, groupOutlets])
  const outletTotalPages = Math.max(1, Math.ceil(filteredOutlets.length / OUTLET_PAGE_SIZE))
  const outletSafePage = Math.min(ddOutletPage, outletTotalPages)
  const pagedOutlets = filteredOutlets.slice((outletSafePage - 1) * OUTLET_PAGE_SIZE, outletSafePage * OUTLET_PAGE_SIZE)

  // ── Rows come pre-sorted and pre-paginated from the server.
  // Client-side sort only for profit/starred (not available server-side).
  const displayRows = useMemo(() => {
    let items = showOnlyChecked
      ? allRows.filter((r) => checkedIds.has(rowKey(r)))
      : allRows

    if (sortField === "profit" || sortField === "starred") {
      return [...items].sort((a, b) => {
        let va: number, vb: number
        if (sortField === "profit") {
          va = rowProfit(a) ?? 0; vb = rowProfit(b) ?? 0
        } else {
          va = starredIds.has(rowKey(a)) ? 1 : 0; vb = starredIds.has(rowKey(b)) ? 1 : 0
        }
        return sortDir === "asc" ? va - vb : vb - va
      })
    }
    return items
  }, [allRows, sortField, sortDir, showOnlyChecked, checkedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(totalCount / DUMP_PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = displayRows

  // ── Handlers
  function handleSort(field: DumpSortField) {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageChecked = pageItems.length > 0 && pageItems.every((r) => checkedIds.has(rowKey(r)))
  const somePageChecked = pageItems.some((r) => checkedIds.has(rowKey(r)))

  function handleHeaderCheckbox() {
    if (allPageChecked) {
      setCheckedIds((prev) => { const n = new Set(prev); pageItems.forEach((r) => n.delete(rowKey(r))); return n })
    } else {
      setCheckedIds((prev) => { const n = new Set(prev); pageItems.forEach((r) => n.add(rowKey(r))); return n })
    }
  }

  function handleStar(key: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  function toggleOutlet(id: string) {
    setDdAllOutlets(false)
    setDdSelectedOutletIds((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function handleDateRangeChange(range: DateRange | undefined) {
    setDdDateRange(range)
    setCurrentPage(1)
    if (range?.to) setDdDatePickerOpen(false)
  }

  function DumpSortHeader({ field, label }: { field: DumpSortField; label: string }) {
    const active = sortField === field
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 font-medium hover:text-foreground transition-colors text-left whitespace-nowrap"
      >
        {label}
        {active
          ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  const scenarioLabel = SCENARIO_OPTIONS.find((o) => o.value === ddScenario)?.label ?? "Delivered"
  const fmtN = (n: number | null | undefined) => n != null ? formatNumber(n) : "—"
  const fmtC = (n: number | null | undefined) => n != null ? formatCurrency(n, currencySymbol) : "—"
  const fmtQ = (n: number | null | undefined) => n != null ? n.toFixed(1) : "—"
  const isEoQ = (q: number | null | undefined, eo: number | null | undefined, qIdx: number, qs: (number | null)[]) => {
    if (q == null || eo == null) return false
    // Find the quantile closest to the (interpolated) EO value
    let bestIdx = -1
    let bestDist = Infinity
    for (let k = 0; k < qs.length; k++) {
      if (qs[k] != null) {
        const d = Math.abs(qs[k]! - eo)
        if (d < bestDist) { bestDist = d; bestIdx = k }
      }
    }
    return bestIdx === qIdx
  }
  const delta = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null || b == null) return null
    return a - b
  }
  const fmtDelta = (d: number | null) => {
    if (d == null) return "—"
    const sign = d > 0 ? "+" : ""
    return `${sign}${formatNumber(d)}`
  }

  return (
    <div className="flex gap-4 h-full">
      {/* ── Left: filters ── */}
      <div className="w-52 shrink-0 flex flex-col gap-2">
        {/* Scenario */}
        <ScenarioCombobox value={ddScenario} onChange={(v) => { setDdScenario(v); setCurrentPage(1) }} />

        {/* Date range picker */}
        <Popover open={ddDatePickerOpen} onOpenChange={setDdDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "h-8 justify-start text-left text-xs font-normal w-full cursor-pointer",
                !ddDateRange?.from && "text-[var(--muted-foreground)]",
              )}
            >
              <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
              {ddDateRange?.from ? (
                ddDateRange.to ? (
                  <>{format(ddDateRange.from, "MMM d, yyyy")} – {format(ddDateRange.to, "MMM d, yyyy")}</>
                ) : (
                  format(ddDateRange.from, "MMM d, yyyy")
                )
              ) : (
                "Pick date range"
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              captionLayout="dropdown"
              defaultMonth={ddDateRange?.from}
              selected={ddDateRange}
              onSelect={handleDateRangeChange}
              numberOfMonths={2}
              startMonth={new Date(2020, 0)}
              endMonth={new Date(new Date().getFullYear() + 1, 11)}
            />
          </PopoverContent>
        </Popover>
        {ddDateRange && (ddFromDate !== (simFrom ?? "") || ddToDate !== (simTo ?? "")) && (
          <button
            onClick={() => {
              const from = simFrom ? new Date(simFrom + "T00:00:00") : undefined
              const to = simTo ? new Date(simTo + "T00:00:00") : undefined
              setDdDateRange(from && to ? { from, to } : undefined)
              setCurrentPage(1)
            }}
            className="text-xs text-[var(--muted-foreground)] hover:text-foreground underline self-start"
          >Reset</button>
        )}

        {/* Outlet group */}
        {groups && groups.length > 0 && (
          <select
            value={ddGroupId ?? ""}
            onChange={(e) => { setDdGroupId(e.target.value || null); setCurrentPage(1) }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
          >
            <option value="">{t("dumpAllGroups")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({g.outlet_count})</option>
            ))}
          </select>
        )}

        {/* Outlet selector */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Filter outlets…"
            value={ddOutletSearch}
            onChange={(e) => { setDdOutletSearch(e.target.value); setDdOutletPage(1) }}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto border rounded-md divide-y divide-border/40 text-xs">
          <button
            onClick={() => { setDdAllOutlets(true); setDdSelectedOutletIds(new Set()); setCurrentPage(1) }}
            className={cn(
              "w-full text-left px-3 py-1.5 hover:bg-[var(--muted)]/40 transition-colors flex items-center gap-2",
              ddAllOutlets && "bg-[var(--muted)]/60 font-medium"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full shrink-0", ddAllOutlets ? "bg-primary" : "bg-transparent border border-border")} />
            All outlets
          </button>
          {pagedOutlets.map((o) => {
            const sel = !ddAllOutlets && ddSelectedOutletIds.has(o.id)
            return (
              <button
                key={o.id}
                onClick={() => { toggleOutlet(o.id); setCurrentPage(1) }}
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
            <button onClick={() => setDdOutletPage((p) => Math.max(1, p - 1))} disabled={outletSafePage === 1} className="hover:text-foreground disabled:opacity-30">‹</button>
            <span>{outletSafePage} / {outletTotalPages}</span>
            <button onClick={() => setDdOutletPage((p) => Math.min(outletTotalPages, p + 1))} disabled={outletSafePage === outletTotalPages} className="hover:text-foreground disabled:opacity-30">›</button>
          </div>
        )}
      </div>

      {/* ── Right: table ── */}
      <div className="flex-1 flex flex-col min-w-0 gap-2">
        {/* Toolbar */}
        <div className="flex items-center justify-end">
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
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">Loading…</div>
        ) : allRows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">No data</div>
        ) : (
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4 sticky left-0 bg-background z-10">
                    <div className="flex items-center gap-0.5">
                      <Checkbox
                        checked={allPageChecked ? true : somePageChecked ? "indeterminate" : false}
                        onCheckedChange={handleHeaderCheckbox}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className={cn("h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors cursor-pointer", ddGroup && "text-primary")}>
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => setCheckedIds(new Set(displayRows.map((r) => rowKey(r))))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setCheckedIds(new Set(displayRows.filter((r) => starredIds.has(rowKey(r))).map((r) => rowKey(r))))}>
                            {t("starred")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { const sorted = [...displayRows].filter((r) => rowProfit(r) != null).sort((a, b) => (rowProfit(b) ?? 0) - (rowProfit(a) ?? 0)); setCheckedIds(new Set(sorted.slice(0, 20).map((r) => rowKey(r)))) }}>
                            {t("selectTopProfitable")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { const sorted = [...displayRows].filter((r) => rowProfit(r) != null).sort((a, b) => (rowProfit(a) ?? 0) - (rowProfit(b) ?? 0)); setCheckedIds(new Set(sorted.slice(0, 20).map((r) => rowKey(r)))) }}>
                            {t("selectBottomProfitable")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDdGroup((g) => g === "g1" ? null : "g1")}>
                            {t("selectG1")}{ddGroup === "g1" ? " ✓" : ""}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDdGroup((g) => g === "g2" ? null : "g2")}>
                            {t("selectG2")}{ddGroup === "g2" ? " ✓" : ""}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDdGroup((g) => g === "g3" ? null : "g3")}>
                            {t("selectG3")}{ddGroup === "g3" ? " ✓" : ""}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDdGroup((g) => g === "g4" ? null : "g4")}>
                            {t("selectG4")}{ddGroup === "g4" ? " ✓" : ""}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><DumpSortHeader field="outlet_name" label={t("dumpColOutlet")} /></TableHead>
                  <TableHead><DumpSortHeader field="date" label={t("dumpColDate")} /></TableHead>
                  <TableHead className="text-right"><DumpSortHeader field="profit" label={t("dumpColProfit")} /></TableHead>
                  <TableHead className="text-right">
                    <DumpSortHeader field="scenario_delivery" label={scenarioLabel} />
                  </TableHead>
                  <TableHead className="text-right">{t("dumpColSold")}</TableHead>
                  <TableHead className="text-right">{t("dumpColReturned")}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q10</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q20</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q30</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q40</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q50</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q60</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q70</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q80</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Q90</TableHead>
                  <TableHead className="text-right whitespace-nowrap">EO</TableHead>
                  <TableHead className="text-right"><GTooltipHead label="G1" info={t("overviewColG1")} /></TableHead>
                  <TableHead className="text-right"><GTooltipHead label="G2" info={t("overviewColG2")} /></TableHead>
                  <TableHead className="text-right"><GTooltipHead label="G3" info={t("overviewColG3")} /></TableHead>
                  <TableHead className="text-right"><GTooltipHead label="G4" info={t("overviewColG4")} /></TableHead>
                  <TableHead className="text-right whitespace-nowrap">{t("dumpColCV")}</TableHead>
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
                {pageItems.map((row) => {
                  const key = rowKey(row)
                  const dDelivery = delta(row.scenario_delivery, row.actual_delivered)
                  const dSold = delta(row.scenario_sold, row.actual_sold)
                  const dReturned = delta(row.scenario_returned, row.actual_returned)
                  return (
                    <TableRow
                      key={key}
                      onContextMenu={(e) => { e.preventDefault(); handleStar(key) }}
                    >
                      <TableCell className="pl-4 sticky left-0 bg-background z-10" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checkedIds.has(key)}
                          onCheckedChange={(c) => setCheckedIds((prev) => { const n = new Set(prev); c ? n.add(key) : n.delete(key); return n })}
                        />
                      </TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate">{row.outlet_name}</TableCell>
                      <TableCell className="text-sm text-[var(--muted-foreground)] tabular-nums whitespace-nowrap">{formatDate(row.date)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", (() => { const p = rowProfit(row); return p != null && p > 0 ? "text-green-500" : p != null && p < 0 ? "text-red-500" : "" })())}>{fmtC(rowProfit(row))}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{fmtN(row.scenario_delivery)}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">{fmtN(row.actual_delivered)}</div>
                        <div className={cn("text-xs", dDelivery != null && dDelivery < 0 ? "text-red-500" : dDelivery != null && dDelivery > 0 ? "text-green-500" : "text-[var(--muted-foreground)]")}>{fmtDelta(dDelivery)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{fmtN(row.scenario_sold)}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">{fmtN(row.actual_sold)}</div>
                        <div className={cn("text-xs", dSold != null && dSold < 0 ? "text-red-500" : dSold != null && dSold > 0 ? "text-green-500" : "text-[var(--muted-foreground)]")}>{fmtDelta(dSold)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{fmtN(row.scenario_returned)}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">{fmtN(row.actual_returned)}</div>
                        <div className={cn("text-xs", dReturned != null && dReturned < 0 ? "text-green-500" : dReturned != null && dReturned > 0 ? "text-red-500" : "text-[var(--muted-foreground)]")}>{fmtDelta(dReturned)}</div>
                      </TableCell>
                      {((_qs) => _qs.map((q, i) => (
                        <TableCell key={i} className="text-right tabular-nums text-xs">
                          {isEoQ(q, row.eo, i, _qs) ? (
                            <span className="relative inline-block px-1">
                              <span className="absolute inset-[-14px] bg-[url('/red-circle-brush.png')] bg-contain bg-center bg-no-repeat pointer-events-none" />
                              <span className="relative">{fmtQ(q)}</span>
                            </span>
                          ) : fmtQ(q)}
                        </TableCell>
                      )))([row.q10, row.q20, row.q30, row.q40, row.q50, row.q60, row.q70, row.q80, row.q90] as (number | null)[])}
                      <TableCell className="text-right tabular-nums text-xs">{fmtQ(row.eo)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", row.g1 != null && row.g1 > 0 && "text-green-500")}>{fmtC(row.g1)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", row.g2 != null && row.g2 < 0 && "text-red-500")}>{fmtC(row.g2)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", row.g3 != null && row.g3 < 0 && "text-red-500")}>{fmtC(row.g3)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.g4 != null ? (
                          <TooltipProvider delayDuration={200}>
                            <UiTooltip>
                              <TooltipTrigger asChild>
                                <div className="cursor-help">
                                  <div className={cn(row.g4 > 0 && "text-green-500")}>{fmtC(row.g4)}</div>
                                  <div className="text-xs text-[var(--muted-foreground)]">
                                    {row.g4_extra_sales != null
                                      ? `E[extra] = ${row.g4_extra_sales.toFixed(2)}`
                                      : "—"}
                                  </div>
                                  <div className="text-xs text-[var(--muted-foreground)]">
                                    {row.g4_extra_sales != null && row.g4_profit_unit != null
                                      ? `${row.g4_extra_sales.toFixed(2)} × ${currencySymbol}${row.g4_profit_unit.toFixed(2)}`
                                      : "—"}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <UiTooltipContent side="left" className="max-w-sm text-xs font-mono">
                                {row.g4_unit_probs && row.g4_unit_probs.length > 0 ? (
                                  <>
                                    <p className="font-sans font-medium mb-1">Per-unit survival probabilities:</p>
                                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                                      {row.g4_unit_probs.map(([unit, prob]) => (
                                        <div key={unit} className="flex justify-between gap-4">
                                          <span>P(demand ≥ {unit})</span>
                                          <span>= {prob.toFixed(4)}</span>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="border-t border-border/40 pt-1 mt-1 flex justify-between gap-4 font-medium">
                                      <span>E[extra sales]</span>
                                      <span>= {row.g4_extra_sales?.toFixed(4)}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span>Profit</span>
                                      <span>= {row.g4_extra_sales?.toFixed(4)} × {currencySymbol}{row.g4_profit_unit?.toFixed(2)} = {fmtC(row.g4)}</span>
                                    </div>
                                  </>
                                ) : (
                                  <p>No quantile data available</p>
                                )}
                              </UiTooltipContent>
                            </UiTooltip>
                          </TooltipProvider>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-[var(--muted-foreground)]">
                        {row.cv != null ? row.cv.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleStar(key)} className="hover:text-amber-400 transition-colors cursor-pointer" aria-label="Toggle star">
                          <Star className={cn("h-4 w-4", starredIds.has(key) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination + selection bar */}
        {totalCount > 0 && (
          <div className="shrink-0 border-t bg-background">
            <div className="flex items-center justify-between px-4 py-1.5">
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("showing", {
                  from: (safePage - 1) * DUMP_PAGE_SIZE + 1,
                  to: Math.min(safePage * DUMP_PAGE_SIZE, totalCount),
                  total: totalCount,
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

            {checkedIds.size > 0 && (
              <div className="flex items-center justify-between px-4 py-2 border-t bg-[var(--muted)]/30">
                <span className="text-xs text-[var(--muted-foreground)]">
                  {t("selectedCount", { selected: checkedIds.size, total: totalCount })}
                </span>
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1.5 px-2 cursor-pointer"
                  onClick={() => setShowOnlyChecked((v) => !v)}
                  title={showOnlyChecked ? "Show all" : "Show only selected"}
                >
                  <Focus className={cn("h-3.5 w-3.5", showOnlyChecked && "text-primary")} />
                  {showOnlyChecked && <span className="text-xs">Show all</span>}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Scenario overview data ─────────────────────────────────────────────────

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

// ─── localStorage helpers (scoped per customer) ─────────────────────────────

const SIM_STORAGE_PREFIX = "gorm:simCompleted:"

function loadSimJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${SIM_STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveSimJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${SIM_STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

export default function SimulationsCompletedPage() {
  const t = useTranslations("simulations.completed")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const deepLinkTaskId = searchParams.get("task_id")
  const cid = activeCustomer?.id ?? ""

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadSimJson<string[]>(cid, "checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadSimJson<string[]>(cid, "starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state (persisted)
  const [selectedSimId, setSelectedSimId] = useState<string | null>(() => loadSimJson<string | null>(cid, "selectedSim", null))
  const [selected, setSelected] = useState<CompletedSimulationResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadSimJson<string>(cid, "activeTab", "tab1"))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Scenario selector (shared between Overview and Zero Shot tabs)
  const [scenario, setScenario] = useState<ScenarioColumn>("delivered")

  // ── Weekday filter (shared between Overview, Zero Shot, and Model Fit tabs)
  const [weekday, setWeekday] = useState<WeekdayFilter>("all")
  const weekdayDays = WEEKDAY_OPTIONS.find((o) => o.value === weekday)?.days ?? null

  // ── Shared outlet filter (Overview, Model Fit, Data Dump)
  const [sharedOutletIds, setSharedOutletIds] = useState<Set<string>>(new Set())
  const [sharedAllOutlets, setSharedAllOutlets] = useState(true)

  // ── Overview outlet filter (search/page are local to the tab)
  const [ovOutletSearch, setOvOutletSearch] = useState("")
  const [ovOutletPage, setOvOutletPage] = useState(1)

  // ── Delete dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Detail maximize state (persisted)
  const [detailMaximized, setDetailMaximized] = useState(() => loadSimJson<boolean>(cid, "detailMaximized", false))

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

  const { data: zeroShotStats } = useQuery({
    queryKey: ["simulation-accuracy-stats-zs", selected?.simulation_id, scenario, weekday],
    queryFn: () => simulationsApi.getAccuracyStats(selected!.simulation_id!, scenario, weekdayDays ?? undefined),
    enabled: !!selected?.simulation_id && activeTab === "tab4",
    staleTime: 60_000,
  })

  // Fetch outlet list for overview tab (reuse model-fit-base which returns outlets)
  const { data: ovBaseData } = useQuery({
    queryKey: ["simulation-model-fit-base", selected?.simulation_id],
    queryFn: () => simulationsApi.getModelFit(selected!.simulation_id!),
    enabled: !!selected?.simulation_id && (activeTab === "tab2" || activeTab === "tab5"),
    staleTime: 5 * 60_000,
  })

  const ovOutlets: ModelFitOutlet[] = ovBaseData?.outlets ?? []
  const ovFilteredOutlets = useMemo(() => {
    const q = ovOutletSearch.toLowerCase()
    return ovOutlets.filter((o) => !q || o.name.toLowerCase().includes(q))
  }, [ovOutlets, ovOutletSearch])
  const ovOutletTotalPages = Math.max(1, Math.ceil(ovFilteredOutlets.length / OUTLET_PAGE_SIZE))
  const ovSafePage = Math.min(ovOutletPage, ovOutletTotalPages)
  const ovPagedOutlets = ovFilteredOutlets.slice((ovSafePage - 1) * OUTLET_PAGE_SIZE, ovSafePage * OUTLET_PAGE_SIZE)

  const sharedActiveOutletIds = sharedAllOutlets ? undefined : Array.from(sharedOutletIds)
  const needsOverviewApi = weekdayDays != null || sharedActiveOutletIds != null

  const { data: overviewFiltered } = useQuery({
    queryKey: ["simulation-overview-filtered", selected?.simulation_id, scenario, weekday, sharedActiveOutletIds],
    queryFn: () => simulationsApi.getOverview(selected!.simulation_id!, scenario, weekdayDays ?? undefined, sharedActiveOutletIds),
    enabled: !!selected?.simulation_id && activeTab === "tab2",
    staleTime: 30_000,
  })

  const simulations = listData?.items ?? []

  // ── Persist state to localStorage ──────────────────────────────────────────

  useEffect(() => { if (cid) saveSimJson(cid, "checked", [...selectedIds]) }, [cid, selectedIds])
  useEffect(() => { if (cid) saveSimJson(cid, "starred", [...starredIds]) }, [cid, starredIds])
  useEffect(() => { if (cid) saveSimJson(cid, "activeTab", activeTab) }, [cid, activeTab])
  useEffect(() => { if (cid) saveSimJson(cid, "selectedSim", selected?.id ?? null) }, [cid, selected?.id])
  useEffect(() => { if (cid) saveSimJson(cid, "detailMaximized", detailMaximized) }, [cid, detailMaximized])

  // ── Restore selected simulation from persisted ID when list loads ──────────

  useEffect(() => {
    if (!simulations.length || selected || deepLinkTaskId) return
    if (selectedSimId) {
      const found = simulations.find((s) => s.id === selectedSimId)
      if (found) setSelected(found)
    }
  }, [simulations.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset persisted state when customer changes ───────────────────────────

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setSelectedIds(new Set(loadSimJson<string[]>(cid, "checked", [])))
      setStarredIds(new Set(loadSimJson<string[]>(cid, "starred", [])))
      setSelectedSimId(loadSimJson<string | null>(cid, "selectedSim", null))
      setSelected(null)
      setActiveTab(loadSimJson<string>(cid, "activeTab", "tab1"))
    }
    prevCidRef.current = cid
  }, [cid])

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
    setActiveTab(match.status === "failure" || match.status === "revoked" ? "tab0" : "tab1")
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

  const resumeMutation = useMutation({
    mutationFn: ({ recordId, worker }: { recordId: string; worker?: string }) =>
      simulationsApi.resume(recordId, worker),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["simulations-completed"] })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      toast.success(t("resumeSuccess"))
    },
    onError: () => toast.error(t("resumeError")),
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
      <div className={cn("flex flex-col shrink-0", detailMaximized && "hidden")}>
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
                        if (sim.status === "success" && sim.actual_engine) {
                          return <Badge variant="info" className="text-xs">{t("statusDegraded")}</Badge>
                        }
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
                {(selected.status === "failure" || selected.status === "revoked") && (
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 text-destructive data-[state=active]:text-destructive" value="tab0">{t("tabError")}</TabsTrigger>
                )}
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tabSpecs">{t("tabSpecs")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabStats")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabZeroShot")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab5">{t("tabModelFit")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tabDump">{t("tabDataDump")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabActions")}</TabsTrigger>
                <div
                  className="ml-auto flex items-center pr-2 pl-3 mb-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setDetailMaximized((v) => !v)}
                  aria-label={detailMaximized ? "Minimize" : "Maximize"}
                >
                  {detailMaximized ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
                </div>
              </TabsList>
              <div
                className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
              />
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ─ Error ─ */}
              {(selected.status === "failure" || selected.status === "revoked") && (
                <TabsContent value="tab0" className="max-w-2xl mt-6 px-4 space-y-3">
                  {selected.days_total != null && selected.days_total > 0 && (
                    <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-4">
                      <p className="text-xs font-semibold text-[var(--foreground)] mb-2">{t("progressTitle")}</p>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-destructive/70 transition-all"
                            style={{ width: `${Math.min(100, Math.round(((selected.days_completed ?? 0) / selected.days_total) * 100))}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-[var(--muted-foreground)] whitespace-nowrap">
                          {selected.days_completed ?? 0} / {selected.days_total} {t("progressDays")} ({Math.round(((selected.days_completed ?? 0) / selected.days_total) * 100)}%)
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-xs font-semibold text-destructive mb-2">{t("tabError")}</p>
                    <p className="text-xs text-[var(--muted-foreground)] font-mono whitespace-pre-wrap break-all">
                      {selected.error ?? "No error message available."}
                    </p>
                  </div>
                </TabsContent>
              )}

              {/* ─ Warnings ─ */}
              {selected.warnings && selected.warnings.length > 0 && (
                <div className="max-w-2xl mt-4 mx-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs font-semibold text-amber-500 mb-1.5">{t("warningsTitle")}</p>
                  {selected.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-[var(--muted-foreground)] leading-relaxed">{w}</p>
                  ))}
                </div>
              )}

              {/* ─ Details ─ */}
              <TabsContent value="tab1" className="space-y-3 max-w-2xl mt-6 px-4">
                <StatRow label="ID" value={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-xs opacity-70">{selected.simulation_id ?? selected.id}</span>
                    <AnimateIcon animateOnHover className="cursor-pointer">
                      <CopyIcon
                        size={14}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText(selected.simulation_id ?? selected.id)
                          toast.success(t("toastCopied"))
                        }}
                      />
                    </AnimateIcon>
                  </span>
                } />
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
                <StatRow label={t("fieldDelay")} value={selected.delay != null ? `${selected.delay} days` : "—"} />
                <StatRow label={t("fieldOutlets")} value={selected.outlet_count} />
              </TabsContent>

              {/* ─ Specs ─ */}
              <TabsContent value="tabSpecs" className="space-y-3 max-w-2xl mt-6 px-4">
                <StatRow label={t("fieldEngine")} value={selected.actual_engine ?? selected.engine ?? "—"} />
                {selected.actual_engine && (
                  <StatRow
                    label={t("fieldRequestedEngine")}
                    value={<span className="text-amber-400">{selected.engine}</span>}
                  />
                )}
                {selected.engine_params && Object.keys(selected.engine_params).length > 0 && (
                  <>
                    <div className="pt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-2">{t("fieldParams")}</p>
                      <div className="space-y-1.5">
                        {Object.entries(selected.engine_params).map(([key, val]) => (
                          <StatRow key={key} label={key} value={String(val ?? "—")} />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* ─ Overview ─ */}
              <TabsContent value="tab2" className="mt-6 px-4">
                {selected.status !== "success" ? (
                  <div className="text-sm text-[var(--muted-foreground)] italic">
                    Stats are only available for completed simulations.
                  </div>
                ) : (
                  <div className="flex gap-4">
                    {/* ── Left: outlet selector ── */}
                    <div className="w-52 shrink-0 flex flex-col gap-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                        <Input
                          placeholder="Filter outlets…"
                          value={ovOutletSearch}
                          onChange={(e) => { setOvOutletSearch(e.target.value); setOvOutletPage(1) }}
                          className="h-7 pl-7 text-xs"
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto border rounded-md divide-y divide-border/40 text-xs">
                        <button
                          onClick={() => { setSharedAllOutlets(true); setSharedOutletIds(new Set()) }}
                          className={cn(
                            "w-full text-left px-3 py-1.5 hover:bg-[var(--muted)]/40 transition-colors flex items-center gap-2",
                            sharedAllOutlets && "bg-[var(--muted)]/60 font-medium"
                          )}
                        >
                          <span className={cn("w-2 h-2 rounded-full shrink-0", sharedAllOutlets ? "bg-primary" : "bg-transparent border border-border")} />
                          All outlets
                        </button>
                        {ovPagedOutlets.map((o) => {
                          const sel = !sharedAllOutlets && sharedOutletIds.has(o.id)
                          return (
                            <button
                              key={o.id}
                              onClick={() => {
                                setSharedAllOutlets(false)
                                setSharedOutletIds((prev) => {
                                  const n = new Set(prev)
                                  n.has(o.id) ? n.delete(o.id) : n.add(o.id)
                                  return n
                                })
                              }}
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
                      {ovOutletTotalPages > 1 && (
                        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                          <button onClick={() => setOvOutletPage((p) => Math.max(1, p - 1))} disabled={ovSafePage === 1} className="hover:text-foreground disabled:opacity-30">‹</button>
                          <span>{ovSafePage} / {ovOutletTotalPages}</span>
                          <button onClick={() => setOvOutletPage((p) => Math.min(ovOutletTotalPages, p + 1))} disabled={ovSafePage === ovOutletTotalPages} className="hover:text-foreground disabled:opacity-30">›</button>
                        </div>
                      )}
                    </div>

                    {/* ── Right: scenario + weekday + overview table ── */}
                    <div className="flex-1 min-w-0 space-y-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ScenarioCombobox value={scenario} onChange={setScenario} />
                        <WeekdayCombobox value={weekday} onChange={setWeekday} />
                      </div>
                      {needsOverviewApi ? (
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
                            pct={overviewFiltered}
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
                              pct={overviewFiltered}
                            />
                          )
                        })()
                      )}
                    </div>
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
                    <>
                      <ZeroShotTable data={zeroShot} />
                      {zeroShotStats && (
                        <TooltipProvider delayDuration={200}>
                          <div className="space-y-2 pt-2">
                            <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">{t("statsHeading")}</p>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                              <StatRow label={t("statsMAE")} value={
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  {zeroShotStats.mae.toFixed(2)}
                                  <UiTooltip><TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help shrink-0" /></TooltipTrigger><UiTooltipContent side="top" className="max-w-xs text-xs">{t("statsMAEInfo")}</UiTooltipContent></UiTooltip>
                                </span>
                              } />
                              <StatRow label={t("statsRMSE")} value={
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  {zeroShotStats.rmse.toFixed(2)}
                                  <UiTooltip><TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help shrink-0" /></TooltipTrigger><UiTooltipContent side="top" className="max-w-xs text-xs">{t("statsRMSEInfo")}</UiTooltipContent></UiTooltip>
                                </span>
                              } />
                              <StatRow label={t("statsBias")} value={
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  {(zeroShotStats.bias >= 0 ? "+" : "") + zeroShotStats.bias.toFixed(2)}
                                  <UiTooltip><TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help shrink-0" /></TooltipTrigger><UiTooltipContent side="top" className="max-w-xs text-xs">{t("statsBiasInfo")}</UiTooltipContent></UiTooltip>
                                </span>
                              } />
                              {zeroShotStats.mape != null && (
                                <StatRow label={t("statsMAPE")} value={
                                  <span className="inline-flex items-center gap-1 tabular-nums">
                                    {zeroShotStats.mape.toFixed(1)}%
                                    <UiTooltip><TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help shrink-0" /></TooltipTrigger><UiTooltipContent side="top" className="max-w-xs text-xs">{t("statsMAPEInfo")}</UiTooltipContent></UiTooltip>
                                  </span>
                                } />
                              )}
                              {zeroShotStats.r_squared != null && (
                                <StatRow label={t("statsR2")} value={
                                  <span className="inline-flex items-center gap-1 tabular-nums">
                                    {zeroShotStats.r_squared.toFixed(3)}
                                    <UiTooltip><TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help shrink-0" /></TooltipTrigger><UiTooltipContent side="top" className="max-w-xs text-xs">{t("statsR2Info")}</UiTooltipContent></UiTooltip>
                                  </span>
                                } />
                              )}
                            </div>
                          </div>
                        </TooltipProvider>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>

              {/* ─ Model Fit ─ */}
              <TabsContent value="tab5" className="pt-4 px-4 h-[calc(100%-1rem)] overflow-hidden">
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
                    selectedOutletIds={sharedOutletIds}
                    setSelectedOutletIds={setSharedOutletIds}
                    allSelected={sharedAllOutlets}
                    setAllSelected={setSharedAllOutlets}
                  />
                )}
              </TabsContent>

              {/* ─ Data Dump ─ */}
              <TabsContent value="tabDump" className="mt-4 px-4 h-full">
                {!selected.simulation_id ? (
                  <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)] italic">No data</div>
                ) : (
                  <DataDumpTab
                    simulationId={selected.simulation_id}
                    customerId={selected.customer_id}
                    simFrom={selected.simulation_from}
                    simTo={selected.simulation_to}
                    currencySymbol={currencySymbol}
                    selectedOutletIds={sharedOutletIds}
                    setSelectedOutletIds={setSharedOutletIds}
                    allSelected={sharedAllOutlets}
                    setAllSelected={setSharedAllOutlets}
                  />
                )}
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="tab3" className="max-w-2xl mt-6 px-4 space-y-4">
                {(selected.status === "failure" || selected.status === "revoked") && selected.simulation_id && (
                  <div className="rounded-md border border-[var(--border)] p-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold">{t("resumeButton")}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">{t("resumeDescription")}</p>
                    </div>
                    <ButtonGroup className="shrink-0">
                      <Button
                        size="sm"
                        className="cursor-pointer"
                        disabled={resumeMutation.isPending}
                        onClick={() => resumeMutation.mutate({ recordId: selected.id })}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        {t("resumeButton")}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            className="cursor-pointer px-1.5"
                            disabled={resumeMutation.isPending}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => resumeMutation.mutate({ recordId: selected.id })}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t("resumeSameWorker")}
                            {selected.worker_name && (
                              <span className="ml-1 text-[var(--muted-foreground)]">
                                ({selected.worker_name})
                              </span>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => resumeMutation.mutate({ recordId: selected.id, worker: "" })}
                          >
                            <Globe className="h-3.5 w-3.5" />
                            {t("resumeAnyWorker")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ButtonGroup>
                  </div>
                )}
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
