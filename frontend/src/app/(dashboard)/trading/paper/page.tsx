"use client"

// Paper Trade page. Top: active (running) strategies. Below: a master table of
// strategy templates with start/stop, plus a 3-tab detail pane. The run lifecycle
// is real (uptime); P/L is not computed yet (engine is the next phase).

import { useMemo, useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, ArrowUpDown, ChevronUp, ChevronDown, Star, Play, Square, Trash2, Focus,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { ViewSwitcher } from "@/components/ui/view-switcher"
import { cn } from "@/lib/utils"
import { strategyLabel } from "@/components/trading/strategy-meta"
import { ActiveStrategies } from "@/components/trading/paper/active-strategies"
import { TemplateDetailPane } from "@/components/trading/paper/template-detail-pane"
import {
  strategyTemplatesApi, paperTradeApi, coinsApi,
  type StrategyTemplate,
} from "@/lib/api"

const STORAGE_PREFIX = "gorm:paperTrade:"
const PER_PAGE = 10

// Windowed page links: 1 … current-1 current current+1 … last (max 7 shown),
// matching the other tables (e.g. simulations/completed).
function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value)) } catch { /* ignore */ }
}

type SortField = "name" | "strategy" | "coin" | "timeframe"

export default function PaperTradePage() {
  const t = useTranslations("paperTrade")
  const queryClient = useQueryClient()

  // ── Data ──
  const { data: templates = [] } = useQuery({
    queryKey: ["strategyTemplates", "all"],
    queryFn: () => strategyTemplatesApi.list(),
  })
  const { data: coins = [] } = useQuery({
    queryKey: ["coins"],
    queryFn: () => coinsApi.list({ limit: 1000 }),
  })
  const { data: activeRuns = [] } = useQuery({
    queryKey: ["paperRuns", "active"],
    queryFn: () => paperTradeApi.listRuns(true),
    refetchInterval: 5000,
  })

  const coinById = useMemo(() => new Map(coins.map((c) => [c.id, c])), [coins])
  const runningByTemplate = useMemo(
    () => new Map(activeRuns.map((r) => [r.template_id, r])),
    [activeRuns],
  )

  // ── Table state ──
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>(() => loadJson<SortField>("sortField", "name"))
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => loadJson<"asc" | "desc">("sortDir", "asc"))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(() => loadJson<string | null>("selected", null))

  // Top-level view: "active" | "strategies" — a segmented switcher (same control
  // as the configuration page's Gorm/Customer toggle).
  const [topTab, setTopTab] = useState<string>(() => loadJson<string>("topTab", "active"))
  useEffect(() => { saveJson("topTab", topTab) }, [topTab])

  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson("sortField", sortField) }, [sortField])
  useEffect(() => { saveJson("sortDir", sortDir) }, [sortDir])
  useEffect(() => { saveJson("selected", selectedId) }, [selectedId])

  // ── Dialogs ──
  const [confirm, setConfirm] = useState<{ template: StrategyTemplate; action: "start" | "stop" } | null>(null)
  // Paper investment for the next started run — remembered across trades (default 100).
  const [investment, setInvestment] = useState<number>(() => loadJson<number>("investment", 100))
  useEffect(() => { saveJson("investment", investment) }, [investment])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkUnderstood, setBulkUnderstood] = useState(false)
  const [bulkConfirmText, setBulkConfirmText] = useState("")
  const [deleteTemplate, setDeleteTemplate] = useState<StrategyTemplate | null>(null)

  // ── Mutations ──
  const invalidateRuns = () => queryClient.invalidateQueries({ queryKey: ["paperRuns"] })
  const startMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => paperTradeApi.start(id, amount),
    onSuccess: () => { invalidateRuns(); toast.success(t("started")) },
    onError: () => toast.error(t("actionError")),
  })
  const stopMutation = useMutation({
    mutationFn: (id: string) => paperTradeApi.stop(id),
    onSuccess: () => { invalidateRuns(); toast.success(t("stopped")) },
    onError: () => toast.error(t("actionError")),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => strategyTemplatesApi.delete(id),
    onSuccess: (_r, id) => {
      queryClient.invalidateQueries({ queryKey: ["strategyTemplates"] })
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      if (selectedId === id) setSelectedId(null)
    },
  })

  // ── Helpers ──
  const symbolOf = (tpl: StrategyTemplate) =>
    tpl.scope?.coin_id ? coinById.get(tpl.scope.coin_id)?.symbol ?? "" : ""
  const timeframeOf = (tpl: StrategyTemplate) => tpl.scope?.interval ?? ""

  // ── Derived: filter + sort ──
  const filtered = useMemo(() => {
    let items = showOnlySelected ? templates.filter((tp) => selectedIds.has(tp.id)) : templates
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((tp) =>
        tp.name.toLowerCase().includes(q) ||
        strategyLabel(tp.strategy).toLowerCase().includes(q) ||
        symbolOf(tp).toLowerCase().includes(q) ||
        timeframeOf(tp).toLowerCase().includes(q),
      )
    }
    return [...items].sort((a, b) => {
      let va: string, vb: string
      switch (sortField) {
        case "name": va = a.name; vb = b.name; break
        case "strategy": va = strategyLabel(a.strategy); vb = strategyLabel(b.strategy); break
        case "coin": va = symbolOf(a); vb = symbolOf(b); break
        case "timeframe": va = timeframeOf(a); vb = timeframeOf(b); break
      }
      const cmp = va.localeCompare(vb, undefined, { numeric: true })
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [templates, showOnlySelected, selectedIds, search, sortField, sortDir, coinById])

  const selected = useMemo(() => templates.find((tp) => tp.id === selectedId) ?? null, [templates, selectedId])

  // ── Pagination (10 rows/page). Reset to page 1 when the visible set changes. ──
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [search, showOnlySelected, sortField, sortDir])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  // ── Actions ──
  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }
  function toggleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelect(id: string) {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function runConfirm() {
    if (!confirm) return
    if (confirm.action === "start") {
      const amount = Number.isFinite(investment) && investment > 0 ? investment : 100
      startMutation.mutate({ id: confirm.template.id, amount })
    } else {
      stopMutation.mutate(confirm.template.id)
    }
    setConfirm(null)
  }
  function handleBulkDelete() {
    ;[...selectedIds].forEach((id) => deleteMutation.mutate(id))
    setBulkDeleteOpen(false); setBulkUnderstood(false); setBulkConfirmText("")
    setSelectedIds(new Set())
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button onClick={() => toggleSort(field)} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors cursor-pointer">
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <ViewSwitcher
          options={[
            { id: "active", label: t("tabActive") },
            { id: "strategies", label: t("tabStrategies") },
          ]}
          value={topTab}
          onChange={setTopTab}
        />

        {/* ── Active ── */}
        {topTab === "active" && (
          <div className="mt-6 space-y-2">
            <div className="flex justify-end">
              <span className="text-xs text-[var(--muted-foreground)]">{t("pnlPending")}</span>
            </div>
            <ActiveStrategies
              runs={activeRuns}
              coinById={coinById}
              onStop={(run) => {
                const tpl = templates.find((tp) => tp.id === run.template_id)
                if (tpl) setConfirm({ template: tpl, action: "stop" })
              }}
              stopping={stopMutation.isPending}
              emptyLabel={t("activeEmpty")}
              labels={{ profitLoss: t("profitLoss"), thisRun: t("thisRun"), stop: t("stop"), trades: t("trades"), open: t("open") }}
            />
          </div>
        )}

        {/* ── Strategies ── */}
        {topTab === "strategies" && (
          <div className="mt-6 space-y-4">

          {/* Toolbar */}
          <div className="flex items-center justify-end gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <Input placeholder={t("searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 w-56 text-xs" />
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-1 cursor-pointer text-[var(--muted-foreground)] hover:text-foreground">
                          <Checkbox checked={filtered.length > 0 && filtered.every((tp) => selectedIds.has(tp.id))} />
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.map((tp) => tp.id)))}>{t("selectAll")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.filter((tp) => starredIds.has(tp.id)).map((tp) => tp.id)))}>{t("selectStarred")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedIds(new Set())}>{t("clearSelection")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="strategy" label={t("colStrategy")} /></TableHead>
                  <TableHead><SortHeader field="coin" label={t("colCoin")} /></TableHead>
                  <TableHead><SortHeader field="timeframe" label={t("colTimeframe")} /></TableHead>
                  <TableHead className="text-center">{t("colAction")}</TableHead>
                  <TableHead className="w-10 text-center" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-[var(--muted-foreground)]">{t("noTemplates")}</TableCell></TableRow>
                ) : pageItems.map((tpl) => {
                  const running = runningByTemplate.has(tpl.id)
                  return (
                    <TableRow
                      key={tpl.id}
                      data-state={selectedId === tpl.id ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(tpl.id)}
                      onContextMenu={(e) => { e.preventDefault(); toggleStar(tpl.id) }}
                    >
                      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(tpl.id)} onCheckedChange={() => toggleSelect(tpl.id)} />
                      </TableCell>
                      <TableCell className="font-medium">{tpl.name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs font-normal">{strategyLabel(tpl.strategy)}</Badge></TableCell>
                      <TableCell>{symbolOf(tpl) || <span className="text-[var(--muted-foreground)]">—</span>}</TableCell>
                      <TableCell className="font-mono text-xs">{timeframeOf(tpl) || "—"}</TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        {running ? (
                          <Button variant="secondary" size="sm" className="h-7 cursor-pointer" onClick={() => setConfirm({ template: tpl, action: "stop" })}>
                            <Square className="h-3.5 w-3.5 mr-1.5" />{t("stop")}
                          </Button>
                        ) : (
                          <Button variant="default" size="sm" className="h-7 cursor-pointer" onClick={() => setConfirm({ template: tpl, action: "start" })}>
                            <Play className="h-3.5 w-3.5 mr-1.5" />{t("start")}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => { e.stopPropagation(); toggleStar(tpl.id) }}>
                        <button className="cursor-pointer" aria-label={t("star")}>
                          <Star className={cn("h-4 w-4", starredIds.has(tpl.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Pagination */}
            {filtered.length > 0 && (
              <div className="flex items-center justify-between px-4 py-1.5 border-t">
                <span className="text-xs text-[var(--muted-foreground)]">
                  {t("showing", {
                    from: (safePage - 1) * PER_PAGE + 1,
                    to: Math.min(safePage * PER_PAGE, filtered.length),
                    total: filtered.length,
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
            )}

            {/* Selection action line */}
            {selectedIds.size > 0 && (
              <div className="flex items-center justify-between px-4 py-2 border-t bg-[var(--muted)]/30">
                <span className="text-xs text-[var(--muted-foreground)]">{t("selectedCount", { selected: selectedIds.size, total: filtered.length })}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer" onClick={() => setShowOnlySelected((v) => !v)} title={showOnlySelected ? t("showAll") : t("showOnlySelected")}>
                    <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer" onClick={() => { setBulkUnderstood(false); setBulkConfirmText(""); setBulkDeleteOpen(true) }} title={t("removeSelected")}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Detail pane ── */}
          {selected && (
            <section className="rounded-lg border overflow-hidden flex flex-col min-h-[24rem]">
              <div className="px-4 py-2 border-b bg-[var(--muted)]/30 text-sm font-semibold">{selected.name}</div>
              <TemplateDetailPane
                key={selected.id}
                template={selected}
                coinById={coinById}
                isRunning={runningByTemplate.has(selected.id)}
                onStartStop={(tpl, action) => setConfirm({ template: tpl, action })}
                onDelete={(tpl) => setDeleteTemplate(tpl)}
              />
            </section>
          )}
          </div>
        )}
      </div>

      {/* ── Start/Stop confirm ── */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirm?.action === "start" ? t("startConfirmTitle") : t("stopConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {confirm?.action === "start"
                ? t("startConfirmBody", { name: confirm?.template.name ?? "" })
                : t("stopConfirmBody", { name: confirm?.template.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          {confirm?.action === "start" && (
            <div className="flex flex-col gap-1.5 py-1">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("investment")}</label>
              <div className="relative">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={investment}
                  onChange={(e) => setInvestment(e.target.valueAsNumber)}
                  className="pr-14"
                  autoFocus
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">USDT</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>{t("cancel")}</Button>
            <Button size="sm" variant={confirm?.action === "stop" ? "secondary" : "default"} onClick={runConfirm}>
              {confirm?.action === "start" ? t("confirmStart") : t("confirmStop")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete single template (from detail pane) ── */}
      <Dialog open={!!deleteTemplate} onOpenChange={(o) => !o && setDeleteTemplate(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteOneBody", { name: deleteTemplate?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTemplate(null)}>{t("cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={() => { if (deleteTemplate) deleteMutation.mutate(deleteTemplate.id); setDeleteTemplate(null) }}>{t("deleteTemplate")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete ── */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("bulkDeleteTitle", { count: selectedIds.size })}</DialogTitle>
            <DialogDescription>{t("bulkDeleteDescription", { count: selectedIds.size })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={bulkUnderstood} onCheckedChange={(v) => setBulkUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("bulkDeleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm", { word: t("deleteConfirmWord") })}</label>
              <Input value={bulkConfirmText} onChange={(e) => setBulkConfirmText(e.target.value)} placeholder={t("deleteConfirmWord")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteOpen(false)}>{t("cancel")}</Button>
            <Button variant="destructive" size="sm" disabled={!bulkUnderstood || bulkConfirmText !== t("deleteConfirmWord")} onClick={handleBulkDelete}>
              {t("bulkDeleteConfirm", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
