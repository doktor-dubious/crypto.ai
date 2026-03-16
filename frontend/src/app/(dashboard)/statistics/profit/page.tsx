"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, ChevronDown, ChevronUp, ArrowUpDown, Filter, X, CalendarIcon,
  CalendarDays, Store, Focus,
} from "lucide-react"
import { format, differenceInCalendarDays } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
  ChartLegend, type ChartConfig,
} from "@/components/ui/chart"
import { LineChart, Line, CartesianGrid, XAxis, YAxis } from "recharts"
import { ViewSwitcher } from "@/components/ui/view-switcher"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  outletGroupsApi, salesApi, customerConfigurationApi,
  type FinancialsPerDateDataPoint, type FinancialsPerOutletDataPoint,
} from "@/lib/api"
import { ExportMenu } from "@/components/ui/export-menu"
import type { ExportColumn } from "@/lib/export"
import { cn } from "@/lib/utils"

// ─── Constants ───────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 8

const WEEKDAY_JS: Record<string, number[]> = {
  sun: [0], mon: [1], tue: [2], wed: [3], thu: [4], fri: [5], sat: [6],
  "mon-fri": [1, 2, 3, 4, 5],
  "mon-sat": [1, 2, 3, 4, 5, 6],
  all: [0, 1, 2, 3, 4, 5, 6],
}

const chartConfig: ChartConfig = {
  profit:     { label: "Profit",     color: "hsl(142 71% 45%)" },
  avg_profit: { label: "Avg Profit", color: "hsl(217 91% 60%)" },
  revenue:    { label: "Revenue",    color: "hsl(38 92% 50%)" },
  cost:       { label: "Cost",       color: "hsl(0 72% 51%)" },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function fmtMoney(v: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Main Component ─────────────────────────────────────────────────────────

const SF_PREFIX = "gorm:statsProfit:"
function loadSfV<T>(cid: string, k: string, fb: T): T { if (typeof window === "undefined") return fb; try { const r = localStorage.getItem(`${SF_PREFIX}${cid}:${k}`); return r ? JSON.parse(r) : fb } catch { return fb } }
function saveSfV(cid: string, k: string, v: unknown) { if (typeof window !== "undefined") localStorage.setItem(`${SF_PREFIX}${cid}:${k}`, JSON.stringify(v)) }

export default function StatisticsFinancialsPage() {
  const t = useTranslations("statisticsFinancials")
  const { activeCustomer } = useCustomer()
  const customerId = activeCustomer?.id
  const cid = customerId ?? ""

  // ── View mode (persisted) ─────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<"per-date" | "per-outlet">(() => loadSfV<"per-date" | "per-outlet">(cid, "viewMode", "per-date"))

  // ── Filters (persisted) ──────────────────────────────────────────────────
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => loadSfV<string | null>(cid, "groupId", null))
  const [weeks, setWeeks] = useState(() => loadSfV<number>(cid, "weeks", 8))
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [weekday, setWeekday] = useState<string>(() => loadSfV<string>(cid, "weekday", "all"))
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  // Info filter
  const [infoKey, setInfoKey] = useState("")
  const [infoValue, setInfoValue] = useState("")
  const [appliedInfoKey, setAppliedInfoKey] = useState("")
  const [appliedInfoValue, setAppliedInfoValue] = useState("")

  // Table state
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)

  // ── Persist filters ────────────────────────────────────────────────────────
  useEffect(() => { if (cid) saveSfV(cid, "groupId", selectedGroupId) }, [cid, selectedGroupId])
  useEffect(() => { if (cid) saveSfV(cid, "weeks", weeks) }, [cid, weeks])
  useEffect(() => { if (cid) saveSfV(cid, "weekday", weekday) }, [cid, weekday])
  useEffect(() => { if (cid) saveSfV(cid, "viewMode", viewMode) }, [cid, viewMode])
  const prevCidRef = useRef(cid)
  useEffect(() => { if (prevCidRef.current && cid && prevCidRef.current !== cid) { setSelectedGroupId(loadSfV<string | null>(cid, "groupId", null)); setWeeks(loadSfV(cid, "weeks", 8)); setWeekday(loadSfV(cid, "weekday", "all")); setViewMode(loadSfV(cid, "viewMode", "per-date")) }; prevCidRef.current = cid }, [cid])

  function toggleSeries(key: string) {
    setHiddenSeries((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
    setPage(1)
  }

  // ── Data fetching ────────────────────────────────────────────────────────

  const { data: customerConfig } = useQuery({
    queryKey: ["customer-config", customerId],
    queryFn: () => customerConfigurationApi.get(customerId!),
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ["outlet-groups", customerId],
    queryFn: () => outletGroupsApi.list(customerId!),
    enabled: !!customerId,
    staleTime: 60 * 1000,
  })

  const effectiveGroupId = useMemo(() => {
    if (selectedGroupId !== null) return selectedGroupId
    if (customerConfig?.production_group_id) return customerConfig.production_group_id
    return groups[0]?.id ?? null
  }, [selectedGroupId, customerConfig?.production_group_id, groups])

  const { data: groupOutlets = [] } = useQuery({
    queryKey: ["outlet-group-outlets", effectiveGroupId],
    queryFn: () => outletGroupsApi.getOutlets(effectiveGroupId!),
    enabled: !!effectiveGroupId,
    staleTime: 60 * 1000,
  })

  const filteredOutletIds = useMemo(() => {
    let outlets = groupOutlets
    if (appliedInfoKey) {
      outlets = outlets.filter((o) =>
        o.info.some((i) => {
          if (i.key !== appliedInfoKey) return false
          if (!appliedInfoValue) return true
          return i.value === appliedInfoValue
        }),
      )
    }
    return outlets.map((o) => o.id)
  }, [groupOutlets, appliedInfoKey, appliedInfoValue])

  // Date range
  const statsEndDate = useMemo(() => {
    if (dateRange?.to) return format(dateRange.to, "yyyy-MM-dd")
    return new Date().toISOString().slice(0, 10)
  }, [dateRange?.to])

  const statsStartDate = useMemo(() => {
    if (dateRange?.from) return format(dateRange.from, "yyyy-MM-dd")
    const d = new Date()
    d.setDate(d.getDate() - weeks * 7)
    return d.toISOString().slice(0, 10)
  }, [dateRange?.from, weeks])

  function handleDateRangeChange(range: DateRange | undefined) {
    setDateRange(range)
    if (range?.from && range?.to) {
      const days = differenceInCalendarDays(range.to, range.from)
      setWeeks(Math.max(1, Math.round(days / 7)))
    }
    setPage(1)
  }

  function handleWeeksChange(newWeeks: number) {
    setWeeks(newWeeks)
    setDateRange(undefined)
    setPage(1)
  }

  const queryParams = useMemo(() => ({
    customer_id: customerId!,
    outlet_ids: filteredOutletIds,
    start_date: statsStartDate,
    end_date: statsEndDate,
  }), [customerId, filteredOutletIds, statsStartDate, statsEndDate])

  // Per-date financials
  const { data: perDateData, isLoading: perDateLoading } = useQuery({
    queryKey: ["financials-per-date", queryParams],
    queryFn: () => salesApi.financialsPerDate(queryParams),
    enabled: !!customerId && filteredOutletIds.length > 0 && viewMode === "per-date",
    retry: false,
  })

  // Per-outlet financials
  const { data: perOutletData, isLoading: perOutletLoading } = useQuery({
    queryKey: ["financials-per-outlet", queryParams],
    queryFn: () => salesApi.financialsPerOutlet(queryParams),
    enabled: !!customerId && filteredOutletIds.length > 0 && viewMode === "per-outlet",
    retry: false,
  })

  // ── Per-date chart/table data ────────────────────────────────────────────

  const perDateChartData = useMemo(() => {
    if (!perDateData?.data) return []
    const allowed = WEEKDAY_JS[weekday] ?? WEEKDAY_JS.all
    return perDateData.data
      .filter((s) => allowed.includes(new Date(s.date + "T00:00:00").getDay()))
      .map((s) => ({
        date: s.date,
        profit: s.profit,
        avg_profit: s.avg_profit,
        revenue: s.revenue,
        cost: s.cost,
        outlet_count: s.outlet_count,
      }))
  }, [perDateData?.data, weekday])

  // ── Per-outlet table data ────────────────────────────────────────────────

  const perOutletTableData = useMemo(() => perOutletData?.data ?? [], [perOutletData?.data])

  // ── Generic table logic ──────────────────────────────────────────────────

  const isPerDate = viewMode === "per-date"
  const loading = isPerDate ? perDateLoading : perOutletLoading
  const hasData = isPerDate ? perDateChartData.length > 0 : perOutletTableData.length > 0

  // Unified rows for table
  const rawRows: any[] = isPerDate ? perDateChartData : perOutletTableData
  const rowKey = (r: any) => isPerDate ? r.date : r.outlet_id

  const filteredTable = useMemo(() => {
    let rows = rawRows
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter((r) =>
        isPerDate
          ? r.date.includes(q)
          : (r.ext_id?.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q)),
      )
    }
    if (showOnlySelected && checked.size > 0) {
      rows = rows.filter((r) => checked.has(rowKey(r)))
    }
    rows = [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      if (sortField === "starred") {
        return ((starred.has(rowKey(a)) ? 1 : 0) - (starred.has(rowKey(b)) ? 1 : 0)) * dir
      }
      if (sortField === "date" || sortField === "ext_id" || sortField === "name") {
        return ((a[sortField] ?? "").localeCompare(b[sortField] ?? "")) * dir
      }
      return ((a[sortField] ?? 0) - (b[sortField] ?? 0)) * dir
    })
    return rows
  }, [rawRows, search, showOnlySelected, checked, sortField, sortDir, starred, isPerDate])

  const totalPages = Math.max(1, Math.ceil(filteredTable.length / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filteredTable.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
  const paginationPages = buildPaginationPages(safePage, totalPages)

  const allChecked = pagedRows.length > 0 && pagedRows.every((r) => checked.has(rowKey(r)))

  const toggleCheck = useCallback((key: string) => {
    setChecked((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }, [])

  const toggleStar = useCallback((key: string) => {
    setStarred((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }, [])

  const toggleAllChecked = useCallback(() => {
    setChecked((prev) => {
      const n = new Set(prev)
      if (allChecked) { pagedRows.forEach((r) => n.delete(rowKey(r))) }
      else { pagedRows.forEach((r) => n.add(rowKey(r))) }
      return n
    })
  }, [allChecked, pagedRows])

  // ── Info filter ──────────────────────────────────────────────────────────

  const availableInfoKeys = useMemo(() => {
    const keys = new Set<string>()
    groupOutlets.forEach((o) => o.info.forEach((i) => keys.add(i.key)))
    return Array.from(keys).sort()
  }, [groupOutlets])

  const availableInfoValues = useMemo(() => {
    if (!infoKey) return []
    const vals = new Set<string>()
    groupOutlets.forEach((o) =>
      o.info.filter((i) => i.key === infoKey && i.value).forEach((i) => vals.add(i.value!)),
    )
    return Array.from(vals).sort()
  }, [groupOutlets, infoKey])

  function applyInfoFilter() {
    setAppliedInfoKey(infoKey); setAppliedInfoValue(infoValue); setPage(1); setChecked(new Set())
  }

  function clearInfoFilter() {
    setInfoKey(""); setInfoValue(""); setAppliedInfoKey(""); setAppliedInfoValue(""); setPage(1); setChecked(new Set())
  }

  // ── Export columns ────────────────────────────────────────────────────────

  const exportColumns: ExportColumn[] = useMemo(() => {
    if (isPerDate) return [
      { header: t("date"), accessor: "date" },
      { header: t("profit"), accessor: (r: any) => fmtMoney(r.profit) },
      { header: t("avgProfit"), accessor: (r: any) => fmtMoney(r.avg_profit) },
      { header: t("revenue"), accessor: (r: any) => fmtMoney(r.revenue) },
      { header: t("cost"), accessor: (r: any) => fmtMoney(r.cost) },
    ]
    return [
      { header: t("accountId"), accessor: "ext_id" },
      { header: t("accountName"), accessor: "name" },
      { header: t("profit"), accessor: (r: any) => fmtMoney(r.profit) },
      { header: t("avgProfit"), accessor: (r: any) => fmtMoney(r.avg_profit) },
      { header: t("revenue"), accessor: (r: any) => fmtMoney(r.revenue) },
      { header: t("cost"), accessor: (r: any) => fmtMoney(r.cost) },
    ]
  }, [isPerDate, t])

  // ── SortIcon helper ──────────────────────────────────────────────────────

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 ml-1" />
      : <ChevronDown className="h-3 w-3 ml-1" />
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const effectiveGroup = groups.find((g) => g.id === effectiveGroupId)

  function handleViewChange(v: string) {
    setViewMode(v as "per-date" | "per-outlet")
    setPage(1)
    setSearch("")
    setChecked(new Set())
    setShowOnlySelected(false)
    setSortField(v === "per-date" ? "date" : "profit")
    setSortDir("desc")
  }

  const currencySymbol = customerConfig?.currency_symbol ?? ""

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px]">
      {/* ── View Switcher ───────────────────────────────────────────────── */}
      <div className="flex">
        <ViewSwitcher
          options={[
            { id: "per-date", label: t("perDate"), icon: <CalendarDays /> },
            { id: "per-outlet", label: t("perOutlet"), icon: <Store /> },
          ]}
          value={viewMode}
          onChange={handleViewChange}
        />
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("outletGroup")}</label>
          <select
            value={effectiveGroupId ?? ""}
            onChange={(e) => { setSelectedGroupId(e.target.value || null); setPage(1); setChecked(new Set()) }}
            className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer min-w-[200px]"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({g.outlet_count})</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("period")}</label>
          <Input
            type="number" min={1} max={104} value={weeks}
            onChange={(e) => handleWeeksChange(Math.max(1, parseInt(e.target.value) || 8))}
            className="h-8 w-20 text-xs"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("dateRange")}</label>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("h-8 justify-start text-left text-xs font-normal min-w-[220px] cursor-pointer", !dateRange?.from && "text-[var(--muted-foreground)]")}>
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {dateRange?.from ? (dateRange.to ? <>{format(dateRange.from, "MMM d, yyyy")} – {format(dateRange.to, "MMM d, yyyy")}</> : format(dateRange.from, "MMM d, yyyy")) : t("dateRangePlaceholder")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                captionLayout="dropdown"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={handleDateRangeChange}
                numberOfMonths={2}
                startMonth={new Date(2020, 0)}
                endMonth={new Date(new Date().getFullYear() + 1, 11)}
              />
            </PopoverContent>
          </Popover>
        </div>

        {isPerDate && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--muted-foreground)]">{t("weekday")}</label>
            <select value={weekday} onChange={(e) => { setWeekday(e.target.value); setPage(1) }}
              className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer">
              <option value="all">{t("allWeekdays")}</option>
              <option value="mon-fri">{t("monFri")}</option>
              <option value="mon-sat">{t("monSat")}</option>
              <option disabled>──────────</option>
              <option value="mon">{t("monday")}</option>
              <option value="tue">{t("tuesday")}</option>
              <option value="wed">{t("wednesday")}</option>
              <option value="thu">{t("thursday")}</option>
              <option value="fri">{t("friday")}</option>
              <option value="sat">{t("saturday")}</option>
              <option value="sun">{t("sunday")}</option>
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("infoFilter")}</label>
          <div className="flex items-center gap-1.5">
            <select value={infoKey} onChange={(e) => { setInfoKey(e.target.value); setInfoValue("") }}
              className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer min-w-[120px]">
              <option value="">{t("infoFilterKey")}</option>
              {availableInfoKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {infoKey && (
              <select value={infoValue} onChange={(e) => setInfoValue(e.target.value)}
                className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer min-w-[120px]">
                <option value="">{t("infoFilterValue")}</option>
                {availableInfoValues.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            {infoKey && (
              <Button variant="outline" size="sm" className="h-8 text-xs cursor-pointer" onClick={applyInfoFilter}>
                <Filter className="h-3 w-3 mr-1" />{t("infoFilterApply")}
              </Button>
            )}
            {appliedInfoKey && (
              <Button variant="ghost" size="sm" className="h-8 text-xs cursor-pointer" onClick={clearInfoFilter}>
                <X className="h-3 w-3 mr-1" />{t("infoFilterClear")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {filteredOutletIds.length > 0 && (
        <div className="text-xs text-[var(--muted-foreground)] -mt-3">
          {t("outletCountBadge", { count: filteredOutletIds.length })}
          {appliedInfoKey && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-[var(--accent)] text-[var(--accent-foreground)]">
              {appliedInfoKey}{appliedInfoValue ? ` = ${appliedInfoValue}` : ""}
            </span>
          )}
        </div>
      )}

      {/* ── Per-Date Chart ──────────────────────────────────────────────── */}
      {isPerDate && (
        <>
          {loading ? (
            <div className="flex items-center justify-center h-64 text-sm text-[var(--muted-foreground)]">{t("loading")}</div>
          ) : perDateChartData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-sm text-[var(--muted-foreground)]">{t("noData")}</div>
          ) : (
            <ChartContainer config={chartConfig} className={cn("h-80 w-full aspect-auto transition-opacity duration-200", datePickerOpen && "opacity-10")}>
              <LineChart data={perDateChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={(v: string) => { const d = new Date(v + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()}` }}
                  interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={56}
                  tickFormatter={(v: number) => currencySymbol ? `${currencySymbol}${v}` : v.toLocaleString()} />
                <ChartTooltip content={
                  <ChartTooltipContent labelKey="date"
                    formatter={(value) => value != null ? `${currencySymbol}${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "\u2014"} />
                } />
                <ChartLegend content={() => (
                  <div className="flex items-center justify-center gap-4 pt-2">
                    {(["profit", "avg_profit", "revenue", "cost"] as const).map((key) => {
                      const hidden = hiddenSeries.has(key)
                      return (
                        <button key={key} onClick={() => toggleSeries(key)} className="flex items-center gap-1.5 cursor-pointer select-none group">
                          <div className="h-2 w-4 shrink-0 rounded-[2px] transition-opacity" style={{ backgroundColor: chartConfig[key].color, opacity: hidden ? 0.3 : 1 }} />
                          <span className="text-xs text-muted-foreground transition-opacity group-hover:text-foreground" style={{ textDecoration: hidden ? "line-through" : "none", opacity: hidden ? 0.5 : 1 }}>
                            {chartConfig[key].label as string}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )} />
                {(["profit", "avg_profit", "revenue", "cost"] as const).map((key) => (
                  <Line key={key} type="monotone" dataKey={key} stroke={chartConfig[key].color} strokeWidth={2}
                    dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls hide={hiddenSeries.has(key)} />
                ))}
              </LineChart>
            </ChartContainer>
          )}
        </>
      )}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {(isPerDate ? perDateChartData.length > 0 : perOutletTableData.length > 0) && !loading && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder={t("searchPlaceholder")} className="pl-8 h-8 text-xs" />
            </div>
            <ExportMenu data={filteredTable} columns={exportColumns} filename={`financials-${viewMode}-${effectiveGroup?.name ?? "all"}`} />
            <span className="text-xs text-[var(--muted-foreground)] ml-auto">
              {checked.size > 0 && <span className="mr-3">{t("selectedCount", { selected: checked.size })}</span>}
              {t("showing", { from: (safePage - 1) * ITEMS_PER_PAGE + 1, to: Math.min(safePage * ITEMS_PER_PAGE, filteredTable.length), total: filteredTable.length })}
            </span>
          </div>

          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 px-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className="flex items-center cursor-pointer">
                          <Checkbox checked={allChecked} onCheckedChange={toggleAllChecked} className="cursor-pointer" />
                          <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" />
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[140px]">
                        <DropdownMenuItem onClick={toggleAllChecked} className="cursor-pointer text-xs">{t("selectAll")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { const n = new Set(checked); filteredTable.filter((r) => starred.has(rowKey(r))).forEach((r) => n.add(rowKey(r))); setChecked(n) }} className="cursor-pointer text-xs">{t("starred")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableHead>
                  {isPerDate ? (
                    <>
                      <TableHead className="cursor-pointer select-none text-xs" onClick={() => handleSort("date")}>
                        <span className="flex items-center">{t("date")}<SortIcon field="date" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("profit")}>
                        <span className="flex items-center justify-end">{t("profit")}<SortIcon field="profit" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("avg_profit")}>
                        <span className="flex items-center justify-end">{t("avgProfit")}<SortIcon field="avg_profit" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("revenue")}>
                        <span className="flex items-center justify-end">{t("revenue")}<SortIcon field="revenue" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("cost")}>
                        <span className="flex items-center justify-end">{t("cost")}<SortIcon field="cost" /></span>
                      </TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="cursor-pointer select-none text-xs" onClick={() => handleSort("ext_id")}>
                        <span className="flex items-center">{t("accountId")}<SortIcon field="ext_id" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs" onClick={() => handleSort("name")}>
                        <span className="flex items-center">{t("accountName")}<SortIcon field="name" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("profit")}>
                        <span className="flex items-center justify-end">{t("profit")}<SortIcon field="profit" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("avg_profit")}>
                        <span className="flex items-center justify-end">{t("avgProfit")}<SortIcon field="avg_profit" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("revenue")}>
                        <span className="flex items-center justify-end">{t("revenue")}<SortIcon field="revenue" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("cost")}>
                        <span className="flex items-center justify-end">{t("cost")}<SortIcon field="cost" /></span>
                      </TableHead>
                    </>
                  )}
                  <TableHead className="w-10 px-3" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isPerDate ? 7 : 8} className="text-center text-xs text-[var(--muted-foreground)] py-8">{t("noResults")}</TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map((row) => {
                    const key = rowKey(row)
                    const isChecked = checked.has(key)
                    const isStarred = starred.has(key)
                    return (
                      <TableRow key={key} className={cn("cursor-pointer", isChecked && "bg-[var(--accent)]/30")}
                        onContextMenu={(e) => { e.preventDefault(); toggleStar(key) }}>
                        <TableCell className="px-3">
                          <Checkbox checked={isChecked} onCheckedChange={() => toggleCheck(key)} className="cursor-pointer" />
                        </TableCell>
                        {isPerDate ? (
                          <>
                            <TableCell className="text-xs font-medium">{row.date}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{currencySymbol}{fmtMoney(row.profit)}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{currencySymbol}{fmtMoney(row.avg_profit)}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{currencySymbol}{fmtMoney(row.revenue)}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{currencySymbol}{fmtMoney(row.cost)}</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-xs font-medium">{row.ext_id}</TableCell>
                            <TableCell className="text-xs">{row.name}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{currencySymbol}{fmtMoney(row.profit)}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{currencySymbol}{fmtMoney(row.avg_profit)}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{currencySymbol}{fmtMoney(row.revenue)}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{currencySymbol}{fmtMoney(row.cost)}</TableCell>
                          </>
                        )}
                        <TableCell className="px-3">
                          <button onClick={() => toggleStar(key)} className="cursor-pointer">
                            <Star className={cn("h-3.5 w-3.5 transition-colors", isStarred ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)] hover:text-amber-400")} />
                          </button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
            {checked.size > 0 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] bg-[var(--muted)]/30">
                <span className="text-xs text-[var(--muted-foreground)]">
                  {t("selectedCount", { selected: checked.size })}
                </span>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  title={showOnlySelected ? t("showAll") : t("showSelected")}
                >
                  <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
                </Button>
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious onClick={() => setPage(Math.max(1, safePage - 1))} className={cn("cursor-pointer", safePage === 1 && "pointer-events-none opacity-50")} />
                  </PaginationItem>
                  {paginationPages.map((p, i) =>
                    p === "ellipsis" ? (
                      <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
                    ) : (
                      <PaginationItem key={p}><PaginationLink onClick={() => setPage(p)} isActive={p === safePage} className="cursor-pointer">{p}</PaginationLink></PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext onClick={() => setPage(Math.min(totalPages, safePage + 1))} className={cn("cursor-pointer", safePage === totalPages && "pointer-events-none opacity-50")} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      )}

      {!isPerDate && !loading && perOutletTableData.length === 0 && (
        <div className="flex items-center justify-center h-64 text-sm text-[var(--muted-foreground)]">{t("noData")}</div>
      )}
    </div>
  )
}
