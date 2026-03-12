"use client"

import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { RotateCcw, Trash2, AlertCircle } from "lucide-react"
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
import { padsApi, salesFiltersApi, type SalesFilterResponse } from "@/lib/api"
import { toast } from "sonner"
import {
  PredictionCalendar,
  type StrategyAssignment,
  type PadInfo,
  ASSIGNMENT_COLORS,
} from "@/components/predictions/prediction-calendar"
import { eachDayOfInterval, parseISO, format } from "date-fns"
import { cn } from "@/lib/utils"

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Dialog state types ───────────────────────────────────────────────────────

interface FilterDialogState {
  filterId: string
  filterName: string
}

interface PadDialogState {
  padId: string
  padName: string
  date: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PadsFiltersPage() {
  const t = useTranslations("pads.filters")
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()

  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [filterName, setFilterName] = useState("")
  const [warning, setWarning] = useState<string | null>(null)

  // Dialog state
  const [filterDialog, setFilterDialog] = useState<FilterDialogState | null>(null)
  const [padDialog, setPadDialog] = useState<PadDialogState | null>(null)

  // ─── Data fetching ─────────────────────────────────────────────────────────

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

  // ─── Derived ───────────────────────────────────────────────────────────────

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

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
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
      setWarning(null)
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const deleteFilterMutation = useMutation({
    mutationFn: (id: string) => salesFiltersApi.delete(id),
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

  // ─── Actions ───────────────────────────────────────────────────────────────

  function handleApply() {
    if (selectedDates.size === 0) {
      setWarning(t("warnNoDates"))
      return
    }
    if (!filterName.trim()) {
      setWarning(t("warnNoName"))
      return
    }
    setWarning(null)
    createMutation.mutate()
  }

  function handleSelectedDatesChange(dates: Set<string>) {
    setSelectedDates(dates)
    if (dates.size > 0) setWarning(null)
  }

  const isPadDialogPending = removePadDateMutation.isPending || deletePadMutation.isPending

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex h-full gap-0 -m-6 overflow-hidden">
        {/* ── Left: Calendar ── */}
        <div className="flex flex-col flex-1 min-w-0 border-r overflow-hidden">
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
              onBarClick={(filterId, filterName) => setFilterDialog({ filterId, filterName })}
            />
          </div>
        </div>

        {/* ── Right: Filter panel ── */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden bg-background">
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
                if (e.target.value.trim()) setWarning(null)
              }}
              className="h-8 text-xs"
            />
            {warning && (
              <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {warning}
              </div>
            )}
            <Button
              variant="default"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={handleApply}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? t("applying") : t("applyButton")}
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
              {filters.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-xs text-muted-foreground">{t("noFilters")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {filters.map((filter, i) => {
                    const color = ASSIGNMENT_COLORS[i % ASSIGNMENT_COLORS.length].bar
                    return (
                      <div key={filter.id} className="flex items-center gap-2 px-3 py-2.5 group">
                        <div
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{filter.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {filter.from_date} – {filter.to_date}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            setFilterDialog({ filterId: filter.id, filterName: filter.name })
                          }
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
              onClick={() => filterDialog && deleteFilterMutation.mutate(filterDialog.filterId)}
            >
              {t("deleteFilter")}
            </Button>
          </DialogFooter>
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
