"use client"

import { useState, useMemo, useEffect, useRef } from "react"
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
import {
  predictionAdjustmentsApi,
  outletGroupsApi,
  AdjustmentType,
  type PredictionAdjustmentResponse,
} from "@/lib/api"
import { toast } from "sonner"
import {
  PredictionCalendar,
  type StrategyAssignment,
  ASSIGNMENT_COLORS,
} from "@/components/predictions/prediction-calendar"
import { eachDayOfInterval, parseISO, format } from "date-fns"
import { cn } from "@/lib/utils"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dateRangeDates(from: string, to: string): string[] {
  return eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map((d) =>
    format(d, "yyyy-MM-dd")
  )
}

function adjustmentsToAssignments(adjustments: PredictionAdjustmentResponse[]): StrategyAssignment[] {
  return adjustments.map((a, i) => ({
    id: a.id,
    dates: dateRangeDates(a.start_date, a.end_date),
    strategyId: a.id,
    strategyName: a.name,
    colorIdx: i % ASSIGNMENT_COLORS.length,
  }))
}

const ADJUSTMENT_TYPE_KEYS: Record<AdjustmentType, string> = {
  [AdjustmentType.PER_OUTLET_BY_NUMBER]: "typePerOutletNumber",
  [AdjustmentType.PER_OUTLET_BY_PERCENTAGE]: "typePerOutletPct",
  [AdjustmentType.OVERALL_BY_NUMBER]: "typeOverallNumber",
  [AdjustmentType.OVERALL_BY_PERCENTAGE]: "typeOverallPct",
}

// ─── Dialog state types ──────────────────────────────────────────────────────

interface DeleteDialogState {
  id: string
  name: string
}

// ─── Component ───────────────────────────────────────────────────────────────

// ─── localStorage helpers (scoped per customer) ─────────────────────────────

const ADJ_STORAGE_PREFIX = "gorm:predAdjustments:"

function loadAdjJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${ADJ_STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveAdjJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${ADJ_STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

export default function PredictionAdjustmentsPage() {
  const t = useTranslations("predictionAdjustments")
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()
  const cid = activeCustomer?.id ?? ""

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set(loadAdjJson<string[]>(cid, "selectedDates", [])))
  const [navigateToDate, setNavigateToDate] = useState<{ year: number; month: number } | null>(null)

  // Form state
  const [adjName, setAdjName] = useState("")
  const [adjGroupId, setAdjGroupId] = useState("")
  const [adjType, setAdjType] = useState<AdjustmentType>(AdjustmentType.PER_OUTLET_BY_NUMBER)
  const [adjValue, setAdjValue] = useState("")
  const [formWarning, setFormWarning] = useState<string | null>(null)

  // Dialog state
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null)

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const { data: adjustments = [] } = useQuery({
    queryKey: ["prediction-adjustments", activeCustomer?.id],
    queryFn: () => predictionAdjustmentsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const { data: outletGroups = [] } = useQuery({
    queryKey: ["outlet-groups", activeCustomer?.id],
    queryFn: () => outletGroupsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  // ─── Persist state to localStorage ─────────────────────────────────────────

  useEffect(() => { if (cid) saveAdjJson(cid, "selectedDates", [...selectedDates]) }, [cid, selectedDates])

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setSelectedDates(new Set(loadAdjJson<string[]>(cid, "selectedDates", [])))
    }
    prevCidRef.current = cid
  }, [cid])

  // ─── Derived ────────────────────────────────────────────────────────────────

  const assignments = useMemo(() => adjustmentsToAssignments(adjustments), [adjustments])

  // Color map for consistent colors in list vs calendar
  const colorMap = useMemo(() => {
    const map = new Map<string, string>()
    adjustments.forEach((a, i) => {
      map.set(a.id, ASSIGNMENT_COLORS[i % ASSIGNMENT_COLORS.length].bar)
    })
    return map
  }, [adjustments])

  // Group name lookup
  const groupNameMap = useMemo(() => {
    const map = new Map<string, string>()
    outletGroups.forEach((g) => map.set(g.id, g.name))
    return map
  }, [outletGroups])

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () => {
      const sortedDates = [...selectedDates].sort()
      return predictionAdjustmentsApi.create({
        group_id: adjGroupId,
        name: adjName.trim(),
        start_date: sortedDates[0],
        end_date: sortedDates[sortedDates.length - 1],
        type: adjType,
        value: parseFloat(adjValue),
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["prediction-adjustments", activeCustomer?.id] })
      toast.success(t("toastCreated", { name: data.name }))
      setSelectedDates(new Set())
      setAdjName("")
      setAdjValue("")
      setFormWarning(null)
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => predictionAdjustmentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prediction-adjustments", activeCustomer?.id] })
      toast.success(t("toastDeleted"))
      setDeleteDialog(null)
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  // ─── Actions ────────────────────────────────────────────────────────────────

  function handleApply() {
    if (selectedDates.size === 0) {
      setFormWarning(t("warnNoDates"))
      return
    }
    if (!adjName.trim()) {
      setFormWarning(t("warnNoName"))
      return
    }
    if (!adjGroupId) {
      setFormWarning(t("warnNoGroup"))
      return
    }
    if (!adjValue || isNaN(parseFloat(adjValue))) {
      setFormWarning(t("warnNoValue"))
      return
    }
    setFormWarning(null)
    createMutation.mutate()
  }

  function handleSelectedDatesChange(dates: Set<string>) {
    setSelectedDates(dates)
    if (dates.size > 0) setFormWarning(null)
  }

  function handleAdjustmentClick(adj: PredictionAdjustmentResponse) {
    const date = parseISO(adj.start_date)
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
                : t("calendarHint")}
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
              assignments={assignments}
              selectedDates={selectedDates}
              onSelectedDatesChange={handleSelectedDatesChange}
              onBarClick={(id, name) => setDeleteDialog({ id, name })}
              navigateToDate={navigateToDate}
            />
          </div>
        </div>

        {/* ── Right: Adjustment panel ── */}
        <div className="w-80 shrink-0 flex flex-col overflow-hidden bg-background border-l">
          {/* Form */}
          <div className="px-3 py-3 border-b shrink-0 flex flex-col gap-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("nameLabel")}
            </p>
            <Input
              placeholder={t("namePlaceholder")}
              value={adjName}
              onChange={(e) => {
                setAdjName(e.target.value)
                if (e.target.value.trim()) setFormWarning(null)
              }}
              className="h-8 text-xs"
            />

            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("outletGroupLabel")}
            </p>
            <select
              value={adjGroupId}
              onChange={(e) => {
                setAdjGroupId(e.target.value)
                if (e.target.value) setFormWarning(null)
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t("outletGroupPlaceholder")}</option>
              {outletGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>

            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("typeLabel")}
            </p>
            <select
              value={adjType}
              onChange={(e) => setAdjType(Number(e.target.value) as AdjustmentType)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {Object.values(AdjustmentType)
                .filter((v) => typeof v === "number")
                .map((v) => (
                  <option key={v} value={v}>
                    {t(ADJUSTMENT_TYPE_KEYS[v as AdjustmentType])}
                  </option>
                ))}
            </select>

            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("valueLabel")}
            </p>
            <Input
              type="number"
              placeholder={
                adjType === AdjustmentType.PER_OUTLET_BY_PERCENTAGE ||
                adjType === AdjustmentType.OVERALL_BY_PERCENTAGE
                  ? t("valuePlaceholderPct")
                  : t("valuePlaceholderNum")
              }
              value={adjValue}
              onChange={(e) => {
                setAdjValue(e.target.value)
                if (e.target.value) setFormWarning(null)
              }}
              className="h-8 text-xs"
            />

            {formWarning && (
              <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {formWarning}
              </div>
            )}

            <Button
              variant="default"
              size="sm"
              className="w-full h-8 text-xs mt-1"
              onClick={handleApply}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? t("applying") : t("applyButton")}
            </Button>
          </div>

          {/* Existing adjustments list */}
          <div className="flex flex-col overflow-hidden flex-1">
            <div className="px-3 py-2 border-b shrink-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("existingAdjustments")}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {adjustments.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-xs text-muted-foreground">{t("noAdjustments")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {adjustments.map((adj) => {
                    const color = colorMap.get(adj.id) ?? ASSIGNMENT_COLORS[0].bar
                    return (
                      <div
                        key={adj.id}
                        className="flex items-center gap-2 px-3 py-2.5 group cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleAdjustmentClick(adj)}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{adj.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {groupNameMap.get(adj.group_id) ?? "—"} · {t(ADJUSTMENT_TYPE_KEYS[adj.type])}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {adj.start_date} – {adj.end_date}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteDialog({ id: adj.id, name: adj.name })
                          }}
                          className={cn(
                            "shrink-0 text-muted-foreground transition-colors cursor-pointer",
                            "opacity-0 group-hover:opacity-100 hover:text-destructive"
                          )}
                          aria-label={t("deleteAdjustment")}
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

      {/* ── Delete dialog ── */}
      <Dialog open={!!deleteDialog} onOpenChange={(o) => !o && setDeleteDialog(null)}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {t("deleteDescription", { name: deleteDialog?.name ?? "" })}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteDialog(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
            >
              {t("deleteAdjustment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
