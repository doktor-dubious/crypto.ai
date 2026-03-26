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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCustomer } from "@/components/providers/customer-provider"
import { simulationFiltersApi, type SimulationFilterResponse } from "@/lib/api"
import { toast } from "sonner"
import {
  PredictionCalendar,
  type StrategyAssignment,
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

function filtersToAssignments(filters: SimulationFilterResponse[]): StrategyAssignment[] {
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
  ids: string[]
  name: string
  from_date: string
  to_date: string
}

function groupFilters(filters: SimulationFilterResponse[]): GroupedFilter[] {
  if (filters.length === 0) return []

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
      const prevEnd = new Date(current.to_date)
      const nextStart = new Date(f.from_date)
      const diffMs = nextStart.getTime() - prevEnd.getTime()
      if (diffMs <= 86_400_000) {
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

// ─── localStorage helpers (scoped per customer) ─────────────────────────────

const STORAGE_PREFIX = "gorm:simfilter:"

function loadJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SimulationFilterPage() {
  const t = useTranslations("simulations.filter")
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()
  const cid = activeCustomer?.id ?? ""

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set(loadJson<string[]>(cid, "selectedDates", [])))
  const [filterName, setFilterName] = useState("")
  const [filterWarning, setFilterWarning] = useState<string | null>(null)
  const [filterPage, setFilterPage] = useState(0)
  const [navigateToDate, setNavigateToDate] = useState<{ year: number; month: number } | null>(null)

  // Dialog state
  const [filterDialog, setFilterDialog] = useState<FilterDialogState | null>(null)

  // ─── Persist state to localStorage ─────────────────────────────────────────

  useEffect(() => { if (cid) saveJson(cid, "selectedDates", [...selectedDates]) }, [cid, selectedDates])

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setSelectedDates(new Set(loadJson<string[]>(cid, "selectedDates", [])))
    }
    prevCidRef.current = cid
  }, [cid])

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const { data: filters = [] } = useQuery({
    queryKey: ["simulation-filters", activeCustomer?.id],
    queryFn: () => simulationFiltersApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  // ─── Derived ────────────────────────────────────────────────────────────────

  const filterAssignments = useMemo(() => filtersToAssignments(filters), [filters])

  const groupedFilters = useMemo(
    () => groupFilters(filters).sort((a, b) => b.to_date.localeCompare(a.to_date)),
    [filters]
  )

  // Pagination
  const totalFilterPages = Math.max(1, Math.ceil(groupedFilters.length / FILTERS_PER_PAGE))
  const clampedPage = Math.min(filterPage, totalFilterPages - 1)
  const pagedFilters = groupedFilters.slice(
    clampedPage * FILTERS_PER_PAGE,
    (clampedPage + 1) * FILTERS_PER_PAGE
  )

  // Color map for grouped filters
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
      return simulationFiltersApi.create({
        customer_id: activeCustomer.id,
        name: filterName.trim(),
        from_date: sortedDates[0],
        to_date: sortedDates[sortedDates.length - 1],
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["simulation-filters", activeCustomer?.id] })
      toast.success(t("toastCreated", { name: data.name }))
      setSelectedDates(new Set())
      setFilterName("")
      setFilterWarning(null)
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const deleteFilterMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await simulationFiltersApi.delete(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["simulation-filters", activeCustomer?.id] })
      toast.success(t("toastDeleted"))
      setFilterDialog(null)
    },
    onError: () => toast.error(t("toastDeleteError")),
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

  function handleSelectedDatesChange(dates: Set<string>) {
    setSelectedDates(dates)
    if (dates.size > 0) setFilterWarning(null)
  }

  function handleFilterClick(filter: GroupedFilter) {
    const date = parseISO(filter.from_date)
    setNavigateToDate({ year: date.getFullYear(), month: date.getMonth() + 1 })
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex h-full gap-0 -m-6 overflow-hidden">
        {/* ── Left: Calendar ── */}
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
              pads={[]}
              assignments={filterAssignments}
              selectedDates={selectedDates}
              onSelectedDatesChange={handleSelectedDatesChange}
              onBarClick={(filterId, filterName) => {
                const group = groupedFilters.find((g) => g.ids.includes(filterId))
                setFilterDialog({ filterIds: group?.ids ?? [filterId], filterName })
              }}
              navigateToDate={navigateToDate}
            />
          </div>
        </div>

        {/* ── Right: Filters panel ── */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden bg-background border-l">
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
    </>
  )
}
