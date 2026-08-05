"use client"

// Detail pane for a strategy template on the Paper Trade page. Same shell as the
// worker/ingester panes (tabs, maximize, animated underline). Tabs: Details
// (editable name/description/notes + read-only id), Data (read-only strategy /
// coin / pair / timeframe / params), AI, Trades, Analyze (bucketed performance),
// Actions (start-stop + delete).

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { LineChart, Play, Trash2, Save } from "lucide-react"
import { toast } from "sonner"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { strategyLabel, strategyDescription, strategyAnalyticsHref } from "@/components/trading/strategy-meta"
import { AnalysisTab } from "@/components/trading/paper/analysis-tab"
import { TradesTable } from "@/components/trading/paper/trades-table"
import { strategyTemplatesApi, type StrategyTemplate, type CoinResponse } from "@/lib/api"

const TAB_STORAGE_KEY = "gorm:paperTrade:activeTab"

function loadActiveTab(): string {
  if (typeof window === "undefined") return "tab1"
  try { return localStorage.getItem(TAB_STORAGE_KEY) || "tab1" } catch { return "tab1" }
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-[var(--border)]/50 last:border-0">
      <span className="text-xs font-medium text-[var(--muted-foreground)] shrink-0">{label}</span>
      <span className="text-sm text-right break-all">{children}</span>
    </div>
  )
}

export function TemplateDetailPane({
  template,
  coinById,
  initialRunId,
  isRunning,
  onStartStop,
  onDelete,
}: {
  template: StrategyTemplate
  coinById: Map<string, CoinResponse>
  // Run the Trades tab should open on, when the pane was opened from a row that
  // stood for one specific run (a Sweep template×coin row, an Active card).
  initialRunId?: string | null
  isRunning: boolean
  onStartStop: (template: StrategyTemplate, action: "start" | "stop") => void
  onDelete: (template: StrategyTemplate) => void
}) {
  const t = useTranslations("paperTrade")
  const queryClient = useQueryClient()
  const router = useRouter()
  const analyticsHref = strategyAnalyticsHref(template.strategy, template.id)

  const [activeTab, setActiveTab] = useState<string>(loadActiveTab)
  const [maximized, setMaximized] = useState(false)
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? "")
  const [notes, setNotes] = useState(template.notes ?? "")
  useEffect(() => {
    setName(template.name)
    setDescription(template.description ?? "")
    setNotes(template.notes ?? "")
  }, [template])

  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, activeTab) } catch { /* ignore */ }
  }, [activeTab])
  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, template, maximized])

  const dirty =
    name !== template.name ||
    description !== (template.description ?? "") ||
    notes !== (template.notes ?? "")

  function handleCancel() {
    setName(template.name)
    setDescription(template.description ?? "")
    setNotes(template.notes ?? "")
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      strategyTemplatesApi.update(template.id, {
        name: name.trim() || template.name,
        description: description.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategyTemplates"] })
      toast.success(t("saved"))
    },
    onError: () => toast.error(t("saveError")),
  })

  // The AI-confirmation switch saves immediately (no save bar) — it's an
  // operational gate the engine reads live, not part of the edited text fields.
  const aiMutation = useMutation({
    mutationFn: (on: boolean) =>
      strategyTemplatesApi.update(template.id, { ai_confirmation: on }),
    onSuccess: (_r, on) => {
      queryClient.invalidateQueries({ queryKey: ["strategyTemplates"] })
      toast.success(on ? t("aiConfirmEnabled") : t("aiConfirmDisabled"))
    },
    onError: () => toast.error(t("saveError")),
  })

  const scope = template.scope ?? {}
  const symbol = scope.coin_id ? coinById.get(scope.coin_id)?.symbol ?? "—" : "—"
  const pair = scope.coin_id ? `${symbol}/${scope.quote_asset ?? "USDT"}` : "—"
  const params = flattenParams(template.params ?? {})
  // An ABSTRACT strategy has no market of its own — each run picks one. Say that
  // rather than showing em-dashes, which read as missing data.
  const marketCell = (value: string) =>
    template.is_abstract
      ? <span className="text-[var(--muted-foreground)] italic">{t("marketAny")}</span>
      : value

  return (
    <div className={cn(
      "flex-1 flex flex-col min-h-0 overflow-hidden border-t",
      maximized && "absolute inset-0 z-20 bg-background",
    )}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
        <div className="relative w-full">
          <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabData")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab5">{t("tabAi")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabTrades")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab6">{t("tabAnalyze")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabActions")}</TabsTrigger>
            <div
              className="ml-auto flex items-center pr-2 pl-3 mb-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMaximized((v) => !v)}
              aria-label={maximized ? "Minimize" : "Maximize"}
            >
              {maximized ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
            </div>
          </TabsList>
          <div className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0" style={{ left: indicator.left, width: indicator.width }} />
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Details ── */}
          <TabsContent value="tab1" className="space-y-4 max-w-2xl mt-6 px-4">
            <Field label="ID">
              <div className="relative">
                <Input value={template.id} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono text-xs" />
                <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                  <CopyIcon size={16} className="text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => { navigator.clipboard.writeText(template.id); toast.success(t("copied")) }} />
                </AnimateIcon>
              </div>
            </Field>
            <Field label={t("name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("description")}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} />
            </Field>
            <Field label={t("notes")}>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="resize-none" placeholder={t("notesPlaceholder")} />
            </Field>
          </TabsContent>

          {/* ── Data (read-only) ── */}
          <TabsContent value="tab2" className="space-y-1 max-w-2xl mt-6 px-4">
            <InfoRow label={t("strategyName")}><span className="font-medium">{strategyLabel(template.strategy)}</span></InfoRow>
            <InfoRow label={t("strategyDescription")}>
              <span className="text-[var(--muted-foreground)]">{strategyDescription(template.strategy)}</span>
            </InfoRow>
            <InfoRow label={t("coin")}>{marketCell(symbol)}</InfoRow>
            <InfoRow label={t("tradingPair")}>{marketCell(pair)}</InfoRow>
            <InfoRow label={t("timeframe")}>{marketCell(scope.interval ?? "—")}</InfoRow>
            <div className="pt-3">
              <p className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5">{t("parameters")}</p>
              {params.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)] italic">{t("noParameters")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {params.map(({ label, value }) => (
                    <Badge key={label} variant="secondary" className="text-xs font-normal">
                      <span className="text-[var(--muted-foreground)] mr-1">{label}</span>
                      <span className="font-mono">{value}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── AI (external trade confirmation) ── */}
          <TabsContent value="tab5" className="space-y-4 max-w-2xl mt-6 px-4">
            <div className="rounded-md border p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{t("aiConfirmTitle")}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{t("aiConfirmDescription")}</p>
              </div>
              <Switch
                checked={template.ai_confirmation}
                onCheckedChange={(v) => aiMutation.mutate(v)}
                className={cn("shrink-0", aiMutation.isPending && "opacity-50 pointer-events-none")}
              />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">{t("aiConfirmHint")}</p>
          </TabsContent>

          {/* ── Trades (round-trip paper trades) ── */}
          <TabsContent value="tab4" className="mt-4 px-4">
            <TradesTable templateId={template.id} coinById={coinById} initialRunId={initialRunId} isRunning={isRunning} />
          </TabsContent>

          {/* ── Analyze (when does this strategy actually work?) ── */}
          <TabsContent value="tab6" className="mt-2 px-4">
            <AnalysisTab key={template.id} templateId={template.id} />
          </TabsContent>

          {/* ── Actions ── */}
          <TabsContent value="tab3" className="space-y-4 max-w-2xl mt-6 px-4">
            <div className="rounded-md border p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{t("runTitle")}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{t("runDescription")}</p>
              </div>
              <Button variant="default" size="sm" className="shrink-0 cursor-pointer" onClick={() => onStartStop(template, "start")}>
                <Play className="h-3.5 w-3.5 mr-1.5" />{t("startNew")}
              </Button>
            </div>

            {/* Back to the workbench this strategy came from, pre-loaded with
                its own market and knobs — the way to re-examine or re-tune it.
                Hidden for a strategy whose slug has no workbench to open. */}
            {analyticsHref && (
              <div className="rounded-md border p-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{t("openAnalyticsTitle")}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {template.is_abstract ? t("openAnalyticsAbstract") : t("openAnalyticsDescription")}
                  </p>
                </div>
                <Button
                  variant="outline" size="sm" className="shrink-0 cursor-pointer"
                  onClick={() => router.push(analyticsHref)}
                >
                  <LineChart className="h-3.5 w-3.5 mr-1.5" />{t("openAnalytics")}
                </Button>
              </div>
            )}

            <div className="rounded-md border border-destructive/30 p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-destructive">{t("deleteTitle")}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{t("deleteDescription")}</p>
              </div>
              <Button variant="destructive" size="sm" className="shrink-0 cursor-pointer" onClick={() => onDelete(template)}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />{t("deleteTemplate")}
              </Button>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      {/* Shared save bar — pinned to the bottom of the screen while editing. */}
      {dirty && (
        <div className="sticky bottom-0 z-10 shrink-0 border-t bg-background flex items-center justify-end gap-2 px-4 py-2.5">
          <Button variant="secondary" size="sm" className="cursor-pointer" onClick={handleCancel} disabled={saveMutation.isPending}>
            {t("cancel")}
          </Button>
          <Button size="sm" className="cursor-pointer" disabled={!name.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            <Save className="h-3.5 w-3.5 mr-1.5" />{saveMutation.isPending ? t("saving") : t("saveChanges")}
          </Button>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[var(--muted-foreground)]">{label}</label>
      {children}
    </div>
  )
}

function formatParam(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—"
  if (typeof v === "boolean") return v ? "on" : "off"
  if (v == null) return "—"
  return String(v)
}

// Human labels for the strategy-specific nested knobs (params.paramValues).
const SUB_LABELS: Record<string, string> = {
  window: "Window", band_pct: "Band %", max_width_pct: "Max width %",
  fast: "Fast", slow: "Slow", period: "Period", vwap_window: "VWAP window",
  require_voldiv: "Vol divergence", fade: "Fade", btc_filter: "BTC-beta filter",
}

// Sub-knobs whose numeric value encodes a mode — showing "1" tells the reader
// nothing, and this pane is the record of what a run actually traded.
const SUB_VALUE_LABELS: Record<string, Record<string, string>> = {
  btc_filter: { "0": "off", "1": "idiosyncratic only", "2": "BTC-driven only" },
  require_voldiv: { "0": "not required", "1": "required" },
}

// Turn the explorer's raw template.params blob into a flat, readable list of
// {label, value} pairs — folding mode/value pairs (SL/TP/vol gate) into one
// badge, flattening the nested paramValues object (which otherwise renders as
// "[object Object]"), and dropping empty/internal entries.
function flattenParams(params: Record<string, unknown>): { label: string; value: string }[] {
  const p = params as Record<string, unknown>
  const out: { label: string; value: string }[] = []
  const push = (label: string, value: string) => out.push({ label, value })
  const num = (v: unknown) => (v == null ? "" : formatParam(v))

  if (p.threshold != null) push("Threshold", num(p.threshold))
  if (p.holdBars != null) push("Hold bars", num(p.holdBars))
  if (p.feeBps != null) push("Fee (bps)", num(p.feeBps))
  if (p.side != null) push("Side", num(p.side))
  if (p.slMode && p.slMode !== "none") push("Stop-loss", `${p.slMode} (${num(p.slValue)})`)
  if (p.tpMode && p.tpMode !== "none") push("Take-profit", `${p.tpMode} (${num(p.tpValue)})`)
  if (p.volGate && p.volGate !== "off") push("Vol gate", `${p.volGate} (${num(p.volLevel)})`)
  if (p.htfGate && p.htfGate !== "off") push("HTF gate", `${p.htfGate} ${p.htfTf ?? "4h"} (${num(p.htfLevel ?? 0.5)}σ)`)
  if (p.indicator) push("Indicator", num(p.indicator))

  if (p.paramValues && typeof p.paramValues === "object") {
    for (const [k, v] of Object.entries(p.paramValues as Record<string, unknown>)) {
      push(SUB_LABELS[k] ?? k, SUB_VALUE_LABELS[k]?.[String(v)] ?? formatParam(v))
    }
  }
  if (Array.isArray(p.disabledSignals) && p.disabledSignals.length) {
    push("Disabled", (p.disabledSignals as string[]).join(", "))
  }
  if (p.weightPct && typeof p.weightPct === "object") {
    const w = Object.entries(p.weightPct as Record<string, number>).filter(([, v]) => v !== 100)
    if (w.length) push("Weights", w.map(([k, v]) => `${k} ${v}%`).join(", "))
  }
  return out
}
