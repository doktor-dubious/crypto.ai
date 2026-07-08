"use client"

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Info, Loader2, Trash2, AlertTriangle } from "lucide-react"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  orchestrationsApi, predictionEnginesApi, coinsApi, tasksApi,
  type OrchestrationGroupDetailResponse, type OrchestrationMetric,
} from "@/lib/api"

// Calibration universe: intervals and grain vocabulary (crypto domain).
const INTERVAL_OPTIONS = ["5m", "15m", "1h", "4h", "1d", "1w"] as const

const TARGET_OPTIONS = [
  { value: "pooled", labelKey: "targetPooled" },
  { value: "pair", labelKey: "targetPair" },
] as const

const IN_PROGRESS = ["selecting", "reweighting"]
type CalibrateMode = "select" | "reweight"

const sortedEq = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

function InfoIcon({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  )
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {hint && <InfoIcon text={hint} />}
      </div>
      {children}
    </div>
  )
}

// ── Worker-picker / confirm dialog for Selection and Reweight ──────────────────
function CalibrateDialog({
  group, mode, warn, open, onOpenChange, onDone,
}: {
  group: OrchestrationGroupDetailResponse
  mode: CalibrateMode
  warn?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const t = useTranslations("orchestrationDetail")
  const tn = useTranslations("orchestrationsNewPage")
  const [assignment, setAssignment] = useState<Record<string, string>>(group.engine_workers ?? {})
  const [submitting, setSubmitting] = useState(false)

  const slugs = mode === "select"
    ? (group.engine_slugs ?? [])
    : (group.engines ?? []).map((e) => e.engine_slug)

  useEffect(() => { if (open) setAssignment(group.engine_workers ?? {}) }, [open, group.engine_workers])

  const { data: workers = [] } = useQuery({
    queryKey: ["workers"],
    queryFn: () => tasksApi.listWorkers(),
    enabled: open,
    staleTime: 30 * 1000,
  })
  const { data: engines = [] } = useQuery({
    queryKey: ["prediction-engines"],
    queryFn: () => predictionEnginesApi.list(),
    staleTime: 5 * 60 * 1000,
  })
  const nameBySlug = useMemo(
    () => Object.fromEntries(engines.map((e) => [e.slug, e.name])),
    [engines],
  )

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      const engine_workers = Object.fromEntries(Object.entries(assignment).filter(([, w]) => w))
      if (mode === "select") await orchestrationsApi.select(group.id, { engine_workers })
      else await orchestrationsApi.reweight(group.id, { engine_workers })
      onDone()
      onOpenChange(false)
      toast.success(t(mode === "select" ? "selectStarted" : "reweightStarted"))
    } catch (e) {
      console.error("Calibration dispatch failed:", e)
      toast.error(t(mode === "select" ? "selectError" : "reweightError"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(mode === "select" ? "initiateOrchestration" : "recalibrateWeights")}</DialogTitle>
          <DialogDescription>{tn("runOnHelp")}</DialogDescription>
        </DialogHeader>
        {warn && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-500">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            <span>{warn}</span>
          </div>
        )}
        <div className="flex flex-col gap-2 py-2">
          {slugs.map((slug) => {
            const capable = workers.filter((w) => w.models?.includes(slug))
            return (
              <div key={slug} className="grid grid-cols-[160px_1fr] items-center gap-3">
                <span className="text-sm">{nameBySlug[slug] ?? slug}</span>
                <select
                  value={assignment[slug] ?? ""}
                  onChange={(e) => setAssignment((p) => ({ ...p, [slug]: e.target.value }))}
                  className="w-full h-8 px-2 border border-[var(--input)] rounded-md bg-[var(--background)] text-sm"
                >
                  <option value="">{tn("runOnLocal")}</option>
                  {capable.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name}{w.gpu_name ? ` — ${w.gpu_name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={submitting}>
            {submitting ? t("starting") : t(mode === "select" ? "initiateOrchestration" : "recalibrateWeights")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Detail pane ────────────────────────────────────────────────────────────────
export function OrchestrationDetailPane({
  groupId, onDeleted,
}: {
  groupId: string
  onDeleted: () => void
}) {
  const t = useTranslations("orchestrationDetail")
  const tn = useTranslations("orchestrationsNewPage")
  const queryClient = useQueryClient()

  const { data: group, isLoading } = useQuery({
    queryKey: ["orchestration-group", groupId],
    queryFn: () => orchestrationsApi.get(groupId),
    refetchInterval: (q) => IN_PROGRESS.includes(q.state.data?.status ?? "") ? 4000 : false,
  })

  const [activeTab, setActiveTab] = useState("details")
  const [maximized, setMaximized] = useState(false)
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const [dialogMode, setDialogMode] = useState<CalibrateMode | null>(null)
  const [reinitiate, setReinitiate] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState("")

  // Candidate engines from the DB catalog (slug + display name).
  const { data: engines = [] } = useQuery({
    queryKey: ["prediction-engines"],
    queryFn: () => predictionEnginesApi.list(),
    staleTime: 5 * 60 * 1000,
  })
  const availableModels = useMemo(
    () => engines.map((e) => ({ slug: e.slug, label: e.name })),
    [engines],
  )

  // Coins for the calibration-universe multi-select.
  const { data: coins = [] } = useQuery({
    queryKey: ["coins"],
    queryFn: () => coinsApi.list({ limit: 1000 }),
    staleTime: 5 * 60 * 1000,
  })

  // Editable draft, seeded from the group on select / server-side change.
  type Draft = {
    name: string; description: string; notes: string
    metric: string; topN: string; target: string; models: Set<string>
    quoteAsset: string; interval: string; coinIds: Set<string>
  }
  const [draft, setDraft] = useState<Draft | null>(null)
  const seededRef = useRef<string>("")

  useEffect(() => {
    if (!group) return
    const stamp = `${group.id}:${group.updated_at}`
    if (seededRef.current === stamp) return
    seededRef.current = stamp
    setDraft({
      name: group.name ?? "",
      description: group.description ?? "",
      notes: group.notes ?? "",
      metric: group.calibration_metric ?? "mase",
      topN: String(group.top_n ?? 4),
      // Legacy groups store NULL, which the backend treats as the pooled grain.
      target: group.prediction_target ?? "pooled",
      models: new Set(group.engine_slugs ?? []),
      quoteAsset: group.quote_asset ?? "USDT",
      interval: group.interval ?? "1h",
      coinIds: new Set(group.coin_ids ?? []),
    })
  }, [group])

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, group, maximized])

  const saveMutation = useMutation({
    mutationFn: (payload: Parameters<typeof orchestrationsApi.update>[1]) =>
      orchestrationsApi.update(groupId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orchestration-group", groupId] })
      queryClient.invalidateQueries({ queryKey: ["orchestration-groups"] })
      toast.success(t("toastSaved"))
    },
    onError: () => toast.error(t("toastSaveError")),
  })

  const deleteMutation = useMutation({
    mutationFn: () => orchestrationsApi.delete(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orchestration-groups"] })
      toast.success(t("deleteSuccess"))
    },
  })

  if (isLoading || !group || !draft) {
    return (
      <div className="flex-1 flex items-center justify-center border-t text-sm text-muted-foreground py-10">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> {t("loading")}
      </div>
    )
  }

  const inProgress = IN_PROGRESS.includes(group.status)
  const hasSelection = (group.engines ?? []).length > 0
  const draftModels = [...draft.models]
  const draftCoins = [...draft.coinIds]

  const modelsChanged = !sortedEq(draftModels, group.engine_slugs ?? [])
  const configChanged =
    draft.metric !== (group.calibration_metric ?? "mase") ||
    draft.topN !== String(group.top_n ?? 4) ||
    draft.target !== (group.prediction_target ?? "pooled") ||
    draft.quoteAsset !== (group.quote_asset ?? "USDT") ||
    draft.interval !== (group.interval ?? "1h") ||
    !sortedEq(draftCoins, group.coin_ids ?? [])
  const isDirty =
    draft.name !== (group.name ?? "") ||
    draft.description !== (group.description ?? "") ||
    draft.notes !== (group.notes ?? "") ||
    configChanged ||
    modelsChanged
  // Composition was built under a config (grain, metric, top-N, model set) that no
  // longer matches the saved group. Legacy groups (calibrated before the basis
  // was tracked) fall back to the slug-only check; groups with no snapshot at
  // all are never flagged.
  const basis = group.calibrated_basis ?? {}
  const isStale =
    hasSelection &&
    ((basis.slugs ?? []).length > 0
      ? !sortedEq(group.engine_slugs ?? [], basis.slugs ?? []) ||
        (basis.prediction_target ?? "pooled") !== (group.prediction_target ?? "pooled") ||
        (basis.metric ?? group.calibration_metric) !== group.calibration_metric ||
        (basis.top_n ?? group.top_n) !== group.top_n
      : (group.calibrated_slugs ?? []).length > 0 &&
        !sortedEq(group.engine_slugs ?? [], group.calibrated_slugs ?? []))
  const showInitiate = modelsChanged || configChanged || isStale
  const showBar = isDirty || showInitiate

  const buildPayload = () => ({
    name: draft.name.trim() || undefined,
    description: draft.description,
    notes: draft.notes,
    metric: draft.metric as OrchestrationMetric,
    top_n: parseInt(draft.topN),
    prediction_target: draft.target,
    engine_slugs: draftModels,
    quote_asset: draft.quoteAsset,
    interval: draft.interval,
    coin_ids: draftCoins,
  })

  const handleSave = () => {
    if (draftModels.length < 2) { toast.error(t("needTwoModels")); return }
    saveMutation.mutate(buildPayload())
  }
  const handleCancel = () => {
    seededRef.current = ""  // force reseed from the group
    setDraft({
      name: group.name ?? "", description: group.description ?? "", notes: group.notes ?? "",
      metric: group.calibration_metric ?? "mase", topN: String(group.top_n ?? 4),
      target: group.prediction_target ?? "pooled", models: new Set(group.engine_slugs ?? []),
      quoteAsset: group.quote_asset ?? "USDT", interval: group.interval ?? "1h",
      coinIds: new Set(group.coin_ids ?? []),
    })
  }
  const handleInitiate = async () => {
    if (draftModels.length < 2) { toast.error(t("needTwoModels")); return }
    // Selection reads the persisted pool, so save any pending edits first.
    if (isDirty) await saveMutation.mutateAsync(buildPayload())
    setReinitiate(hasSelection)
    setDialogMode("select")
  }

  const toggleModel = (slug: string) =>
    setDraft((d) => {
      if (!d) return d
      const m = new Set(d.models)
      m.has(slug) ? m.delete(slug) : m.add(slug)
      return { ...d, models: m }
    })

  const toggleCoin = (id: string) =>
    setDraft((d) => {
      if (!d) return d
      const c = new Set(d.coinIds)
      c.has(id) ? c.delete(id) : c.add(id)
      return { ...d, coinIds: c }
    })

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["orchestration-group", groupId] })
    queryClient.invalidateQueries({ queryKey: ["orchestration-groups"] })
  }

  const inputCls = "w-full h-8 px-2 border border-[var(--input)] rounded-md bg-[var(--background)] text-sm"

  const TABS = [
    { v: "details", label: t("tabDetails") },
    { v: "metrics", label: t("tabMetrics") },
    { v: "composition", label: t("tabComposition") },
    { v: "models", label: t("tabModels") },
    { v: "actions", label: t("tabActions") },
  ]

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("flex-1 flex flex-col min-h-0 overflow-hidden border-t", maximized && "absolute inset-0 z-20 bg-background")}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
          <div className="relative w-full">
            <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
              {TABS.map((tab) => (
                <TabsTrigger
                  key={tab.v}
                  value={tab.v}
                  className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"
                >
                  {tab.label}
                  {tab.v === "composition" && showInitiate && (
                    <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
                  )}
                </TabsTrigger>
              ))}
              <div
                className="ml-auto flex items-center pr-2 pl-3 mb-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setMaximized((v) => !v)}
                aria-label={maximized ? "Minimize" : "Maximize"}
              >
                {maximized ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
              </div>
            </TabsList>
            <div
              className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
              style={{ left: indicator.left, width: indicator.width }}
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {inProgress && (
              <div className="max-w-2xl mt-4 mx-4 rounded-md border border-blue-500/30 bg-blue-500/5 p-3 flex items-center gap-2 text-xs text-blue-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t(group.status === "selecting" ? "selectingNote" : "reweightingNote")}
              </div>
            )}

            {/* ─ Details ─ */}
            <TabsContent value="details" className="space-y-6 max-w-2xl mt-6 px-4">
              <FieldRow label={t("fieldId")}>
                <div className="relative">
                  <Input value={group.id} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono text-xs" />
                  <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                    <CopyIcon
                      size={16}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => { navigator.clipboard.writeText(group.id); toast.success(t("toastCopied")) }}
                    />
                  </AnimateIcon>
                </div>
              </FieldRow>
              <FieldRow label={t("fieldName")}>
                <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={tn("namePlaceholder")} />
              </FieldRow>
              <FieldRow label={t("fieldDescription")}>
                <Textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={3} className="resize-none" placeholder={tn("descriptionPlaceholder")} />
              </FieldRow>
              <FieldRow label={t("fieldNotes")}>
                <Textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} rows={4} className="resize-none" placeholder={tn("notesPlaceholder")} />
              </FieldRow>
            </TabsContent>

            {/* ─ Metrics ─ */}
            <TabsContent value="metrics" className="space-y-6 max-w-2xl mt-6 px-4">
              <FieldRow label={t("errorMetric")} hint={t("errorMetricHelp")}>
                <select value={draft.metric} onChange={(e) => set({ metric: e.target.value })} className={inputCls}>
                  <option value="mase">MASE</option>
                  <option value="smase">Seasonal MASE</option>
                  <option value="crps">CRPS</option>
                  <option value="mae">MAE</option>
                  <option value="mape">MAPE</option>
                  <option value="rmse">RMSE</option>
                </select>
              </FieldRow>
              <FieldRow label={t("topN")} hint={t("topNHelp")}>
                <select value={draft.topN} onChange={(e) => set({ topN: e.target.value })} className={inputCls}>
                  {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </FieldRow>
            </TabsContent>

            {/* ─ Model Composition ─ */}
            <TabsContent value="composition" className="space-y-6 max-w-2xl mt-6 px-4">
              <FieldRow label={tn("calibrationGrain")} hint={tn("calibrationGrainHelp")}>
                <select value={draft.target} onChange={(e) => set({ target: e.target.value })} className={inputCls}>
                  {TARGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{tn(o.labelKey)}</option>
                  ))}
                </select>
              </FieldRow>

              {/* Calibration universe */}
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label={tn("quoteAsset")} hint={tn("quoteAssetHelp")}>
                  <Input value={draft.quoteAsset} onChange={(e) => set({ quoteAsset: e.target.value.toUpperCase() })} placeholder="USDT" />
                </FieldRow>
                <FieldRow label={tn("interval")} hint={tn("intervalHelp")}>
                  <select value={draft.interval} onChange={(e) => set({ interval: e.target.value })} className={inputCls}>
                    {INTERVAL_OPTIONS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </FieldRow>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-muted-foreground">{tn("coins")}</label>
                  <InfoIcon text={tn("coinsHelp")} />
                </div>
                {coins.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tn("coinsNone")}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--input)] p-2">
                    {coins.map((c) => (
                      <div key={c.id} className="flex items-center space-x-2">
                        <Checkbox id={`c-${c.id}`} checked={draft.coinIds.has(c.id)} onCheckedChange={() => toggleCoin(c.id)} />
                        <label htmlFor={`c-${c.id}`} className="text-sm cursor-pointer select-none">{c.symbol}</label>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{tn("coinsAllHint")}</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-muted-foreground">{t("selectModels")}</label>
                  <InfoIcon text={tn("selectModelsHelp")} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {availableModels.map((m) => (
                    <div key={m.slug} className="flex items-center space-x-2">
                      <Checkbox id={`m-${m.slug}`} checked={draft.models.has(m.slug)} onCheckedChange={() => toggleModel(m.slug)} />
                      <label htmlFor={`m-${m.slug}`} className="text-sm cursor-pointer select-none">{m.label}</label>
                    </div>
                  ))}
                </div>
              </div>
              {isStale && !modelsChanged && (
                <p className="text-xs text-amber-500">{t("staleNote")}</p>
              )}
            </TabsContent>

            {/* ─ Models ─ */}
            <TabsContent value="models" className="max-w-2xl mt-6 px-4 space-y-3">
              {draft.target !== "pair" && hasSelection && (
                <p className="text-xs text-muted-foreground">{t("weightsAveragedNote")}</p>
              )}
              {hasSelection ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colModel")}</TableHead>
                      <TableHead>{t("colRank")}</TableHead>
                      <TableHead className="text-right">{t("colWeight")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.engines.map((e) => (
                      <TableRow key={e.engine_slug}>
                        <TableCell className="font-medium">{e.engine_name}</TableCell>
                        <TableCell><Badge>{e.rank}</Badge></TableCell>
                        <TableCell className="text-right font-semibold">{(e.weight * 100).toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground py-6">{t("noComposition")}</p>
              )}
            </TabsContent>

            {/* ─ Actions ─ */}
            <TabsContent value="actions" className="max-w-2xl mt-6 px-4 space-y-3">
              {hasSelection && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] p-4">
                  <div>
                    <p className="text-sm font-medium">{t("reinitiateOrchestration")}</p>
                    <p className="text-xs text-muted-foreground">{t("reinitiateDesc")}</p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" disabled={inProgress}
                    onClick={() => { setReinitiate(true); setDialogMode("select") }}>
                    {group.status === "selecting" ? t("selecting") : t("reinitiateOrchestration")}
                  </Button>
                </div>
              )}
              {hasSelection && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] p-4">
                  <div>
                    <p className="text-sm font-medium">{t("recalibrateWeights")}</p>
                    <p className="text-xs text-muted-foreground">{t("recalibrateDesc")}</p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" disabled={inProgress}
                    onClick={() => { setReinitiate(false); setDialogMode("reweight") }}>
                    {group.status === "reweighting" ? t("reweighting") : t("recalibrateWeights")}
                  </Button>
                </div>
              )}
              {!hasSelection && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] p-4">
                  <div>
                    <p className="text-sm font-medium">{t("initiateOrchestration")}</p>
                    <p className="text-xs text-muted-foreground">{t("initiateDesc")}</p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" disabled={inProgress}
                    onClick={() => { setReinitiate(false); setDialogMode("select") }}>
                    {group.status === "selecting" ? t("selecting") : t("initiateOrchestration")}
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 p-4">
                <div>
                  <p className="text-sm font-medium text-destructive">{t("deleteTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("deleteDesc")}</p>
                </div>
                <Button variant="destructive" size="sm" className="shrink-0"
                  onClick={() => { setDeleteUnderstood(false); setDeleteConfirm(""); setDeleteOpen(true) }}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />{t("deleteButton")}
                </Button>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* ── Save / Initiate bar ── */}
        {showBar && (
          <div className="shrink-0 border-t flex items-center justify-end gap-2 px-4 py-2 bg-background">
            {showInitiate && (
              <Button size="sm" variant="outline" onClick={handleInitiate} disabled={saveMutation.isPending || inProgress}>
                {t("initiateOrchestration")}
              </Button>
            )}
            {isDirty && (
              <>
                <Button variant="secondary" size="sm" onClick={handleCancel} disabled={saveMutation.isPending}>
                  {t("cancel")}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? t("saving") : t("saveChanges")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {dialogMode && (
        <CalibrateDialog
          group={group}
          mode={dialogMode}
          warn={dialogMode === "select" && reinitiate ? t("reinitiateWarning") : undefined}
          open={dialogMode !== null}
          onOpenChange={(o) => { if (!o) setDialogMode(null) }}
          onDone={refresh}
        />
      )}

      {/* ── Delete dialog ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteAbsoluteDescription", { name: group.name })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("deleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("deleteTypeToConfirm")}</label>
              <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>{t("cancel")}</Button>
            <Button
              variant="destructive" size="sm"
              disabled={!deleteUnderstood || deleteConfirm !== t("deleteTypePlaceholder") || deleteMutation.isPending}
              onClick={async () => {
                try { await deleteMutation.mutateAsync(); setDeleteOpen(false); onDeleted() }
                catch { toast.error(t("deleteError")) }
              }}
            >
              {t("deleteButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
