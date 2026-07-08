"use client"

// Detail pane for a strategy template on the Paper Trade page. Same shell as the
// worker/ingester panes (tabs, maximize, animated underline). Tabs: Details
// (editable name/description/notes + read-only id), Data (read-only strategy /
// coin / pair / timeframe / params), Actions (start-stop + delete).

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Play, Square, Trash2, Save } from "lucide-react"
import { toast } from "sonner"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"
import { strategyLabel, strategyDescription } from "@/components/trading/strategy-meta"
import { strategyTemplatesApi, paperTradeApi, type StrategyTemplate, type CoinResponse } from "@/lib/api"

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
  isRunning,
  onStartStop,
  onDelete,
}: {
  template: StrategyTemplate
  coinById: Map<string, CoinResponse>
  isRunning: boolean
  onStartStop: (template: StrategyTemplate, action: "start" | "stop") => void
  onDelete: (template: StrategyTemplate) => void
}) {
  const t = useTranslations("paperTrade")
  const queryClient = useQueryClient()

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

  const scope = template.scope ?? {}
  const symbol = scope.coin_id ? coinById.get(scope.coin_id)?.symbol ?? "—" : "—"
  const pair = scope.coin_id ? `${symbol}/${scope.quote_asset ?? "USDT"}` : "—"
  const params = flattenParams(template.params ?? {})

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
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabTrades")}</TabsTrigger>
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
            <InfoRow label={t("coin")}>{symbol}</InfoRow>
            <InfoRow label={t("tradingPair")}>{pair}</InfoRow>
            <InfoRow label={t("timeframe")}>{scope.interval ?? "—"}</InfoRow>
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

          {/* ── Trades (round-trip paper trades) ── */}
          <TabsContent value="tab4" className="mt-4 px-4">
            <TradesTable templateId={template.id} isRunning={isRunning} />
          </TabsContent>

          {/* ── Actions ── */}
          <TabsContent value="tab3" className="space-y-4 max-w-2xl mt-6 px-4">
            <div className="rounded-md border p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{t("runTitle")}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{t("runDescription")}</p>
              </div>
              {isRunning ? (
                <Button variant="secondary" size="sm" className="shrink-0 cursor-pointer" onClick={() => onStartStop(template, "stop")}>
                  <Square className="h-3.5 w-3.5 mr-1.5" />{t("stopStrategy")}
                </Button>
              ) : (
                <Button variant="default" size="sm" className="shrink-0 cursor-pointer" onClick={() => onStartStop(template, "start")}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />{t("startStrategy")}
                </Button>
              )}
            </div>
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

// The run's paper trades — one row per round-trip (buy + sell), newest first.
// Polls while the strategy is running so new trades stream in.
const TRADES_PER_PAGE = 10

// Windowed page links (max 7), matching the master table on the same page.
function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function TradesTable({ templateId, isRunning }: { templateId: string; isRunning: boolean }) {
  const t = useTranslations("paperTrade")
  const { data: trades = [] } = useQuery({
    queryKey: ["paperTrades", templateId],
    queryFn: () => paperTradeApi.listTrades(templateId),
    refetchInterval: isRunning ? 8000 : false,
  })

  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [templateId])
  const totalPages = Math.max(1, Math.ceil(trades.length / TRADES_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageTrades = trades.slice((safePage - 1) * TRADES_PER_PAGE, safePage * TRADES_PER_PAGE)

  if (trades.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{t("noTrades")}</p>
  }
  const px = (v: number | null) => (v == null ? "—" : v.toLocaleString(undefined, { maximumSignificantDigits: 8 }))
  const dt = (v: string | null) => (v == null ? "—" : new Date(v).toLocaleString())
  return (
    <div className="rounded-md border">
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-[var(--muted)]/40 text-[var(--muted-foreground)]">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium whitespace-nowrap">
            <th>{t("colSide")}</th>
            <th className="text-right!">{t("colQty")}</th>
            <th>{t("colEntry")}</th>
            <th className="text-right!">{t("colEntryPrice")}</th>
            <th>{t("colExit")}</th>
            <th className="text-right!">{t("colExitPrice")}</th>
            <th className="text-right!">{t("colPnl")}</th>
            <th>{t("colReason")}</th>
            <th>{t("colAiVerdict")}</th>
          </tr>
        </thead>
        <tbody>
          {pageTrades.map((tr) => {
            const open = tr.status === "open"
            return (
              <tr key={tr.trade_seq} className={cn("border-t [&>td]:px-3 [&>td]:py-1.5 whitespace-nowrap", open && "bg-amber-500/5")}>
                <td className={cn(tr.side === "long" ? "text-emerald-500" : "text-red-500")}>{tr.side}</td>
                <td className="text-right font-mono tabular-nums">{px(tr.qty)}</td>
                <td className="tabular-nums">{dt(tr.entry_time)}</td>
                <td className="text-right font-mono tabular-nums">{px(tr.entry_price)}</td>
                <td className="tabular-nums">{open ? <span className="text-amber-600 dark:text-amber-400">{t("open")}</span> : dt(tr.exit_time)}</td>
                <td className="text-right font-mono tabular-nums">{px(tr.exit_price)}</td>
                <td className={cn(
                  "text-right font-mono tabular-nums",
                  tr.realized_pnl == null ? "text-[var(--muted-foreground)]"
                    : tr.realized_pnl >= 0 ? "text-emerald-500" : "text-red-500",
                )}>
                  {tr.realized_pnl == null ? "—" : `${tr.realized_pnl >= 0 ? "+" : ""}${tr.realized_pnl.toFixed(2)}`}
                </td>
                <td className="text-[var(--muted-foreground)]">{open ? "—" : tr.exit_reason ?? "—"}</td>
                <td>
                  {tr.ai_verdict == null ? (
                    <span className="text-[var(--muted-foreground)]">—</span>
                  ) : (
                    <Badge
                      variant="outline"
                      title={tr.ai_explanation ?? undefined}
                      className={cn(
                        "text-xs",
                        tr.ai_verdict === "GO"
                          ? "border-emerald-500/40 text-emerald-500"
                          : "border-red-500/40 text-red-500",
                      )}
                    >
                      {tr.ai_verdict === "GO" ? t("aiGo") : t("aiNoGo")}
                    </Badge>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>

    <div className="flex items-center justify-between px-3 py-1.5 border-t">
      <span className="text-xs text-[var(--muted-foreground)]">
        {t("showingTrades", {
          from: (safePage - 1) * TRADES_PER_PAGE + 1,
          to: Math.min(safePage * TRADES_PER_PAGE, trades.length),
          total: trades.length,
        })}
      </span>
      {totalPages > 1 && (
        <Pagination className="w-auto mx-0">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} />
            </PaginationItem>
            {buildPaginationPages(safePage, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink isActive={safePage === p} onClick={() => setPage(p)}>{p}</PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
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
  require_voldiv: "Vol divergence", fade: "Fade",
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
  if (p.indicator) push("Indicator", num(p.indicator))

  if (p.paramValues && typeof p.paramValues === "object") {
    for (const [k, v] of Object.entries(p.paramValues as Record<string, unknown>)) {
      push(SUB_LABELS[k] ?? k, formatParam(v))
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
