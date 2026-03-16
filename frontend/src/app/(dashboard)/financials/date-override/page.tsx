"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { RotateCcw, Trash2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  financialDatesApi,
  outletGroupsApi,
  type FinancialDateResponse,
} from "@/lib/api"
import { toast } from "sonner"
import {
  PredictionCalendar,
  type StrategyAssignment,
  ASSIGNMENT_COLORS,
} from "@/components/predictions/prediction-calendar"
import { parseISO } from "date-fns"
import { cn } from "@/lib/utils"

// ─── Constants ──────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
]

const selectClass =
  "h-8 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"

// ─── Helpers ────────────────────────────────────────────────────────────────

function financialDatesToAssignments(dates: FinancialDateResponse[]): StrategyAssignment[] {
  return dates.map((d, i) => ({
    id: d.id,
    dates: [d.date],
    strategyId: d.id,
    strategyName: d.name,
    colorIdx: i % ASSIGNMENT_COLORS.length,
  }))
}

// ─── Dialog state ───────────────────────────────────────────────────────────

interface DeleteDialogState {
  id: string
  name: string
}

// ─── Component ──────────────────────────────────────────────────────────────

const FDO_PREFIX = "gorm:finDateOverride:"
function loadFdoJson<T>(cid: string, key: string, fb: T): T { if (typeof window === "undefined") return fb; try { const r = localStorage.getItem(`${FDO_PREFIX}${cid}:${key}`); return r ? JSON.parse(r) : fb } catch { return fb } }
function saveFdoJson(cid: string, key: string, v: unknown) { if (typeof window !== "undefined") localStorage.setItem(`${FDO_PREFIX}${cid}:${key}`, JSON.stringify(v)) }

export default function FinancialDateOverridePage() {
  const t = useTranslations("financialDateOverride")
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()
  const cid = activeCustomer?.id ?? ""

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set(loadFdoJson<string[]>(cid, "selectedDates", [])))
  const [navigateToDate, setNavigateToDate] = useState<{ year: number; month: number } | null>(null)

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null)

  // Create form state
  const [fdName, setFdName] = useState("")
  const [fdDescription, setFdDescription] = useState("")
  const [fdOutletGroupId, setFdOutletGroupId] = useState("")
  const [fdMethod, setFdMethod] = useState<0 | 1>(0) // 0=copy, 1=fixed
  const [fdCopyFromWeekday, setFdCopyFromWeekday] = useState<number>(1)
  const [fdCostPerUnit, setFdCostPerUnit] = useState("")
  const [fdProfitPerUnit, setFdProfitPerUnit] = useState("")
  const [formWarning, setFormWarning] = useState<string | null>(null)

  // ─── Persist ───────────────────────────────────────────────────────────────
  useEffect(() => { if (cid) saveFdoJson(cid, "selectedDates", [...selectedDates]) }, [cid, selectedDates])
  const prevCidRef = useRef(cid)
  useEffect(() => { if (prevCidRef.current && cid && prevCidRef.current !== cid) setSelectedDates(new Set(loadFdoJson<string[]>(cid, "selectedDates", []))); prevCidRef.current = cid }, [cid])

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const { data: financialDates = [] } = useQuery({
    queryKey: ["financial-dates", activeCustomer?.id],
    queryFn: () => financialDatesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const { data: outletGroups = [] } = useQuery({
    queryKey: ["outlet-groups", activeCustomer?.id],
    queryFn: () => outletGroupsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  // ─── Derived ──────────────────────────────────────────────────────────────

  const assignments = useMemo(() => financialDatesToAssignments(financialDates), [financialDates])

  const colorMap = useMemo(() => {
    const map = new Map<string, string>()
    financialDates.forEach((d, i) => {
      map.set(d.id, ASSIGNMENT_COLORS[i % ASSIGNMENT_COLORS.length].bar)
    })
    return map
  }, [financialDates])

  // ─── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeCustomer) throw new Error("No customer")
      const dates = [...selectedDates].sort()
      const results = []
      for (const date of dates) {
        results.push(
          await financialDatesApi.create({
            customer_id: activeCustomer.id,
            name: fdName.trim(),
            description: fdDescription.trim() || null,
            date,
            method: fdMethod,
            copy_from_weekday: fdMethod === 0 ? fdCopyFromWeekday : null,
            cost_per_unit: fdMethod === 1 ? (fdCostPerUnit ? parseFloat(fdCostPerUnit) : null) : null,
            profit_per_unit: fdMethod === 1 ? (fdProfitPerUnit ? parseFloat(fdProfitPerUnit) : null) : null,
            outlet_group_id: fdOutletGroupId || null,
          })
        )
      }
      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial-dates", activeCustomer?.id] })
      toast.success(t("toastCreated", { name: fdName.trim() }))
      setSelectedDates(new Set())
      resetForm()
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => financialDatesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial-dates", activeCustomer?.id] })
      toast.success(t("toastDeleted"))
      setDeleteDialog(null)
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  // ─── Actions ──────────────────────────────────────────────────────────────

  function resetForm() {
    setCreateOpen(false)
    setFdName("")
    setFdDescription("")
    setFdOutletGroupId("")
    setFdMethod(0)
    setFdCopyFromWeekday(1)
    setFdCostPerUnit("")
    setFdProfitPerUnit("")
    setFormWarning(null)
  }

  function handleOpenCreateDialog() {
    if (selectedDates.size === 0) {
      setFormWarning(t("warnNoDates"))
      return
    }
    setFormWarning(null)
    setCreateOpen(true)
  }

  function handleSave() {
    if (!fdName.trim()) {
      setFormWarning(t("warnNoName"))
      return
    }
    if (!fdOutletGroupId) {
      setFormWarning(t("warnNoOutletGroup"))
      return
    }
    if (fdMethod === 0 && !fdCopyFromWeekday) {
      setFormWarning(t("warnNoWeekday"))
      return
    }
    setFormWarning(null)
    createMutation.mutate()
  }

  function handleSelectedDatesChange(dates: Set<string>) {
    setSelectedDates(dates)
    if (dates.size > 0) setFormWarning(null)
  }

  function handleDateClick(fd: FinancialDateResponse) {
    const date = parseISO(fd.date)
    setNavigateToDate({ year: date.getFullYear(), month: date.getMonth() + 1 })
  }

  // ─── Render ───────────────────────────────────────────────────────────────

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

        {/* ── Right: Actions panel ── */}
        <div className="w-80 shrink-0 flex flex-col overflow-hidden bg-background border-l">
          {/* Apply button + warning */}
          <div className="px-3 py-3 border-b shrink-0 flex flex-col gap-2.5">
            {formWarning && !createOpen && (
              <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {formWarning}
              </div>
            )}

            <Button
              variant="default"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={handleOpenCreateDialog}
            >
              {t("applyButton")}
            </Button>
          </div>

          {/* Existing date overrides list */}
          <div className="flex flex-col overflow-hidden flex-1">
            <div className="px-3 py-2 border-b shrink-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("existingOverrides")}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {financialDates.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-xs text-muted-foreground">{t("noOverrides")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {financialDates.map((fd) => {
                    const color = colorMap.get(fd.id) ?? ASSIGNMENT_COLORS[0].bar
                    return (
                      <div
                        key={fd.id}
                        className="flex items-center gap-2 px-3 py-2.5 group cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleDateClick(fd)}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{fd.name}</p>
                          {fd.description && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              {fd.description}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground">
                            {fd.date}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteDialog({ id: fd.id, name: fd.name })
                          }}
                          className={cn(
                            "shrink-0 text-muted-foreground transition-colors cursor-pointer",
                            "opacity-0 group-hover:opacity-100 hover:text-destructive"
                          )}
                          aria-label={t("deleteOverride")}
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

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) resetForm() }}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {/* Name */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">{t("nameLabel")}</label>
              <Input
                placeholder={t("namePlaceholder")}
                value={fdName}
                onChange={(e) => {
                  setFdName(e.target.value)
                  if (e.target.value.trim()) setFormWarning(null)
                }}
                className="h-8 text-xs"
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">{t("descriptionLabel")}</label>
              <Textarea
                placeholder={t("descriptionPlaceholder")}
                value={fdDescription}
                onChange={(e) => setFdDescription(e.target.value)}
                className="text-xs min-h-[60px] resize-none"
              />
            </div>

            {/* Outlet Group */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">{t("outletGroupLabel")}</label>
              <select
                value={fdOutletGroupId}
                onChange={(e) => {
                  setFdOutletGroupId(e.target.value)
                  setFormWarning(null)
                }}
                className={selectClass}
              >
                <option value="">{t("outletGroupPlaceholder")}</option>
                {outletGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.outlet_count})
                  </option>
                ))}
              </select>
            </div>

            {/* Method */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">{t("methodLabel")}</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={fdMethod === 0 ? "default" : "outline"}
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => setFdMethod(0)}
                >
                  {t("methodCopy")}
                </Button>
                <Button
                  type="button"
                  variant={fdMethod === 1 ? "default" : "outline"}
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => setFdMethod(1)}
                >
                  {t("methodFixed")}
                </Button>
              </div>
            </div>

            {/* Copy from Weekday (shown when method=copy) */}
            {fdMethod === 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">{t("copyFromWeekdayLabel")}</label>
                <select
                  value={fdCopyFromWeekday}
                  onChange={(e) => setFdCopyFromWeekday(parseInt(e.target.value))}
                  className={selectClass}
                >
                  {WEEKDAY_LABELS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Fixed values (shown when method=fixed) */}
            {fdMethod === 1 && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">{t("costPerUnitLabel")}</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={fdCostPerUnit}
                    onChange={(e) => setFdCostPerUnit(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">{t("profitPerUnitLabel")}</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={fdProfitPerUnit}
                    onChange={(e) => setFdProfitPerUnit(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            {/* Warning */}
            {formWarning && (
              <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {formWarning}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={resetForm}>
              {t("cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={createMutation.isPending}
              onClick={handleSave}
            >
              {createMutation.isPending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {t("deleteOverride")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
