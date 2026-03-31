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
  priceHistoryApi,
  type PriceHistoryResponse,
} from "@/lib/api"
import { toast } from "sonner"
import {
  PredictionCalendar,
  type StrategyAssignment,
  ASSIGNMENT_COLORS,
} from "@/components/predictions/prediction-calendar"
import { parseISO } from "date-fns"
import { cn } from "@/lib/utils"

// ─── Helpers ────────────────────────────────────────────────────────────────

function priceHistoryToAssignments(entries: PriceHistoryResponse[]): StrategyAssignment[] {
  return entries.map((e, i) => ({
    id: e.id,
    dates: [e.effective_date],
    strategyId: e.id,
    strategyName: e.name,
    colorIdx: i % ASSIGNMENT_COLORS.length,
  }))
}

// ─── Dialog state ───────────────────────────────────────────────────────────

interface DeleteDialogState {
  id: string
  name: string
}

// ─── Component ──────────────────────────────────────────────────────────────

const PH_PREFIX = "gorm:priceHistory:"
function loadPhJson<T>(cid: string, key: string, fb: T): T { if (typeof window === "undefined") return fb; try { const r = localStorage.getItem(`${PH_PREFIX}${cid}:${key}`); return r ? JSON.parse(r) : fb } catch { return fb } }
function savePhJson(cid: string, key: string, v: unknown) { if (typeof window !== "undefined") localStorage.setItem(`${PH_PREFIX}${cid}:${key}`, JSON.stringify(v)) }

export default function PriceHistoryPage() {
  const t = useTranslations("priceHistory")
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()
  const cid = activeCustomer?.id ?? ""

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set(loadPhJson<string[]>(cid, "selectedDates", [])))
  const [navigateToDate, setNavigateToDate] = useState<{ year: number; month: number } | null>(null)

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null)

  // Create form state
  const [phName, setPhName] = useState("")
  const [phDescription, setPhDescription] = useState("")
  const [phCostPerUnit, setPhCostPerUnit] = useState("")
  const [phProfitPerUnit, setPhProfitPerUnit] = useState("")
  const [formWarning, setFormWarning] = useState<string | null>(null)

  // ─── Persist ───────────────────────────────────────────────────────────────
  useEffect(() => { if (cid) savePhJson(cid, "selectedDates", [...selectedDates]) }, [cid, selectedDates])
  const prevCidRef = useRef(cid)
  useEffect(() => { if (prevCidRef.current && cid && prevCidRef.current !== cid) setSelectedDates(new Set(loadPhJson<string[]>(cid, "selectedDates", []))); prevCidRef.current = cid }, [cid])

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const { data: priceHistory = [] } = useQuery({
    queryKey: ["price-history", activeCustomer?.id],
    queryFn: () => priceHistoryApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  // ─── Derived ──────────────────────────────────────────────────────────────

  const assignments = useMemo(() => priceHistoryToAssignments(priceHistory), [priceHistory])

  const colorMap = useMemo(() => {
    const map = new Map<string, string>()
    priceHistory.forEach((e, i) => {
      map.set(e.id, ASSIGNMENT_COLORS[i % ASSIGNMENT_COLORS.length].bar)
    })
    return map
  }, [priceHistory])

  // ─── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeCustomer) throw new Error("No customer")
      const effectiveDate = [...selectedDates][0]
      return priceHistoryApi.create({
        customer_id: activeCustomer.id,
        name: phName.trim(),
        description: phDescription.trim() || null,
        effective_date: effectiveDate,
        cost_per_unit: phCostPerUnit ? parseFloat(phCostPerUnit) : null,
        profit_per_unit: phProfitPerUnit ? parseFloat(phProfitPerUnit) : null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-history", activeCustomer?.id] })
      toast.success(t("toastCreated", { name: phName.trim() }))
      setSelectedDates(new Set())
      resetForm()
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => priceHistoryApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-history", activeCustomer?.id] })
      toast.success(t("toastDeleted"))
      setDeleteDialog(null)
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  // ─── Actions ──────────────────────────────────────────────────────────────

  function resetForm() {
    setCreateOpen(false)
    setPhName("")
    setPhDescription("")
    setPhCostPerUnit("")
    setPhProfitPerUnit("")
    setFormWarning(null)
  }

  function handleOpenCreateDialog() {
    if (selectedDates.size === 0) {
      setFormWarning(t("warnNoDate"))
      return
    }
    if (selectedDates.size > 1) {
      setFormWarning(t("warnSingleDate"))
      return
    }
    setFormWarning(null)
    setCreateOpen(true)
  }

  function handleSave() {
    if (!phName.trim()) {
      setFormWarning(t("warnNoName"))
      return
    }
    setFormWarning(null)
    createMutation.mutate()
  }

  function handleSelectedDatesChange(dates: Set<string>) {
    setSelectedDates(dates)
    if (dates.size > 0) setFormWarning(null)
  }

  function handleEntryClick(entry: PriceHistoryResponse) {
    const date = parseISO(entry.effective_date)
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
          {/* Add button + warning */}
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
              {t("addButton")}
            </Button>
          </div>

          {/* Existing price history list */}
          <div className="flex flex-col overflow-hidden flex-1">
            <div className="px-3 py-2 border-b shrink-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("existingEntries")}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {priceHistory.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-xs text-muted-foreground">{t("noEntries")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {priceHistory.map((entry) => {
                    const color = colorMap.get(entry.id) ?? ASSIGNMENT_COLORS[0].bar
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-2 px-3 py-2.5 group cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleEntryClick(entry)}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{entry.name}</p>
                          {entry.description && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              {entry.description}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground">
                            {entry.effective_date}
                            {entry.cost_per_unit != null && ` \u00b7 cost: ${entry.cost_per_unit}`}
                            {entry.profit_per_unit != null && ` \u00b7 profit: ${entry.profit_per_unit}`}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteDialog({ id: entry.id, name: entry.name })
                          }}
                          className={cn(
                            "shrink-0 text-muted-foreground transition-colors cursor-pointer",
                            "opacity-0 group-hover:opacity-100 hover:text-destructive"
                          )}
                          aria-label={t("deleteEntry")}
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
                value={phName}
                onChange={(e) => {
                  setPhName(e.target.value)
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
                value={phDescription}
                onChange={(e) => setPhDescription(e.target.value)}
                className="text-xs min-h-[60px] resize-none"
              />
            </div>

            {/* Cost & Profit */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">{t("costPerUnitLabel")}</label>
                <Input
                  type="number"
                  step="0.01"
                  value={phCostPerUnit}
                  onChange={(e) => setPhCostPerUnit(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">{t("profitPerUnitLabel")}</label>
                <Input
                  type="number"
                  step="0.01"
                  value={phProfitPerUnit}
                  onChange={(e) => setPhProfitPerUnit(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

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
              {t("deleteEntry")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
