"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, ChevronDown, ChevronUp, ArrowUpDown, Filter, X, CalendarIcon, Focus,
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
  type ChartConfig,
} from "@/components/ui/chart"
import { LineChart, Line, CartesianGrid, XAxis, YAxis } from "recharts"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  outletGroupsApi, salesApi, customerConfigurationApi,
} from "@/lib/api"
import { ExportMenu } from "@/components/ui/export-menu"
import type { ExportColumn } from "@/lib/export"
import { cn } from "@/lib/utils"

// ─── Constants ───────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 8
type SortField = "date" | "outlet_count" | "starred"

const WEEKDAY_JS: Record<string, number[]> = {
  sun: [0], mon: [1], tue: [2], wed: [3], thu: [4], fri: [5], sat: [6],
  "mon-fri": [1, 2, 3, 4, 5],
  "mon-sat": [1, 2, 3, 4, 5, 6],
  all: [0, 1, 2, 3, 4, 5, 6],
}

const chartConfig: ChartConfig = {
  outlet_count: { label: "Outlets", color: "hsl(217 91% 60%)" },
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

interface TableDataRow {
  date: string
  outlet_count: number
}

// ─── Main Component ─────────────────────────────────────────────────────────

const SO_PREFIX = "gorm:statsOutlets:"
function loadSoV<T>(cid: string, k: string, fb: T): T { if (typeof window === "undefined") return fb; try { const r = localStorage.getItem(`${SO_PREFIX}${cid}:${k}`); return r ? JSON.parse(r) : fb } catch { return fb } }
function saveSoV(cid: string, k: string, v: unknown) { if (typeof window !== "undefined") localStorage.setItem(`${SO_PREFIX}${cid}:${k}`, JSON.stringify(v)) }

export default function StatisticsOutletsPage() {
  const t = useTranslations("statisticsOutlets")
  const { activeCustomer } = useCustomer()
  const customerId = activeCustomer?.id
  const cid = customerId ?? ""

  // ── Filters (persisted) ──────────────────────────────────────────────────
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => loadSoV<string | null>(cid, "groupId", null))
  const [weeks, setWeeks] = useState(() => loadSoV<number>(cid, "weeks", 8))
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [weekday, setWeekday] = useState<string>(() => loadSoV<string>(cid, "weekday", "all"))
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  // Info filter
  const [infoKey, setInfoKey] = useState("")
  const [infoValue, setInfoValue] = useState("")
  const [appliedInfoKey, setAppliedInfoKey] = useState("")
  const [appliedInfoValue, setAppliedInfoValue] = useState("")

  // Table state
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<SortField>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)

  // ── Persist filters ────────────────────────────────────────────────────────
  useEffect(() => { if (cid) saveSoV(cid, "groupId", selectedGroupId) }, [cid, selectedGroupId])
  useEffect(() => { if (cid) saveSoV(cid, "weeks", weeks) }, [cid, weeks])
  useEffect(() => { if (cid) saveSoV(cid, "weekday", weekday) }, [cid, weekday])
  const prevCidRef = useRef(cid)
  useEffect(() => { if (prevCidRef.current && cid && prevCidRef.current !== cid) { setSelectedGroupId(loadSoV<string | null>(cid, "groupId", null)); setWeeks(loadSoV(cid, "weeks", 8)); setWeekday(loadSoV(cid, "weekday", "all")) }; prevCidRef.current = cid }, [cid])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir(field === "date" ? "desc" : "desc")
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

  // Reuse efficiency endpoint — it returns outlet_count per date
  const { data: efficiencyData, isLoading: loading } = useQuery({
    queryKey: ["sales-efficiency", customerId, filteredOutletIds, statsStartDate, statsEndDate],
    queryFn: () =>
      salesApi.efficiency({
        customer_id: customerId!,
        outlet_ids: filteredOutletIds,
        start_date: statsStartDate,
        end_date: statsEndDate,
      }),
    enabled: !!customerId && filteredOutletIds.length > 0,
    retry: false,
  })

  // ── Chart data ───────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    if (!efficiencyData?.data) return []
    const allowed = WEEKDAY_JS[weekday] ?? WEEKDAY_JS.all
    return efficiencyData.data
      .filter((s) => allowed.includes(new Date(s.date + "T00:00:00").getDay()))
      .map((s) => ({
        date: s.date,
        outlet_count: s.outlet_count,
      }))
  }, [efficiencyData?.data, weekday])

  // ── Table data ───────────────────────────────────────────────────────────

  const tableData: TableDataRow[] = useMemo(() => chartData, [chartData])

  const filteredTable = useMemo(() => {
    let rows = tableData
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter((r) => r.date.includes(q))
    }
    if (showOnlySelected && checked.size > 0) {
      rows = rows.filter((r) => checked.has(r.date))
    }
    rows = [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      if (sortField === "starred") {
        const aS = starred.has(a.date) ? 1 : 0
        const bS = starred.has(b.date) ? 1 : 0
        return (aS - bS) * dir
      }
      if (sortField === "date") return a.date.localeCompare(b.date) * dir
      return (a.outlet_count - b.outlet_count) * dir
    })
    return rows
  }, [tableData, search, showOnlySelected, checked, sortField, sortDir, starred])

  const totalPages = Math.max(1, Math.ceil(filteredTable.length / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filteredTable.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
  const paginationPages = buildPaginationPages(safePage, totalPages)

  const allChecked = pagedRows.length > 0 && pagedRows.every((r) => checked.has(r.date))

  const toggleCheck = useCallback((date: string) => {
    setChecked((prev) => {
      const n = new Set(prev)
      n.has(date) ? n.delete(date) : n.add(date)
      return n
    })
  }, [])

  const toggleStar = useCallback((date: string) => {
    setStarred((prev) => {
      const n = new Set(prev)
      n.has(date) ? n.delete(date) : n.add(date)
      return n
    })
  }, [])

  const toggleAllChecked = useCallback(() => {
    setChecked((prev) => {
      const n = new Set(prev)
      if (allChecked) {
        pagedRows.forEach((r) => n.delete(r.date))
      } else {
        pagedRows.forEach((r) => n.add(r.date))
      }
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
      o.info
        .filter((i) => i.key === infoKey && i.value)
        .forEach((i) => vals.add(i.value!)),
    )
    return Array.from(vals).sort()
  }, [groupOutlets, infoKey])

  function applyInfoFilter() {
    setAppliedInfoKey(infoKey)
    setAppliedInfoValue(infoValue)
    setPage(1)
    setChecked(new Set())
  }

  function clearInfoFilter() {
    setInfoKey("")
    setInfoValue("")
    setAppliedInfoKey("")
    setAppliedInfoValue("")
    setPage(1)
    setChecked(new Set())
  }

  // ── Export columns ────────────────────────────────────────────────────────

  const exportColumns: ExportColumn[] = useMemo(() => [
    { header: t("date"), accessor: "date" },
    { header: t("outletCount"), accessor: (r: any) => String(r.outlet_count) },
  ], [t])

  // ── SortIcon helper ──────────────────────────────────────────────────────

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 ml-1" />
      : <ChevronDown className="h-3 w-3 ml-1" />
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const effectiveGroup = groups.find((g) => g.id === effectiveGroupId)

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px]">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-end gap-4 flex-wrap">
        {/* Outlet Group */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("outletGroup")}</label>
          <select
            value={effectiveGroupId ?? ""}
            onChange={(e) => {
              setSelectedGroupId(e.target.value || null)
              setPage(1)
              setChecked(new Set())
            }}
            className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer min-w-[200px]"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.outlet_count})
              </option>
            ))}
          </select>
        </div>

        {/* Weeks */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("period")}</label>
          <Input
            type="number"
            min={1}
            max={104}
            value={weeks}
            onChange={(e) => handleWeeksChange(Math.max(1, parseInt(e.target.value) || 8))}
            className="h-8 w-20 text-xs"
          />
        </div>

        {/* Date Range Picker */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("dateRange")}</label>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-8 justify-start text-left text-xs font-normal min-w-[220px] cursor-pointer",
                  !dateRange?.from && "text-[var(--muted-foreground)]",
                )}
              >
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "MMM d, yyyy")} – {format(dateRange.to, "MMM d, yyyy")}
                    </>
                  ) : (
                    format(dateRange.from, "MMM d, yyyy")
                  )
                ) : (
                  t("dateRangePlaceholder")
                )}
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

        {/* Weekday */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("weekday")}</label>
          <select
            value={weekday}
            onChange={(e) => {
              setWeekday(e.target.value)
              setPage(1)
            }}
            className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
          >
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

        {/* Info Filter */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("infoFilter")}</label>
          <div className="flex items-center gap-1.5">
            <select
              value={infoKey}
              onChange={(e) => {
                setInfoKey(e.target.value)
                setInfoValue("")
              }}
              className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer min-w-[120px]"
            >
              <option value="">{t("infoFilterKey")}</option>
              {availableInfoKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            {infoKey && (
              <select
                value={infoValue}
                onChange={(e) => setInfoValue(e.target.value)}
                className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer min-w-[120px]"
              >
                <option value="">{t("infoFilterValue")}</option>
                {availableInfoValues.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            )}
            {infoKey && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs cursor-pointer"
                onClick={applyInfoFilter}
              >
                <Filter className="h-3 w-3 mr-1" />
                {t("infoFilterApply")}
              </Button>
            )}
            {appliedInfoKey && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs cursor-pointer"
                onClick={clearInfoFilter}
              >
                <X className="h-3 w-3 mr-1" />
                {t("infoFilterClear")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Outlet count badge */}
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

      {/* ── Chart ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-sm text-[var(--muted-foreground)]">{t("loading")}</div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-sm text-[var(--muted-foreground)]">{t("noData")}</div>
      ) : (
        <ChartContainer config={chartConfig} className={cn("h-80 w-full aspect-auto transition-opacity duration-200", datePickerOpen && "opacity-10")}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) => {
                const d = new Date(v + "T00:00:00")
                return `${d.getMonth() + 1}/${d.getDate()}`
              }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={48}
              allowDecimals={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelKey="date"
                  formatter={(value) => String(value ?? "\u2014")}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="outlet_count"
              stroke={chartConfig.outlet_count.color}
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </LineChart>
        </ChartContainer>
      )}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div className="space-y-3">
          {/* Table toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder={t("searchPlaceholder")}
                className="pl-8 h-8 text-xs"
              />
            </div>

            <ExportMenu
              data={filteredTable}
              columns={exportColumns}
              filename={`outlets-statistics-${effectiveGroup?.name ?? "all"}`}
            />

            <span className="text-xs text-[var(--muted-foreground)] ml-auto">
              {checked.size > 0 && (
                <span className="mr-3">{t("selectedCount", { selected: checked.size })}</span>
              )}
              {t("showing", {
                from: (safePage - 1) * ITEMS_PER_PAGE + 1,
                to: Math.min(safePage * ITEMS_PER_PAGE, filteredTable.length),
                total: filteredTable.length,
              })}
            </span>
          </div>

          {/* Data table */}
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 px-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className="flex items-center cursor-pointer">
                          <Checkbox
                            checked={allChecked}
                            onCheckedChange={toggleAllChecked}
                            className="cursor-pointer"
                          />
                          <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" />
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[140px]">
                        <DropdownMenuItem onClick={toggleAllChecked} className="cursor-pointer text-xs">
                          {t("selectAll")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const n = new Set(checked)
                            filteredTable.filter((r) => starred.has(r.date)).forEach((r) => n.add(r.date))
                            setChecked(n)
                          }}
                          className="cursor-pointer text-xs"
                        >
                          {t("starred")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-xs" onClick={() => handleSort("date")}>
                    <span className="flex items-center">{t("date")}<SortIcon field="date" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleSort("outlet_count")}>
                    <span className="flex items-center justify-end">{t("outletCount")}<SortIcon field="outlet_count" /></span>
                  </TableHead>
                  <TableHead className="w-10 px-3" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-xs text-[var(--muted-foreground)] py-8">
                      {t("noResults")}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map((row) => {
                    const isChecked = checked.has(row.date)
                    const isStarred = starred.has(row.date)
                    return (
                      <TableRow
                        key={row.date}
                        className={cn(
                          "cursor-pointer",
                          isChecked && "bg-[var(--accent)]/30",
                        )}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          toggleStar(row.date)
                        }}
                      >
                        <TableCell className="px-3">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleCheck(row.date)}
                            className="cursor-pointer"
                          />
                        </TableCell>
                        <TableCell className="text-xs font-medium">{row.date}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.outlet_count}</TableCell>
                        <TableCell className="px-3">
                          <button
                            onClick={() => toggleStar(row.date)}
                            className="cursor-pointer"
                          >
                            <Star
                              className={cn(
                                "h-3.5 w-3.5 transition-colors",
                                isStarred
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-[var(--muted-foreground)] hover:text-amber-400",
                              )}
                            />
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setPage(Math.max(1, safePage - 1))}
                      className={cn("cursor-pointer", safePage === 1 && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                  {paginationPages.map((p, i) =>
                    p === "ellipsis" ? (
                      <PaginationItem key={`e-${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
                        <PaginationLink
                          onClick={() => setPage(p)}
                          isActive={p === safePage}
                          className="cursor-pointer"
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                      className={cn("cursor-pointer", safePage === totalPages && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
