"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  CalendarIcon, ChevronDown, ChevronRight, ChevronUp, Info, Star,
  ArrowUpDown, Focus, Sparkles, Loader2,
} from "lucide-react"
import { differenceInCalendarDays, format } from "date-fns"
import type { DateRange } from "react-day-picker"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { cohortAuditApi, type CohortResult, type CohortOutletStat, type CohortSkipEvent } from "@/lib/api"
import { MarkdownContent } from "@/components/insights/markdown-content"
import { cn } from "@/lib/utils"

interface Props {
  customerId: string
  active: boolean
}

const DEFAULT_WEEKS = 13
const ITEMS_PER_PAGE = 10

const SS_PREFIX = "gorm:cohortAudit:"
function loadSs<T>(cid: string, k: string, fb: T): T {
  if (typeof window === "undefined") return fb
  try {
    const r = localStorage.getItem(`${SS_PREFIX}${cid}:${k}`)
    return r ? JSON.parse(r) : fb
  } catch { return fb }
}
function saveSs(cid: string, k: string, v: unknown) {
  if (typeof window !== "undefined")
    localStorage.setItem(`${SS_PREFIX}${cid}:${k}`, JSON.stringify(v))
}

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// ─── Shared table helpers ───────────────────────────────────────────────────

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function SortHeader<F extends string>(
  { field, label, sortField, sortDir, onSort, align = "left" }: {
    field: F
    label: React.ReactNode
    sortField: F
    sortDir: "asc" | "desc"
    onSort: (field: F) => void
    align?: "left" | "right" | "center"
  },
) {
  const active = sortField === field
  return (
    <button
      onClick={() => onSort(field)}
      className={cn(
        "flex items-center gap-1 font-medium hover:text-foreground transition-colors w-full",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
      )}
    >
      <span>{label}</span>
      {active ? (
        sortDir === "asc"
          ? <ChevronUp className="h-3 w-3" />
          : <ChevronDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )
}

function CheckHeaderCell<T>(
  { allItems, pageItems, selectedIds, setSelectedIds, starredIds, getId, t, extraItems }: {
    allItems: T[]
    pageItems: T[]
    selectedIds: Set<string>
    setSelectedIds: (s: Set<string>) => void
    starredIds: Set<string>
    getId: (item: T) => string
    t: (key: string) => string
    extraItems?: { label: string; filter: (item: T) => boolean }[]
  },
) {
  const allPageSelected =
    pageItems.length > 0 && pageItems.every((it) => selectedIds.has(getId(it)))
  const somePageSelected = pageItems.some((it) => selectedIds.has(getId(it)))
  function handleHeaderCheckbox() {
    const n = new Set(selectedIds)
    if (allPageSelected) {
      pageItems.forEach((it) => n.delete(getId(it)))
    } else {
      pageItems.forEach((it) => n.add(getId(it)))
    }
    setSelectedIds(n)
  }
  return (
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
          <DropdownMenuItem
            onClick={() => setSelectedIds(new Set(allItems.map(getId)))}
          >
            {t("tableSelectAll")}
          </DropdownMenuItem>
          {extraItems?.map((item) => (
            <DropdownMenuItem
              key={item.label}
              onClick={() =>
                setSelectedIds(
                  new Set(allItems.filter(item.filter).map(getId)),
                )
              }
            >
              {item.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() =>
              setSelectedIds(
                new Set(allItems.filter((it) => starredIds.has(getId(it))).map(getId)),
              )
            }
          >
            {t("tableStarred")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function StarHeaderCell<F extends string>(
  { field, sortField, sortDir, onSort }: {
    field: F
    sortField: F
    sortDir: "asc" | "desc"
    onSort: (field: F) => void
  },
) {
  const active = sortField === field
  return (
    <button
      onClick={() => onSort(field)}
      className="flex items-center gap-1 font-medium hover:text-foreground transition-colors mx-auto cursor-pointer"
    >
      <Star className={cn("h-4 w-4", active ? "" : "opacity-40")} />
      {active && (sortDir === "asc"
        ? <ChevronUp className="h-3 w-3" />
        : <ChevronDown className="h-3 w-3" />)}
    </button>
  )
}

function StarCell(
  { id, starredIds, onToggle, t }: {
    id: string
    starredIds: Set<string>
    onToggle: (id: string) => void
    t: (key: string) => string
  },
) {
  const starred = starredIds.has(id)
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(id) }}
      className="hover:text-amber-400 transition-colors cursor-pointer"
      aria-label={t("tableToggleStar")}
    >
      <Star
        className={cn(
          "h-4 w-4",
          starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
        )}
      />
    </button>
  )
}

function TableFooter(
  { page, setPage, totalItems, selectedIds, setSelectedIds: _set,
    showOnlySelected, setShowOnlySelected, showingKey, selectedKey, t }: {
    page: number
    setPage: (p: number) => void
    totalItems: number
    selectedIds: Set<string>
    setSelectedIds: (s: Set<string>) => void
    showOnlySelected: boolean
    setShowOnlySelected: (v: boolean) => void
    showingKey: string
    selectedKey: string
    t: (key: string, vars?: Record<string, string | number>) => string
  },
) {
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const from = totalItems === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1
  const to = Math.min(safePage * ITEMS_PER_PAGE, totalItems)
  const pages = buildPaginationPages(safePage, totalPages)
  return (
    <div className="border-t border-[var(--border)]">
      {totalItems > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-xs text-[var(--muted-foreground)]">
            {t(showingKey, { from, to, total: totalItems })}
          </span>
          {totalPages > 1 && (
            <Pagination className="w-auto mx-0">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage(Math.max(1, safePage - 1))}
                    className={cn("cursor-pointer", safePage === 1 && "pointer-events-none opacity-50")}
                  />
                </PaginationItem>
                {pages.map((p, i) => p === "ellipsis" ? (
                  <PaginationItem key={`e${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={safePage === p}
                      onClick={() => setPage(p)}
                      className="cursor-pointer"
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                    className={cn("cursor-pointer", safePage === totalPages && "pointer-events-none opacity-50")}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)] bg-[var(--muted)]/30">
          <span className="text-xs text-[var(--muted-foreground)]">
            {t(selectedKey, { selected: selectedIds.size, total: totalItems })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() => setShowOnlySelected(!showOnlySelected)}
            title={showOnlySelected ? t("tableShowAll") : t("tableShowOnlySelected")}
          >
            <Focus className={cn("h-4 w-4", showOnlySelected && "text-[var(--primary)]")} />
          </Button>
        </div>
      )}
    </div>
  )
}

function useTableState() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [page, setPage] = useState(1)
  const toggleStar = (id: string) =>
    setStarredIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  const toggleSelected = (id: string, checked: boolean) =>
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (checked) n.add(id); else n.delete(id)
      return n
    })
  return {
    selectedIds, setSelectedIds,
    starredIds, setStarredIds, toggleStar,
    showOnlySelected, setShowOnlySelected,
    page, setPage,
    toggleSelected,
  }
}

// ─── Main tab ────────────────────────────────────────────────────────────────

export function CohortTab({ customerId, active }: Props) {
  const t = useTranslations("salesAnalysis")

  // Settings (persisted)
  const [infoKey, setInfoKey] = useState<string>(
    () => loadSs(customerId, "infoKey", ""),
  )
  const [selectedValues, setSelectedValues] = useState<string[] | null>(
    () => loadSs<string[] | null>(customerId, "infoValues", null),
  )
  const [sequenced, setSequenced] = useState<boolean>(
    () => loadSs(customerId, "sequenced", false),
  )
  const [sharedDriver, setSharedDriver] = useState<boolean>(
    () => loadSs(customerId, "sharedDriver", false),
  )
  const [weeks, setWeeks] = useState<number>(
    () => loadSs(customerId, "weeks", DEFAULT_WEEKS),
  )
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const saved = loadSs<{ from?: string; to?: string } | null>(
      customerId, "dateRange", null,
    )
    if (saved?.from) {
      return {
        from: new Date(saved.from + "T00:00:00"),
        to: saved.to ? new Date(saved.to + "T00:00:00") : undefined,
      }
    }
    return undefined
  })
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null)

  useEffect(() => { if (customerId) saveSs(customerId, "infoKey", infoKey) }, [customerId, infoKey])
  useEffect(() => { if (customerId) saveSs(customerId, "infoValues", selectedValues) }, [customerId, selectedValues])
  useEffect(() => { if (customerId) saveSs(customerId, "sequenced", sequenced) }, [customerId, sequenced])
  useEffect(() => { if (customerId) saveSs(customerId, "sharedDriver", sharedDriver) }, [customerId, sharedDriver])
  useEffect(() => { if (customerId) saveSs(customerId, "weeks", weeks) }, [customerId, weeks])
  useEffect(() => {
    if (customerId) {
      saveSs(customerId, "dateRange", dateRange?.from ? {
        from: format(dateRange.from, "yyyy-MM-dd"),
        to: dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined,
      } : null)
    }
  }, [customerId, dateRange])

  // Effective window: explicit date range overrides weeks-back-from-today.
  const endDate = useMemo(() => {
    if (dateRange?.to) return format(dateRange.to, "yyyy-MM-dd")
    return new Date().toISOString().slice(0, 10)
  }, [dateRange?.to])
  const startDate = useMemo(() => {
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
  }
  function handleWeeksChange(newWeeks: number) {
    setWeeks(newWeeks)
    setDateRange(undefined)
  }

  // Available info keys
  const { data: keysData } = useQuery({
    queryKey: ["cohort-keys", customerId],
    queryFn: () => cohortAuditApi.keys(customerId),
    enabled: !!customerId && active,
    staleTime: 5 * 60 * 1000,
  })

  // Available values for selected key
  const { data: valuesData } = useQuery({
    queryKey: ["cohort-values", customerId, infoKey],
    queryFn: () => cohortAuditApi.values(customerId, infoKey),
    enabled: !!customerId && !!infoKey && active,
    staleTime: 5 * 60 * 1000,
  })

  // Audit results
  const auditEnabled =
    !!customerId && !!infoKey && !!startDate && !!endDate && active
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "cohort-audit", customerId, infoKey, startDate, endDate,
      selectedValues, sequenced, sharedDriver,
    ],
    queryFn: () => cohortAuditApi.audit({
      customer_id: customerId,
      outlet_info_key: infoKey,
      start_date: startDate,
      end_date: endDate,
      outlet_info_values: selectedValues,
      sequenced,
      shared_driver: sharedDriver,
    }),
    enabled: auditEnabled,
    staleTime: 60 * 1000,
  })

  const cohortMap = useMemo(() => {
    const m = new Map<string, CohortResult>()
    data?.cohorts.forEach((c) => m.set(c.cohort_value, c))
    return m
  }, [data])

  const drillCohort = selectedCohort ? cohortMap.get(selectedCohort) : null

  return (
    <div className="flex flex-col gap-6 pt-4">
      {/* Selection toolbar */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("cohortGroupingHeading")}</h3>
        <div className="flex items-end gap-4 flex-wrap">
          {/* Weeks */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--muted-foreground)]">
              {t("period")}
            </label>
            <Input
              type="number"
              min={1}
              max={520}
              value={weeks}
              onChange={(e) => handleWeeksChange(Math.max(1, parseInt(e.target.value) || DEFAULT_WEEKS))}
              className="h-8 w-20 text-xs"
            />
          </div>

          {/* Date Range Picker */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--muted-foreground)]">
              {t("dateRange")}
            </label>
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
                        {format(dateRange.from, "MMM d, yyyy")} &ndash; {format(dateRange.to, "MMM d, yyyy")}
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
                <div className="flex gap-0">
                  <Calendar
                    mode="range"
                    captionLayout="dropdown"
                    defaultMonth={dateRange?.from ?? new Date(new Date().getFullYear(), new Date().getMonth() - 1)}
                    selected={dateRange}
                    onSelect={handleDateRangeChange}
                    numberOfMonths={1}
                    startMonth={new Date(2020, 0)}
                    endMonth={new Date(new Date().getFullYear() + 1, 11)}
                  />
                  <Calendar
                    mode="range"
                    captionLayout="dropdown"
                    defaultMonth={dateRange?.to ?? new Date()}
                    selected={dateRange}
                    onSelect={handleDateRangeChange}
                    numberOfMonths={1}
                    startMonth={new Date(2020, 0)}
                    endMonth={new Date(new Date().getFullYear() + 1, 11)}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Key dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--muted-foreground)]">
              {t("cohortKey")}
            </label>
            <select
              value={infoKey}
              onChange={(e) => {
                setInfoKey(e.target.value)
                setSelectedValues(null)
                setSelectedCohort(null)
              }}
              className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer min-w-[180px]"
            >
              <option value="">{t("cohortKeyPlaceholder")}</option>
              {keysData?.keys.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.key} ({k.outlet_count})
                </option>
              ))}
            </select>
          </div>

          {/* Values multi-select */}
          {infoKey && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--muted-foreground)]">
                {t("cohortValues")}
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 justify-between text-xs font-normal min-w-[220px] cursor-pointer"
                  >
                    {!selectedValues || selectedValues.length === 0
                      ? t("cohortAllValues")
                      : selectedValues.length === valuesData?.values.length
                        ? t("cohortAllValues")
                        : t("cohortNValuesSelected", { n: selectedValues.length })}
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2 max-h-[360px] overflow-auto">
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-[var(--border)]">
                    <button
                      onClick={() => setSelectedValues(null)}
                      className="text-xs text-[var(--primary)] hover:underline cursor-pointer"
                    >
                      {t("cohortSelectAll")}
                    </button>
                    <button
                      onClick={() => setSelectedValues([])}
                      className="text-xs text-[var(--muted-foreground)] hover:underline cursor-pointer"
                    >
                      {t("cohortSelectNone")}
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {valuesData?.values.map((v) => {
                      const isSelected =
                        !selectedValues || selectedValues.includes(v.value)
                      return (
                        <label
                          key={v.value}
                          className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-[var(--accent)] cursor-pointer"
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              const all = valuesData.values.map((x) => x.value)
                              const current = selectedValues ?? all
                              if (checked) {
                                const next = [...current, v.value]
                                setSelectedValues(
                                  next.length === all.length ? null : next,
                                )
                              } else {
                                setSelectedValues(
                                  current.filter((x) => x !== v.value),
                                )
                              }
                            }}
                          />
                          <span className="font-mono">{v.value}</span>
                          <span className="text-[var(--muted-foreground)] ml-auto">
                            {v.outlet_count}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Characteristics toggles */}
          {infoKey && (
            <div className="flex items-center gap-4 ml-auto">
              <div className="flex items-center gap-2">
                <Switch
                  id="cohort-sequenced"
                  checked={sequenced}
                  onCheckedChange={setSequenced}
                  className="cursor-pointer"
                />
                <Label
                  htmlFor="cohort-sequenced"
                  className="text-xs cursor-pointer inline-flex items-center gap-1"
                >
                  {t("cohortSequenced")}
                  <span title={t("cohortSequencedHelp")}>
                    <Info className="h-3 w-3 text-[var(--muted-foreground)]" />
                  </span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="cohort-shared"
                  checked={sharedDriver}
                  onCheckedChange={setSharedDriver}
                  className="cursor-pointer"
                />
                <Label
                  htmlFor="cohort-shared"
                  className="text-xs cursor-pointer inline-flex items-center gap-1"
                >
                  {t("cohortSharedDriver")}
                  <span title={t("cohortSharedDriverHelp")}>
                    <Info className="h-3 w-3 text-[var(--muted-foreground)]" />
                  </span>
                </Label>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Status / errors */}
      {!infoKey && (
        <div className="text-xs text-[var(--muted-foreground)] py-8 text-center">
          {t("cohortPickKey")}
        </div>
      )}
      {isLoading && (
        <div className="text-xs text-[var(--muted-foreground)] py-8 text-center">
          {t("loading")}
        </div>
      )}
      {isError && (
        <div className="text-xs text-red-500 py-4">
          {String((error as Error).message)}
        </div>
      )}

      {data && (
        <>
          {/* Summary */}
          <section className="flex items-center gap-4 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-[var(--muted-foreground)] uppercase inline-flex items-center gap-1">
                {t("cohortUniverse")}
                <span title={t("cohortUniverseHelp")}>
                  <Info className="h-3 w-3" />
                </span>
              </span>
              <span className="text-sm tabular-nums">
                {data.universe_size} {t("outlets").toLowerCase()}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-[var(--muted-foreground)] uppercase inline-flex items-center gap-1">
                {t("cohortWithSignal")}
                <span title={t("cohortWithSignalHelp")}>
                  <Info className="h-3 w-3" />
                </span>
              </span>
              <span className="text-sm tabular-nums">
                {data.cohorts_with_signal} / {data.cohorts.length}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-[var(--muted-foreground)] uppercase inline-flex items-center gap-1">
                {t("cohortWindow")}
                <span title={t("cohortWindowHelp")}>
                  <Info className="h-3 w-3" />
                </span>
              </span>
              <span className="text-xs tabular-nums">
                {data.skip_detection_window.start_date}
                {" → "}
                {data.skip_detection_window.end_date}
              </span>
            </div>
            {/* No-report chip: shown low-key when present */}
            {data.cohorts.some((c) => c.no_report_count > 0) && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-[var(--muted-foreground)] uppercase inline-flex items-center gap-1">
                  {t("cohortNoReport")}
                  <span title={t("cohortNoReportHelp")}>
                    <Info className="h-3 w-3" />
                  </span>
                </span>
                <span className="text-sm tabular-nums text-[var(--muted-foreground)]">
                  {data.cohorts.reduce((s, c) => s + c.no_report_count, 0)}
                </span>
              </div>
            )}
            {data.notes.length > 0 && (
              <div className="ml-auto flex flex-col gap-1 max-w-[480px]">
                {data.notes.map((n, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] text-[var(--muted-foreground)]"
                  >
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{n}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Cohort comparison table */}
          {data.cohorts.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              {t("cohortNoCohorts")}
            </div>
          ) : (
            <CohortComparisonTable
              cohorts={data.cohorts}
              infoKey={infoKey}
              selectedCohort={selectedCohort}
              setSelectedCohort={setSelectedCohort}
              t={t}
            />
          )}

          {/* Drill-down */}
          {drillCohort && (
            <CohortDrillDown
              cohort={drillCohort}
              t={t}
              customerId={customerId}
              cohortKey={infoKey}
              sequenced={sequenced}
              sharedDriver={sharedDriver}
              startDate={startDate}
              endDate={endDate}
            />
          )}
        </>
      )}
    </div>
  )
}

// ─── Cohort comparison table ────────────────────────────────────────────────

type CohortSortField =
  | "cohort_value" | "outlet_count" | "skip_event_count" | "total_skip_observations"
  | "overall_skip_rate" | "tcs" | "tcs_p_value" | "top_weekday"
  | "starred"

function CohortComparisonTable(
  { cohorts, infoKey, selectedCohort, setSelectedCohort, t }: {
    cohorts: CohortResult[]
    infoKey: string
    selectedCohort: string | null
    setSelectedCohort: (v: string | null) => void
    t: (key: string, vars?: Record<string, string | number>) => string
  },
) {
  const {
    selectedIds, setSelectedIds, starredIds, toggleStar,
    showOnlySelected, setShowOnlySelected, page, setPage, toggleSelected,
  } = useTableState()

  const [sortField, setSortField] = useState<CohortSortField>("cohort_value")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  function handleSort(field: CohortSortField) {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("asc") }
    setPage(1)
  }

  // Reset state when cohort universe changes (different infoKey)
  useEffect(() => {
    setSelectedIds(new Set())
    setShowOnlySelected(false)
    setPage(1)
  }, [infoKey, setSelectedIds, setShowOnlySelected, setPage])

  const filtered = useMemo(() => {
    const items = showOnlySelected
      ? cohorts.filter((c) => selectedIds.has(c.cohort_value))
      : cohorts
    const dir = sortDir === "asc" ? 1 : -1
    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "cohort_value": va = a.cohort_value; vb = b.cohort_value; break
        case "outlet_count": va = a.outlet_count; vb = b.outlet_count; break
        case "skip_event_count": va = a.skip_event_count; vb = b.skip_event_count; break
        case "total_skip_observations":
          va = a.total_skip_observations; vb = b.total_skip_observations; break
        case "overall_skip_rate": va = a.overall_skip_rate; vb = b.overall_skip_rate; break
        case "tcs": va = a.tcs ?? -1; vb = b.tcs ?? -1; break
        case "tcs_p_value":
          va = a.tcs_p_value ?? Number.POSITIVE_INFINITY
          vb = b.tcs_p_value ?? Number.POSITIVE_INFINITY; break
        case "top_weekday":
          va = a.top_weekday ?? -1; vb = b.top_weekday ?? -1; break
        case "starred":
          va = starredIds.has(a.cohort_value) ? 1 : 0
          vb = starredIds.has(b.cohort_value) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return cmp * dir
    })
  }, [cohorts, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  return (
    <section>
      <h3 className="text-sm font-medium mb-2">
        {t("cohortComparisonHeading", { key: infoKey })}
      </h3>
      <p className="text-xs text-[var(--muted-foreground)] mb-3">
        {t("cohortComparisonDesc")}
      </p>
      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs w-12 pl-3">
                <CheckHeaderCell
                  allItems={cohorts}
                  pageItems={pageItems}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  starredIds={starredIds}
                  getId={(c) => c.cohort_value}
                  t={t}
                  extraItems={[
                    {
                      label: t("tableSelectSkipEvents"),
                      filter: (c) => {
                        const sig = c.tcs != null
                          && c.tcs_p_value != null
                          && c.tcs_p_value < 0.05
                          && c.tcs > 0.3
                        return !sig && c.skip_event_count >= 5
                      },
                    },
                  ]}
                />
              </TableHead>
              <TableHead className="text-xs w-8" />
              <TableHead className="text-xs">
                <SortHeader<CohortSortField>
                  field="cohort_value" label={t("cohortValueCol")}
                  sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<CohortSortField>
                  field="outlet_count" label={t("cohortOutletCount")}
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<CohortSortField>
                  field="skip_event_count"
                  label={
                    <span title={t("cohortEventCountHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortEventCount")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<CohortSortField>
                  field="total_skip_observations"
                  label={
                    <span title={t("cohortSkipObsHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortSkipObs")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<CohortSortField>
                  field="overall_skip_rate"
                  label={
                    <span title={t("cohortSkipRateHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortSkipRate")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<CohortSortField>
                  field="tcs"
                  label={
                    <span title={t("cohortTcsHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortTcs")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<CohortSortField>
                  field="tcs_p_value"
                  label={
                    <span title={t("cohortPValueHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortPValue")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-center">
                <SortHeader<CohortSortField>
                  field="top_weekday"
                  label={
                    <span title={t("cohortTopWeekdayHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortTopWeekday")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center"
                />
              </TableHead>
              <TableHead className="text-xs text-center">
                <span title={t("cohortVerdictHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                  {t("cohortVerdict")}
                </span>
              </TableHead>
              <TableHead className="text-xs w-10 text-center">
                <StarHeaderCell<CohortSortField>
                  field="starred" sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map((c) => {
              const isOpen = selectedCohort === c.cohort_value
              const sig = c.tcs != null
                && c.tcs_p_value != null
                && c.tcs_p_value < 0.05
                && c.tcs > 0.3
              return (
                <TableRow
                  key={c.cohort_value}
                  className={cn("cursor-pointer", isOpen && "bg-[var(--accent)]")}
                  onClick={() => setSelectedCohort(isOpen ? null : c.cohort_value)}
                  onContextMenu={(e) => { e.preventDefault(); toggleStar(c.cohort_value) }}
                >
                  <TableCell className="pl-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(c.cohort_value)}
                      onCheckedChange={(v) => toggleSelected(c.cohort_value, !!v)}
                    />
                  </TableCell>
                  <TableCell className="text-xs">
                    {isOpen
                      ? <ChevronDown className="h-3.5 w-3.5" />
                      : <ChevronRight className="h-3.5 w-3.5" />}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{c.cohort_value}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{c.outlet_count}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{c.skip_event_count}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{c.total_skip_observations}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {(c.overall_skip_rate * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {c.tcs != null
                      ? c.tcs.toFixed(3)
                      : <span className="text-[var(--muted-foreground)]">&mdash;</span>}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {c.tcs_p_value != null
                      ? c.tcs_p_value.toFixed(3)
                      : <span className="text-[var(--muted-foreground)]">&mdash;</span>}
                  </TableCell>
                  <TableCell className="text-xs text-center">
                    {c.top_weekday != null
                      ? WEEKDAY_LABELS[c.top_weekday]
                      : <span className="text-[var(--muted-foreground)]">&mdash;</span>}
                  </TableCell>
                  <TableCell className="text-xs text-center">
                    {sig ? (
                      <Badge variant="destructive" className="text-[10px]" title={t("cohortTailSignalHelp")}>
                        {t("cohortTailSignal")}
                      </Badge>
                    ) : c.skip_event_count >= 5 ? (
                      <Badge variant="secondary" className="text-[10px]" title={t("cohortIssuesHelp")}>
                        {t("cohortIssues")}
                      </Badge>
                    ) : (
                      <span className="text-[var(--muted-foreground)] text-[10px]" title={t("cohortCleanHelp")}>
                        {t("cohortClean")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                    <StarCell
                      id={c.cohort_value}
                      starredIds={starredIds}
                      onToggle={toggleStar}
                      t={t}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <TableFooter
          page={safePage}
          setPage={setPage}
          totalItems={filtered.length}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          showOnlySelected={showOnlySelected}
          setShowOnlySelected={setShowOnlySelected}
          showingKey="tableShowingCohorts"
          selectedKey="tableSelectedCohorts"
          t={t}
        />
      </div>
    </section>
  )
}

// ─── Drill-down ─────────────────────────────────────────────────────────────

function CohortDrillDown({
  cohort,
  t,
  customerId,
  cohortKey,
  sequenced,
  sharedDriver,
  startDate,
  endDate,
}: {
  cohort: CohortResult
  t: (key: string, vars?: Record<string, string | number>) => string
  customerId: string
  cohortKey: string
  sequenced: boolean
  sharedDriver: boolean
  startDate: string
  endDate: string
}) {
  const tailIds = useMemo(() =>
    new Set(cohort.inferred_tail_outlets ?? []),
    [cohort.inferred_tail_outlets])

  // AI investigation state — per-cohort, reset when the cohort changes.
  const [aiResponse, setAiResponse] = useState("")
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [hasInvestigated, setHasInvestigated] = useState(false)
  const responseRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Reset when the cohort selection changes.
  useEffect(() => {
    abortRef.current?.abort()
    setAiResponse("")
    setAiError(null)
    setAiLoading(false)
    setHasInvestigated(false)
  }, [cohort.cohort_value, customerId])

  // Cancel any in-flight stream when the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Auto-scroll the response panel as text streams in.
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight
    }
  }, [aiResponse])

  const doInvestigate = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setHasInvestigated(true)
    setAiResponse("")
    setAiError(null)
    setAiLoading(true)
    try {
      await cohortAuditApi.investigate(
        {
          customer_id: customerId,
          cohort_key: cohortKey,
          cohort,
          sequenced,
          shared_driver: sharedDriver,
          start_date: startDate,
          end_date: endDate,
        },
        (chunk) => setAiResponse((prev) => prev + chunk),
        controller.signal,
      )
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setAiError(
          err instanceof Error ? err.message : "Investigation failed",
        )
      }
    } finally {
      setAiLoading(false)
    }
  }, [
    cohort, customerId, cohortKey, sequenced, sharedDriver,
    startDate, endDate,
  ])

  function doStop() {
    abortRef.current?.abort()
    setAiLoading(false)
  }

  return (
    <section className="flex flex-col gap-4 border-t border-[var(--border)] pt-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-medium">
            {t("cohortDrillHeading", { value: cohort.cohort_value })}
          </h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            {cohort.outlet_count} {t("outlets").toLowerCase()},{" "}
            <span title={t("cohortEventCountHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
              {cohort.skip_event_count} {t("cohortEventsLabel")}
            </span>
            ,{" "}
            <span title={t("cohortSkipObsHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
              {cohort.total_skip_observations} {t("cohortSkipObsLabel")}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {cohort.tcs != null && (
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-[var(--muted-foreground)] uppercase">
                {t("cohortTcs")}
              </span>
              <span className="tabular-nums">
                {cohort.tcs.toFixed(3)}
                {cohort.tcs_p_value != null && (
                  <span className="text-[var(--muted-foreground)] ml-1">
                    (p={cohort.tcs_p_value.toFixed(3)})
                  </span>
                )}
              </span>
            </div>
          )}
          {sequenced && cohort.sequence_confidence && (
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-[var(--muted-foreground)] uppercase">
                {t("cohortSeqConfidence")}
              </span>
              <span className="text-xs capitalize">{cohort.sequence_confidence}</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs cursor-pointer"
            onClick={aiLoading ? doStop : doInvestigate}
            disabled={!customerId}
            title={t("cohortInvestigateHelp")}
          >
            {aiLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {aiLoading
              ? t("cohortInvestigateStop")
              : hasInvestigated
                ? t("cohortInvestigateRerun")
                : t("cohortInvestigate")}
          </Button>
        </div>
      </div>

      {/* AI narrative panel — appears once the user triggers it. */}
      {hasInvestigated && (
        <div className="flex flex-col gap-1.5 border border-[var(--border)] rounded-lg p-3 bg-[var(--accent)]/40">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            {t("cohortInvestigateTitle")}
          </div>
          <div
            ref={responseRef}
            className="text-sm leading-relaxed max-h-[300px] overflow-y-auto"
          >
            {aiLoading && !aiResponse && (
              <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("cohortInvestigateLoading")}
              </div>
            )}
            {aiResponse && (
              <MarkdownContent>
                {
                  aiLoading
                    ? `${aiResponse}█`
                    : aiResponse
                }
              </MarkdownContent>
            )}
            {aiError && (
              <div className="text-red-500 mt-2 text-xs">{aiError}</div>
            )}
          </div>
        </div>
      )}

      {/* Weekday distribution */}
      {cohort.weekday_distribution.some((v) => v > 0) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">{t("cohortWeekdayDist")}</span>
          <div className="flex items-end gap-2">
            {cohort.weekday_distribution.map((count, i) => {
              const max = Math.max(...cohort.weekday_distribution, 1)
              const pct = (count / max) * 100
              return (
                <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                  <span className="text-[10px] tabular-nums">{count}</span>
                  <div className="h-12 w-full bg-[var(--accent)] rounded relative overflow-hidden">
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-[var(--primary)] opacity-60"
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {WEEKDAY_LABELS[i + 1]}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Inferred tail */}
      {sequenced && cohort.inferred_tail_outlets && cohort.inferred_tail_outlets.length > 0 && (
        <div className="flex flex-col gap-2 border border-[var(--border)] rounded-lg p-3 bg-[var(--accent)] bg-opacity-30">
          <span className="text-xs font-medium">{t("cohortInferredTailHeading")}</span>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {t("cohortInferredTailDesc")}
          </p>
          <ol className="list-decimal pl-5 text-xs space-y-0.5">
            {cohort.inferred_tail_outlets.map((oid) => {
              const o = cohort.outlets.find((x) => x.outlet_id === oid)
              if (!o) return null
              return (
                <li key={oid} className="tabular-nums">
                  <span className="font-mono">{o.ext_id}</span>{" "}
                  <span className="text-[var(--muted-foreground)]">
                    {o.outlet_name}
                  </span>{" "}
                  <span className="text-[var(--muted-foreground)]">
                    — skipped {o.skip_count} of {o.active_open_days}
                    {" "}({(o.skip_rate * 100).toFixed(1)}%)
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {/* Per-outlet table */}
      <PerOutletTable
        cohortKey={cohort.cohort_value}
        outlets={cohort.outlets}
        tailIds={tailIds}
        sequenced={sequenced}
        t={t}
      />

      {/* Skip events list */}
      {cohort.skip_events.length > 0 && (
        <SkipEventsTable
          cohortKey={cohort.cohort_value}
          events={cohort.skip_events}
          t={t}
        />
      )}
    </section>
  )
}

// ─── Per-outlet skip stats table ─────────────────────────────────────────────

type OutletSortField =
  | "rank" | "ext_id" | "outlet_name" | "skip_count" | "above_floor_skip_count"
  | "active_open_days" | "skip_rate" | "no_report_count"
  | "inferred_sequence_rank" | "starred"

function PerOutletTable(
  { cohortKey, outlets, tailIds, sequenced, t }: {
    cohortKey: string
    outlets: CohortOutletStat[]
    tailIds: Set<string>
    sequenced: boolean
    t: (key: string, vars?: Record<string, string | number>) => string
  },
) {
  const {
    selectedIds, setSelectedIds, starredIds, toggleStar,
    showOnlySelected, setShowOnlySelected, page, setPage, toggleSelected,
  } = useTableState()

  const [sortField, setSortField] = useState<OutletSortField>("rank")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  function handleSort(field: OutletSortField) {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("asc") }
    setPage(1)
  }

  // Reset state when cohort changes
  useEffect(() => {
    setSelectedIds(new Set())
    setShowOnlySelected(false)
    setPage(1)
  }, [cohortKey, setSelectedIds, setShowOnlySelected, setPage])

  const filtered = useMemo(() => {
    const items = showOnlySelected
      ? outlets.filter((o) => selectedIds.has(o.outlet_id))
      : outlets
    const dir = sortDir === "asc" ? 1 : -1
    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "rank": va = a.rank; vb = b.rank; break
        case "ext_id": va = a.ext_id; vb = b.ext_id; break
        case "outlet_name": va = a.outlet_name; vb = b.outlet_name; break
        case "skip_count": va = a.skip_count; vb = b.skip_count; break
        case "above_floor_skip_count":
          va = a.above_floor_skip_count; vb = b.above_floor_skip_count; break
        case "active_open_days": va = a.active_open_days; vb = b.active_open_days; break
        case "skip_rate": va = a.skip_rate; vb = b.skip_rate; break
        case "no_report_count": va = a.no_report_count; vb = b.no_report_count; break
        case "inferred_sequence_rank":
          va = a.inferred_sequence_rank ?? Number.POSITIVE_INFINITY
          vb = b.inferred_sequence_rank ?? Number.POSITIVE_INFINITY; break
        case "starred":
          va = starredIds.has(a.outlet_id) ? 1 : 0
          vb = starredIds.has(b.outlet_id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return cmp * dir
    })
  }, [outlets, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium">{t("cohortOutletsHeading")}</span>
      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs w-12 pl-3">
                <CheckHeaderCell
                  allItems={outlets}
                  pageItems={pageItems}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  starredIds={starredIds}
                  getId={(o) => o.outlet_id}
                  t={t}
                />
              </TableHead>
              <TableHead className="text-xs w-10">
                <SortHeader<OutletSortField>
                  field="rank" label="#"
                  sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-xs">
                <SortHeader<OutletSortField>
                  field="ext_id" label={t("accountId")}
                  sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-xs">
                <SortHeader<OutletSortField>
                  field="outlet_name" label={t("outlet")}
                  sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<OutletSortField>
                  field="skip_count"
                  label={
                    <span title={t("cohortSkipCountHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortSkipCount")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<OutletSortField>
                  field="above_floor_skip_count"
                  label={
                    <span title={t("cohortAboveFloorHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortAboveFloor")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<OutletSortField>
                  field="active_open_days"
                  label={
                    <span title={t("cohortExpectedDaysHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortExpectedDays")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<OutletSortField>
                  field="skip_rate"
                  label={
                    <span title={t("cohortSkipRateHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortSkipRate")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<OutletSortField>
                  field="no_report_count"
                  label={
                    <span title={t("cohortNoReportCountHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                      {t("cohortNoReportCount")}
                    </span>
                  }
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              {sequenced && (
                <TableHead className="text-xs text-right">
                  <SortHeader<OutletSortField>
                    field="inferred_sequence_rank"
                    label={
                      <span title={t("cohortTailRankHelp")} className="cursor-help underline decoration-dotted decoration-from-font">
                        {t("cohortTailRank")}
                      </span>
                    }
                    sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                  />
                </TableHead>
              )}
              <TableHead className="text-xs w-10 text-center">
                <StarHeaderCell<OutletSortField>
                  field="starred" sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map((o) => {
              const isTail = tailIds.has(o.outlet_id)
              // Above-floor pattern: an outlet whose skips are
              // overwhelmingly above-floor and not just a handful. This
              // is a per-outlet signal — independent of cohort-level
              // TCS, which can miss outlets like 7221 whose skips don't
              // co-occur with the rest of the route.
              const isAboveFloorPattern = o.skip_count >= 5
                && o.above_floor_skip_count / o.skip_count >= 0.8
              return (
                <TableRow
                  key={o.outlet_id}
                  className={cn(isTail && "bg-red-50 dark:bg-red-950/20")}
                  onContextMenu={(e) => { e.preventDefault(); toggleStar(o.outlet_id) }}
                >
                  <TableCell className="pl-3">
                    <Checkbox
                      checked={selectedIds.has(o.outlet_id)}
                      onCheckedChange={(v) => toggleSelected(o.outlet_id, !!v)}
                    />
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">{o.rank}</TableCell>
                  <TableCell className="text-xs font-mono">{o.ext_id}</TableCell>
                  <TableCell className="text-xs">
                    <div className="flex items-center gap-2">
                      <span>{o.outlet_name}</span>
                      {isAboveFloorPattern && (
                        <Badge
                          variant="destructive"
                          className="text-[9px] h-4 px-1.5 leading-none"
                          title={t("cohortAboveFloorPatternHelp")}
                        >
                          {t("cohortAboveFloorPattern")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {o.skip_count}
                  </TableCell>
                  <TableCell className={cn(
                    "text-xs text-right tabular-nums",
                    o.above_floor_skip_count > 0
                      ? "font-medium"
                      : "text-[var(--muted-foreground)]",
                  )}>
                    {o.above_floor_skip_count}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums text-[var(--muted-foreground)]">
                    {o.active_open_days}
                  </TableCell>
                  <TableCell className={cn(
                    "text-xs text-right tabular-nums",
                    o.skip_rate > 0.1 && "text-red-500",
                  )}>
                    {(o.skip_rate * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums text-[var(--muted-foreground)]">
                    {o.no_report_count || ""}
                  </TableCell>
                  {sequenced && (
                    <TableCell className="text-xs text-right tabular-nums">
                      {o.inferred_sequence_rank ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <StarCell
                      id={o.outlet_id}
                      starredIds={starredIds}
                      onToggle={toggleStar}
                      t={t}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <TableFooter
          page={safePage}
          setPage={setPage}
          totalItems={filtered.length}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          showOnlySelected={showOnlySelected}
          setShowOnlySelected={setShowOnlySelected}
          showingKey="tableShowingOutlets"
          selectedKey="tableSelectedOutlets"
          t={t}
        />
      </div>
    </div>
  )
}

// ─── Skip events table ───────────────────────────────────────────────────────

type EventSortField =
  | "date" | "weekday" | "skipped_count" | "starred"

function SkipEventsTable(
  { cohortKey, events, t }: {
    cohortKey: string
    events: CohortSkipEvent[]
    t: (key: string, vars?: Record<string, string | number>) => string
  },
) {
  const {
    selectedIds, setSelectedIds, starredIds, toggleStar,
    showOnlySelected, setShowOnlySelected, page, setPage, toggleSelected,
  } = useTableState()

  const [sortField, setSortField] = useState<EventSortField>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  function handleSort(field: EventSortField) {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir(field === "date" ? "desc" : "asc") }
    setPage(1)
  }

  // Reset state when cohort changes
  useEffect(() => {
    setSelectedIds(new Set())
    setShowOnlySelected(false)
    setPage(1)
  }, [cohortKey, setSelectedIds, setShowOnlySelected, setPage])

  const filtered = useMemo(() => {
    const items = showOnlySelected
      ? events.filter((e) => selectedIds.has(e.date))
      : events
    const dir = sortDir === "asc" ? 1 : -1
    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "date": va = a.date; vb = b.date; break
        case "weekday": va = a.weekday; vb = b.weekday; break
        case "skipped_count": va = a.skipped_count; vb = b.skipped_count; break
        case "starred":
          va = starredIds.has(a.date) ? 1 : 0
          vb = starredIds.has(b.date) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return cmp * dir
    })
  }, [events, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium">{t("cohortSkipEventsHeading")}</span>
      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs w-12 pl-3">
                <CheckHeaderCell
                  allItems={events}
                  pageItems={pageItems}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  starredIds={starredIds}
                  getId={(e) => e.date}
                  t={t}
                />
              </TableHead>
              <TableHead className="text-xs">
                <SortHeader<EventSortField>
                  field="date" label={t("date")}
                  sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-xs">
                <SortHeader<EventSortField>
                  field="weekday" label={t("weekday")}
                  sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-xs text-right">
                <SortHeader<EventSortField>
                  field="skipped_count" label={t("cohortSkippedCount")}
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right"
                />
              </TableHead>
              <TableHead className="text-xs w-10 text-center">
                <StarHeaderCell<EventSortField>
                  field="starred" sortField={sortField} sortDir={sortDir} onSort={handleSort}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map((ev) => (
              <TableRow
                key={ev.date}
                onContextMenu={(e) => { e.preventDefault(); toggleStar(ev.date) }}
              >
                <TableCell className="pl-3">
                  <Checkbox
                    checked={selectedIds.has(ev.date)}
                    onCheckedChange={(v) => toggleSelected(ev.date, !!v)}
                  />
                </TableCell>
                <TableCell className="text-xs font-mono">{ev.date}</TableCell>
                <TableCell className="text-xs">{WEEKDAY_LABELS[ev.weekday]}</TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {ev.skipped_count}
                </TableCell>
                <TableCell className="text-center">
                  <StarCell
                    id={ev.date}
                    starredIds={starredIds}
                    onToggle={toggleStar}
                    t={t}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableFooter
          page={safePage}
          setPage={setPage}
          totalItems={filtered.length}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          showOnlySelected={showOnlySelected}
          setShowOnlySelected={setShowOnlySelected}
          showingKey="tableShowingEvents"
          selectedKey="tableSelectedEvents"
          t={t}
        />
      </div>
    </div>
  )
}
