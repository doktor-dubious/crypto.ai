"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { RotateCcw, Trash2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCustomer } from "@/components/providers/customer-provider"
import { padsApi, salesFiltersApi, type SalesFilterResponse, type PadResponse } from "@/lib/api"
import { toast } from "sonner"
import {
  PredictionCalendar,
  type StrategyAssignment,
  type PadInfo,
  ASSIGNMENT_COLORS,
} from "@/components/predictions/prediction-calendar"
import { eachDayOfInterval, parseISO, format } from "date-fns"
import { cn } from "@/lib/utils"

// ─── Constants ───────────────────────────────────────────────────────────────

const FILTERS_PER_PAGE = 6

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dateRangeDates(from: string, to: string): string[] {
  return eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map((d) =>
    format(d, "yyyy-MM-dd")
  )
}

function filtersToAssignments(filters: SalesFilterResponse[]): StrategyAssignment[] {
  return filters.map((f, i) => ({
    id: f.id,
    dates: dateRangeDates(f.from_date, f.to_date),
    strategyId: f.id,
    strategyName: f.name,
    colorIdx: i % ASSIGNMENT_COLORS.length,
  }))
}

// ─── Grouped filter type ─────────────────────────────────────────────────────

interface GroupedFilter {
  /** All individual filter IDs in this group */
  ids: string[]
  name: string
  from_date: string
  to_date: string
}

/**
 * Group same-name filters with consecutive/overlapping date ranges into
 * consolidated entries. Filters are considered consecutive when sorted by
 * from_date and the next filter's from_date is at most 1 day after the
 * previous filter's to_date.
 */
function groupFilters(filters: SalesFilterResponse[]): GroupedFilter[] {
  if (filters.length === 0) return []

  // Sort by name, then from_date
  const sorted = [...filters].sort((a, b) =>
    a.name !== b.name ? a.name.localeCompare(b.name) : a.from_date.localeCompare(b.from_date)
  )

  const groups: GroupedFilter[] = []
  let current: GroupedFilter = {
    ids: [sorted[0].id],
    name: sorted[0].name,
    from_date: sorted[0].from_date,
    to_date: sorted[0].to_date,
  }

  for (let i = 1; i < sorted.length; i++) {
    const f = sorted[i]
    if (f.name === current.name) {
      // Check if consecutive: next from_date is at most 1 day after current to_date
      const prevEnd = new Date(current.to_date)
      const nextStart = new Date(f.from_date)
      const diffMs = nextStart.getTime() - prevEnd.getTime()
      if (diffMs <= 86_400_000) {
        // Merge: extend the range
        current.ids.push(f.id)
        if (f.to_date > current.to_date) current.to_date = f.to_date
        continue
      }
    }
    groups.push(current)
    current = { ids: [f.id], name: f.name, from_date: f.from_date, to_date: f.to_date }
  }
  groups.push(current)
  return groups
}

// ─── Dialog state types ──────────────────────────────────────────────────────

interface FilterDialogState {
  filterIds: string[]
  filterName: string
}

interface PadDialogState {
  padId: string
  padName: string
  date: string
}

// ─── localStorage helpers (scoped per customer) ─────────────────────────────

const PADS_STORAGE_PREFIX = "gorm:pads:"

function loadPadsJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${PADS_STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function savePadsJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${PADS_STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PadsFiltersPage() {
  const t = useTranslations("pads.filters")
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()
  const cid = activeCustomer?.id ?? ""

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set(loadPadsJson<string[]>(cid, "selectedDates", [])))
  const [filterName, setFilterName] = useState("")
  const [filterWarning, setFilterWarning] = useState<string | null>(null)
  const [padButtonWarning, setPadButtonWarning] = useState<string | null>(null)
  const [filterPage, setFilterPage] = useState(0)
  const [navigateToDate, setNavigateToDate] = useState<{ year: number; month: number } | null>(null)

  // Dialog state
  const [filterDialog, setFilterDialog] = useState<FilterDialogState | null>(null)
  const [padDialog, setPadDialog] = useState<PadDialogState | null>(null)
  const [applyPadOpen, setApplyPadOpen] = useState(false)
  const [newPadName, setNewPadName] = useState("")
  const [newPadWarning, setNewPadWarning] = useState<string | null>(null)
  const [existingPadId, setExistingPadId] = useState("")
  const [existingPadWarning, setExistingPadWarning] = useState<string | null>(null)

  // ─── Persist state to localStorage ─────────────────────────────────────────

  useEffect(() => { if (cid) savePadsJson(cid, "selectedDates", [...selectedDates]) }, [cid, selectedDates])

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setSelectedDates(new Set(loadPadsJson<string[]>(cid, "selectedDates", [])))
    }
    prevCidRef.current = cid
  }, [cid])

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const { data: pads = [] } = useQuery({
    queryKey: ["pads", activeCustomer?.id],
    queryFn: () => padsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const { data: filters = [] } = useQuery({
    queryKey: ["sales-filters", activeCustomer?.id],
    queryFn: () => salesFiltersApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  // ─── Derived ────────────────────────────────────────────────────────────────

  const padInfos: PadInfo[] = useMemo(
    () =>
      pads.map((p) => ({
        id: p.id,
        name: p.name,
        dates: p.dates.map((d) => d.date),
      })),
    [pads]
  )

  const filterAssignments = useMemo(() => filtersToAssignments(filters), [filters])

  // Group same-name consecutive filters into ranges, sorted by to_date descending
  const groupedFilters = useMemo(
    () => groupFilters(filters).sort((a, b) => b.to_date.localeCompare(a.to_date)),
    [filters]
  )

  // Sort pads by most recent date descending
  const sortedPads = useMemo(() => {
    return [...pads]
      .map((p) => {
        const maxDate = p.dates.length > 0
          ? [...p.dates].sort((a, b) => b.date.localeCompare(a.date))[0].date
          : ""
        return { pad: p, maxDate }
      })
      .sort((a, b) => b.maxDate.localeCompare(a.maxDate))
      .map((x) => x.pad)
  }, [pads])

  // Pagination
  const totalFilterPages = Math.max(1, Math.ceil(groupedFilters.length / FILTERS_PER_PAGE))
  const clampedPage = Math.min(filterPage, totalFilterPages - 1)
  const pagedFilters = groupedFilters.slice(
    clampedPage * FILTERS_PER_PAGE,
    (clampedPage + 1) * FILTERS_PER_PAGE
  )

  // Color map for grouped filters (first ID used as group key)
  const filterColorMap = useMemo(() => {
    const map = new Map<string, string>()
    groupedFilters.forEach((g, i) => {
      const color = ASSIGNMENT_COLORS[i % ASSIGNMENT_COLORS.length].bar
      for (const id of g.ids) map.set(id, color)
    })
    return map
  }, [groupedFilters])

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const createFilterMutation = useMutation({
    mutationFn: () => {
      if (!activeCustomer) throw new Error("No customer")
      const sortedDates = [...selectedDates].sort()
      return salesFiltersApi.create({
        customer_id: activeCustomer.id,
        name: filterName.trim(),
        from_date: sortedDates[0],
        to_date: sortedDates[sortedDates.length - 1],
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sales-filters", activeCustomer?.id] })
      toast.success(t("toastCreated", { name: data.name }))
      setSelectedDates(new Set())
      setFilterName("")
      setFilterWarning(null)
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const createPadMutation = useMutation({
    mutationFn: () => {
      if (!activeCustomer) throw new Error("No customer")
      return padsApi.create({
        customer_id: activeCustomer.id,
        name: newPadName.trim(),
        dates: [...selectedDates].sort(),
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pads", activeCustomer?.id] })
      toast.success(t("toastPadCreated", { name: data.name }))
      setSelectedDates(new Set())
      setNewPadName("")
      setNewPadWarning(null)
      setApplyPadOpen(false)
    },
    onError: () => toast.error(t("toastPadCreateError")),
  })

  const addDatesMutation = useMutation({
    mutationFn: (padId: string) => padsApi.addDates(padId, [...selectedDates].sort()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pads", activeCustomer?.id] })
      toast.success(t("toastPadDatesAdded", { name: data.name }))
      setSelectedDates(new Set())
      setExistingPadId("")
      setExistingPadWarning(null)
      setApplyPadOpen(false)
    },
    onError: () => toast.error(t("toastPadDatesAddError")),
  })

  const deleteFilterMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await salesFiltersApi.delete(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-filters", activeCustomer?.id] })
      toast.success(t("toastDeleted"))
      setFilterDialog(null)
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  const removePadDateMutation = useMutation({
    mutationFn: ({ padId, date }: { padId: string; date: string }) =>
      padsApi.removeDate(padId, date),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pads", activeCustomer?.id] })
      toast.success(t("toastPadDateRemoved"))
      setPadDialog(null)
    },
    onError: () => toast.error(t("toastPadDateRemoveError")),
  })

  const deletePadMutation = useMutation({
    mutationFn: (padId: string) => padsApi.delete(padId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pads", activeCustomer?.id] })
      toast.success(t("toastPadDeleted"))
      setPadDialog(null)
    },
    onError: () => toast.error(t("toastPadDeleteError")),
  })

  // ─── Actions ────────────────────────────────────────────────────────────────

  function handleApplyFilter() {
    if (selectedDates.size === 0) {
      setFilterWarning(t("warnNoDates"))
      return
    }
    if (!filterName.trim()) {
      setFilterWarning(t("warnNoName"))
      return
    }
    setFilterWarning(null)
    createFilterMutation.mutate()
  }

  function handleOpenApplyPad() {
    if (selectedDates.size === 0) {
      setPadButtonWarning(t("warnNoDates"))
      return
    }
    if (selectedDates.size > 1) {
      setPadButtonWarning(t("warnSingleDate"))
      return
    }
    setPadButtonWarning(null)
    setNewPadName("")
    setNewPadWarning(null)
    setExistingPadId("")
    setExistingPadWarning(null)
    setApplyPadOpen(true)
  }

  function handleCreateNewPad() {
    if (!newPadName.trim()) {
      setNewPadWarning(t("padWarnNoName"))
      return
    }
    setNewPadWarning(null)
    createPadMutation.mutate()
  }

  function handleAddToExistingPad() {
    if (!existingPadId) {
      setExistingPadWarning(t("padWarnNoSelection"))
      return
    }
    setExistingPadWarning(null)
    addDatesMutation.mutate(existingPadId)
  }

  function handleSelectedDatesChange(dates: Set<string>) {
    setSelectedDates(dates)
    if (dates.size > 0) {
      setFilterWarning(null)
      setPadButtonWarning(null)
    }
  }

  function handleFilterClick(filter: GroupedFilter) {
    const date = parseISO(filter.from_date)
    setNavigateToDate({ year: date.getFullYear(), month: date.getMonth() + 1 })
  }

  function handlePadClick(pad: PadInfo) {
    if (pad.dates.length === 0) return
    const todayStr = format(new Date(), "yyyy-MM-dd")
    const sorted = [...pad.dates].sort((a, b) => b.localeCompare(a))
    // Most recent date that is not after today, or fall back to the most recent overall
    const target = sorted.find((d) => d <= todayStr) ?? sorted[0]
    const date = parseISO(target)
    setNavigateToDate({ year: date.getFullYear(), month: date.getMonth() + 1 })
  }

  const isPadDialogPending = removePadDateMutation.isPending || deletePadMutation.isPending

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex h-full gap-0 -m-6 overflow-hidden">
        {/* ── Left: Filters panel ── */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden bg-background border-r">
          {/* Create filter form */}
          <div className="px-3 py-3 border-b shrink-0 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("filterNameLabel")}
            </p>
            <Input
              placeholder={t("filterNamePlaceholder")}
              value={filterName}
              onChange={(e) => {
                setFilterName(e.target.value)
                if (e.target.value.trim()) setFilterWarning(null)
              }}
              className="h-8 text-xs"
            />
            {filterWarning && (
              <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {filterWarning}
              </div>
            )}
            <Button
              variant="default"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={handleApplyFilter}
              disabled={createFilterMutation.isPending}
            >
              {createFilterMutation.isPending ? t("applying") : t("applyButton")}
            </Button>
          </div>

          {/* Existing filters list */}
          <div className="flex flex-col overflow-hidden flex-1">
            <div className="px-3 py-2 border-b shrink-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("existingFilters")}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {groupedFilters.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-xs text-muted-foreground">{t("noFilters")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {pagedFilters.map((group) => {
                    const color = filterColorMap.get(group.ids[0]) ?? ASSIGNMENT_COLORS[0].bar
                    return (
                      <div
                        key={group.ids[0]}
                        className="flex items-center gap-2 px-3 py-2.5 group cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleFilterClick(group)}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{group.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {group.from_date === group.to_date
                              ? group.from_date
                              : `${group.from_date} – ${group.to_date}`}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setFilterDialog({ filterIds: group.ids, filterName: group.name })
                          }}
                          className={cn(
                            "shrink-0 text-muted-foreground transition-colors cursor-pointer",
                            "opacity-0 group-hover:opacity-100 hover:text-destructive"
                          )}
                          aria-label={t("deleteFilter")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalFilterPages > 1 && (
              <div className="px-3 py-2 border-t shrink-0 flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={clampedPage === 0}
                  onClick={() => setFilterPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  {clampedPage + 1} / {totalFilterPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={clampedPage >= totalFilterPages - 1}
                  onClick={() => setFilterPage((p) => Math.min(totalFilterPages - 1, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ── Center: Calendar ── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 bg-background">
            <span className="text-xs text-muted-foreground">
              {selectedDates.size > 0
                ? `${selectedDates.size} ${selectedDates.size === 1 ? "date" : "dates"} selected`
                : "Click, shift-click, or drag to select dates"}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedDates(new Set())}
              className="h-7 text-xs gap-1.5"
            >
              <RotateCcw className="h-3 w-3" />
              {t("clearSelection")}
            </Button>
          </div>

          {/* Calendar */}
          <div className="flex-1 overflow-hidden">
            <PredictionCalendar
              pads={padInfos}
              assignments={filterAssignments}
              selectedDates={selectedDates}
              onSelectedDatesChange={handleSelectedDatesChange}
              onPadChipClick={(padId, padName, date) => setPadDialog({ padId, padName, date })}
              onBarClick={(filterId, filterName) => {
                // Find the group containing this filter ID to delete all grouped entries
                const group = groupedFilters.find((g) => g.ids.includes(filterId))
                setFilterDialog({ filterIds: group?.ids ?? [filterId], filterName })
              }}
              navigateToDate={navigateToDate}
            />
          </div>
        </div>

        {/* ── Right: Pads panel ── */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden bg-background border-l">
          {/* Apply Pad button */}
          <div className="px-3 py-3 border-b shrink-0 flex flex-col gap-2">
            <Button
              variant="default"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={handleOpenApplyPad}
            >
              {t("applyPadButton")}
            </Button>
            {padButtonWarning && (
              <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {padButtonWarning}
              </div>
            )}
          </div>

          {/* Custom Pads list */}
          <div className="flex flex-col overflow-hidden flex-1">
            <div className="px-3 py-2 border-b shrink-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("customPads")}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {sortedPads.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-xs text-muted-foreground">{t("noPads")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {sortedPads.map((pad) => {
                    const dateCount = pad.dates.length
                    const sorted = dateCount > 0
                      ? [...pad.dates].sort((a, b) => a.date.localeCompare(b.date))
                      : []
                    const earliest = sorted[0]?.date ?? null
                    const latest = sorted[sorted.length - 1]?.date ?? null
                    return (
                      <div
                        key={pad.id}
                        className="flex items-center gap-2 px-3 py-2.5 group cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() =>
                          handlePadClick({ id: pad.id, name: pad.name, dates: pad.dates.map((d) => d.date) })
                        }
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{pad.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {dateCount === 0
                              ? t("noDates")
                              : dateCount === 1
                                ? earliest
                                : `${earliest} – ${latest}`}
                          </p>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {dateCount} {dateCount === 1 ? t("datesSingular") : t("datesPlural")}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Filter delete dialog ── */}
      <Dialog open={!!filterDialog} onOpenChange={(o) => !o && setFilterDialog(null)}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("filterDeleteTitle")}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {t("filterDeleteDescription", { name: filterDialog?.filterName ?? "" })}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFilterDialog(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteFilterMutation.isPending}
              onClick={() => filterDialog && deleteFilterMutation.mutate(filterDialog.filterIds)}
            >
              {t("deleteFilter")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Apply Pad dialog ── */}
      <Dialog open={applyPadOpen} onOpenChange={(o) => !o && setApplyPadOpen(false)}>
        <DialogContent className="max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("applyPadDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("applyPadDialogDescription", { count: selectedDates.size })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-4 pt-2">
            {/* Left: New Pad Group */}
            <div className="flex-1 flex flex-col gap-3 border-r pr-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("newPadGroup")}
              </p>
              <Input
                placeholder={t("padNamePlaceholder")}
                value={newPadName}
                onChange={(e) => {
                  setNewPadName(e.target.value)
                  if (e.target.value.trim()) setNewPadWarning(null)
                }}
                className="h-8 text-xs"
              />
              {newPadWarning && (
                <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {newPadWarning}
                </div>
              )}
              <Button
                variant="default"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={handleCreateNewPad}
                disabled={createPadMutation.isPending}
              >
                {createPadMutation.isPending ? t("applyingPad") : t("newPadButton")}
              </Button>
            </div>

            {/* Right: Existing Pad Group */}
            <div className="flex-1 flex flex-col gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("existingPadGroup")}
              </p>
              <select
                value={existingPadId}
                onChange={(e) => {
                  setExistingPadId(e.target.value)
                  if (e.target.value) setExistingPadWarning(null)
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("selectPadPlaceholder")}</option>
                {pads.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {existingPadWarning && (
                <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {existingPadWarning}
                </div>
              )}
              <Button
                variant="default"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={handleAddToExistingPad}
                disabled={addDatesMutation.isPending}
              >
                {addDatesMutation.isPending
                  ? t("applyingPad")
                  : existingPadId
                    ? t("addDateToPad", { name: pads.find((p) => p.id === existingPadId)?.name ?? "" })
                    : t("addDateToPadDefault")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── PAD chip dialog ── */}
      <Dialog open={!!padDialog} onOpenChange={(o) => !o && setPadDialog(null)}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{padDialog?.padName}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {t("padDialogDescription", { date: padDialog?.date ?? "" })}
            </p>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-col gap-2">
            <Button
              variant="default"
              size="sm"
              disabled={isPadDialogPending}
              onClick={() =>
                padDialog &&
                removePadDateMutation.mutate({ padId: padDialog.padId, date: padDialog.date })
              }
            >
              {t("padRemoveDate", { date: padDialog?.date ?? "" })}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isPadDialogPending}
              onClick={() => padDialog && deletePadMutation.mutate(padDialog.padId)}
            >
              {t("padRemoveAll")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPadDialog(null)}>
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
