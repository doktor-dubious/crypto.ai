"use client"

// Live Trading page. Mirrors the Paper Trade page but drives REAL Binance Spot
// execution (testnet or production) via the /live-trade API. Top: account status
// strip (testnet/live badge, balances, connection state), then active (running)
// strategies and the master table of strategy templates (shared with paper) with
// start/stop plus a detail pane. Stop liquidates any open position at market.

import { Fragment, useMemo, useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, ArrowUpDown, ChevronUp, ChevronDown, Star, Play, Trash2, Focus, TriangleAlert,
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
import { ActiveStrategies, type GroupByMode } from "@/components/trading/paper/active-strategies"
import { RunFilterBar, useRunFilters } from "@/components/trading/run-filters"
import { TemplateDetailPane } from "@/components/trading/live/template-detail-pane"
import {
  strategyTemplatesApi, liveTradeApi, coinsApi, coinGroupsApi, paperTradeApi,
  type StrategyTemplate, type PaperTradeRun,
} from "@/lib/api"

const STORAGE_PREFIX = "gorm:liveTrade:"
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

export default function LiveTradePage() {
  const t = useTranslations("liveTrade")
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
    queryKey: ["liveRuns", "active"],
    queryFn: () => liveTradeApi.listRuns(true),
    refetchInterval: 5000,
  })
  const { data: coinGroups = [] } = useQuery({
    queryKey: ["coin-groups"],
    queryFn: () => coinGroupsApi.list(),
  })
  // The real exchange account behind this page — testnet/production flag, key
  // configuration state and balances. Everything Start-related gates on it.
  const { data: account } = useQuery({
    queryKey: ["liveAccount"],
    queryFn: () => liveTradeApi.account(),
    refetchInterval: 30000,
  })
  const startDisabled = !!account && !account.configured

  // Non-zero balances, USDT first then largest first — capped so the strip
  // stays a single compact line.
  const balanceEntries = useMemo(() => {
    if (!account?.balances) return []
    return Object.entries(account.balances)
      .filter(([, v]) => v > 0)
      .sort((a, b) => {
        if (a[0] === "USDT") return -1
        if (b[0] === "USDT") return 1
        return b[1] - a[1]
      })
      .slice(0, 4)
  }, [account])

  const coinById = useMemo(() => new Map(coins.map((c) => [c.id, c])), [coins])
  const runningByTemplate = useMemo(
    () => new Map(activeRuns.map((r) => [r.template_id, r])),
    [activeRuns],
  )

  // Active-tab display filters — three multi-selects over the coin groups /
  // coins / strategies that currently have running trades, shared with the
  // paper page (see components/trading/run-filters.tsx).
  const runFilters = useRunFilters({
    runs: activeRuns,
    coinGroups,
    coinById,
    storagePrefix: STORAGE_PREFIX,
    ungroupedLabel: t("ungrouped"),
  })
  const visibleRuns = runFilters.filtered

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

  // Active-tab controls: "Active Up" promotes open/most-recently-traded to the
  // top; "Group by" collapses runs into aggregate cards. Both persist.
  const [activeUp, setActiveUp] = useState<boolean>(() => loadJson<boolean>("activeUp", false))
  useEffect(() => { saveJson("activeUp", activeUp) }, [activeUp])
  const [groupBy, setGroupBy] = useState<GroupByMode>(() => loadJson<GroupByMode>("groupBy", "none"))
  useEffect(() => { saveJson("groupBy", groupBy) }, [groupBy])
  // Confirm dialog for stopping every run in an aggregate card.
  const [stopMany, setStopMany] = useState<{ runs: PaperTradeRun[]; label: string } | null>(null)

  // Strategies tab: same "Group by" control — collapses templates into groups
  // that can be started together. Its own persisted state (separate from Active).
  const [strGroupBy, setStrGroupBy] = useState<GroupByMode>(() => loadJson<GroupByMode>("strGroupBy", "none"))
  useEffect(() => { saveJson("strGroupBy", strGroupBy) }, [strGroupBy])
  // Confirm dialog for starting every template in a group.
  const [startGroup, setStartGroup] = useState<{ templates: StrategyTemplate[]; label: string } | null>(null)

  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson("sortField", sortField) }, [sortField])
  useEffect(() => { saveJson("sortDir", sortDir) }, [sortDir])
  useEffect(() => { saveJson("selected", selectedId) }, [selectedId])

  // ── Dialogs ──
  // Tick guard: coins where one tick exceeds ~0.1% of the price. A live run
  // there pays that tick crossing the spread on EVERY round trip — the start
  // dialogs warn before real (testnet or production) orders go out.
  const { data: tickLimited } = useQuery({
    queryKey: ["paperTickLimited"],
    queryFn: paperTradeApi.tickLimited,
    staleTime: 10 * 60_000,
  })
  const tickSymbol = (tpl: StrategyTemplate | null | undefined) =>
    (tickLimited?.coins ?? []).find((c) => c.id === tpl?.scope?.coin_id)?.symbol ?? null
  const tickWarn = (symbols: string[]) => (
    <p className="text-xs font-medium text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
      {t("liveTickLimitedWarning", {
        symbols: symbols.join(", "),
        pct: tickLimited?.tick_pct_limit ?? 0.1,
      })}
    </p>
  )
  // For "start" the run is created fresh; for "stop" we carry the specific run to
  // stop (a template can have several running at once).
  const [confirm, setConfirm] = useState<{ template: StrategyTemplate; action: "start" | "stop"; run?: PaperTradeRun } | null>(null)
  // "Go Live" from the paper page drops a template id here; pick it up on mount,
  // switch to the strategies tab, select it, and open the start confirm.
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  useEffect(() => {
    let id: string | null = null
    try { id = localStorage.getItem("gorm:liveTrade:pendingStart") } catch { /* ignore */ }
    if (id) {
      try { localStorage.removeItem("gorm:liveTrade:pendingStart") } catch { /* ignore */ }
      setPendingStart(id)
      setTopTab("strategies")
      setSelectedId(id)
    }
  }, [])
  // Once templates load, open the start confirm for the pending template.
  useEffect(() => {
    if (!pendingStart) return
    const tpl = templates.find((tp) => tp.id === pendingStart)
    if (tpl) { setConfirm({ template: tpl, action: "start" }); setPendingStart(null) }
  }, [pendingStart, templates])
  // Investment for the next started run — remembered across trades (default 100).
  const [investment, setInvestment] = useState<number>(() => loadJson<number>("investment", 100))
  useEffect(() => { saveJson("investment", investment) }, [investment])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkUnderstood, setBulkUnderstood] = useState(false)
  const [bulkConfirmText, setBulkConfirmText] = useState("")
  const [deleteTemplate, setDeleteTemplate] = useState<StrategyTemplate | null>(null)

  // ── Mutations ──
  const invalidateRuns = () => {
    queryClient.invalidateQueries({ queryKey: ["liveRuns"] })
    queryClient.invalidateQueries({ queryKey: ["liveAccount"] })
  }
  // Surface the backend's error detail (keys not configured / exchange check
  // failed) instead of a generic toast — starting a live run can 400/502.
  const errorDetail = (e: unknown) => {
    if (e instanceof Error) {
      const m = e.message.match(/"detail"\s*:\s*"([^"]+)"/)
      if (m) return m[1]
    }
    return null
  }
  const startMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => liveTradeApi.start(id, amount),
    onSuccess: () => { invalidateRuns(); toast.success(t("started")) },
    onError: (e) => toast.error(errorDetail(e) ?? t("actionError")),
  })
  const stopMutation = useMutation({
    mutationFn: (runId: string) => liveTradeApi.stop(runId),
    onSuccess: () => { invalidateRuns(); toast.success(t("stopped")) },
    onError: (e) => toast.error(errorDetail(e) ?? t("actionError")),
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

  // ── Grouped sections (Strategies tab). Null when grouping is off; otherwise
  // the pagination below runs over groups (each group + all its templates). ──
  const groupedSections = useMemo(() => {
    if (strGroupBy === "none") return null
    let keyOf: (tpl: StrategyTemplate) => { key: string; title: string }
    if (strGroupBy === "coins") {
      keyOf = (tpl) => {
        const cid = tpl.scope?.coin_id
        return { key: `coin:${cid ?? "none"}`, title: (cid ? coinById.get(cid)?.symbol : null) ?? t("ungrouped") }
      }
    } else if (strGroupBy === "strategies") {
      keyOf = (tpl) => ({ key: `strat:${tpl.strategy}`, title: strategyLabel(tpl.strategy) })
    } else {
      const sorted = [...coinGroups].sort((a, b) => a.name.localeCompare(b.name))
      const coinToGroup = new Map<string, { id: string; name: string }>()
      for (const g of sorted) for (const cid of g.member_coin_ids) if (!coinToGroup.has(cid)) coinToGroup.set(cid, { id: g.id, name: g.name })
      keyOf = (tpl) => {
        const cid = tpl.scope?.coin_id
        const g = cid ? coinToGroup.get(cid) : undefined
        return g ? { key: `cg:${g.id}`, title: g.name } : { key: "cg:ungrouped", title: t("ungrouped") }
      }
    }
    const order: string[] = []
    const byKey = new Map<string, { title: string; items: StrategyTemplate[] }>()
    for (const tpl of filtered) {
      const { key, title } = keyOf(tpl)
      let bucket = byKey.get(key)
      if (!bucket) { bucket = { title, items: [] }; byKey.set(key, bucket); order.push(key) }
      bucket.items.push(tpl)
    }
    return order.map((key) => ({ key, ...byKey.get(key)! }))
  }, [strGroupBy, filtered, coinById, coinGroups, t])

  // ── Pagination (10 per page). Always paginates by ROW (template), even when
  // grouped — grouping just inserts a header before each group's first row on the
  // page. Reset to page 1 whenever the visible set or grouping changes. ──
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [search, showOnlySelected, sortField, sortDir, strGroupBy])
  // Grouped templates flattened in group order, each tagged with its group meta.
  const orderedGrouped = useMemo(
    () => (groupedSections ? groupedSections.flatMap((s) => s.items.map((tpl) => ({ tpl, key: s.key, title: s.title, items: s.items }))) : null),
    [groupedSections],
  )
  const paginationTotal = filtered.length
  const totalPages = Math.max(1, Math.ceil(paginationTotal / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)
  const pageGrouped = orderedGrouped ? orderedGrouped.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE) : null

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
      if (startDisabled) return
      const amount = Number.isFinite(investment) && investment > 0 ? investment : 100
      startMutation.mutate({ id: confirm.template.id, amount })
    } else if (confirm.run) {
      stopMutation.mutate(confirm.run.id)
    }
    setConfirm(null)
  }
  function handleBulkDelete() {
    ;[...selectedIds].forEach((id) => deleteMutation.mutate(id))
    setBulkDeleteOpen(false); setBulkUnderstood(false); setBulkConfirmText("")
    setSelectedIds(new Set())
  }
  function startGroupConfirm() {
    if (!startGroup || startDisabled) return
    const amount = Number.isFinite(investment) && investment > 0 ? investment : 100
    startGroup.templates.forEach((tpl) => startMutation.mutate({ id: tpl.id, amount }))
    setStartGroup(null)
  }

  // One template row — shared between the flat and grouped table bodies.
  const renderTemplateRow = (tpl: StrategyTemplate) => (
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
        <Button variant="default" size="sm" className="h-7 cursor-pointer" disabled={startDisabled} onClick={() => setConfirm({ template: tpl, action: "start" })}>
          <Play className="h-3.5 w-3.5 mr-1.5" />{t("startNew")}
        </Button>
      </TableCell>
      <TableCell className="text-center" onClick={(e) => { e.stopPropagation(); toggleStar(tpl.id) }}>
        <button className="cursor-pointer" aria-label={t("star")}>
          <Star className={cn("h-4 w-4", starredIds.has(tpl.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
        </button>
      </TableCell>
    </TableRow>
  )

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
    // `relative` anchors the maximized detail pane (absolute inset-0) to the
    // page area — without it the pane resolves against the viewport and covers
    // the dashboard footer.
    <div className="relative flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* ── Account status strip — the real exchange account behind this page ── */}
        {account && (
          <div className="mb-5 flex flex-col gap-2">
            <div className="rounded-lg border px-4 py-2.5 flex items-center gap-3 flex-wrap">
              {account.testnet ? (
                <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400 font-semibold">
                  {t("accountTestnet")}
                </Badge>
              ) : (
                <Badge variant="destructive" className="font-semibold">{t("accountLive")}</Badge>
              )}
              {account.can_trade != null && (
                <span className={cn("text-xs font-medium", account.can_trade ? "text-emerald-500" : "text-red-500")}>
                  {account.can_trade ? t("accountCanTrade") : t("accountCannotTrade")}
                </span>
              )}
              {balanceEntries.length > 0 && (
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-[var(--muted-foreground)]">{t("accountBalances")}</span>
                  {balanceEntries.map(([asset, v]) => (
                    <Badge key={asset} variant="secondary" className="text-xs font-normal">
                      <span className="text-[var(--muted-foreground)] mr-1">{asset}</span>
                      <span className="font-mono tabular-nums">{v.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                    </Badge>
                  ))}
                </span>
              )}
              {account.error && (
                <span className="text-xs text-red-500">{t("accountError")}: {account.error}</span>
              )}
            </div>
            {!account.configured && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
                <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
                {t("accountNotConfigured")}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <ViewSwitcher
            options={[
              { id: "active", label: t("tabActive") },
              { id: "strategies", label: t("tabStrategies") },
            ]}
            value={topTab}
            onChange={setTopTab}
          />
          {topTab === "active" && (
            <div className="flex items-center gap-3 flex-wrap ml-auto">
              <Button
                variant={activeUp ? "default" : "outline"}
                size="sm"
                className="h-8 cursor-pointer"
                onClick={() => setActiveUp((v) => !v)}
                title={t("activeUpTooltip")}
              >
                {t("activeUp")}
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">{t("groupBy")}</span>
                <ViewSwitcher
                  options={[
                    { id: "none", label: t("groupByNone") },
                    { id: "groups", label: t("groupByCoinGroups") },
                    { id: "coins", label: t("groupByCoins") },
                    { id: "strategies", label: t("groupByStrategies") },
                  ]}
                  value={groupBy}
                  onChange={(v) => setGroupBy(v as GroupByMode)}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Active ── */}
        {topTab === "active" && (
          <div className="mt-6 space-y-2">
            {activeRuns.length > 0 && (
              <RunFilterBar
                filters={runFilters}
                labels={{
                  hiddenByFilters: (n) => t("hiddenByFilters", { n }),
                  showAll: t("showAll"),
                  filterBy: t("filterBy"),
                  groups: t("groupByCoinGroups"),
                  coins: t("groupByCoins"),
                  strategies: t("groupByStrategies"),
                  all: t("filterAll"),
                  none: t("filterNone"),
                }}
              />
            )}
            <ActiveStrategies
              runs={visibleRuns}
              coinById={coinById}
              coinGroups={coinGroups}
              groupBy={groupBy}
              activeUp={activeUp}
              onStopRun={(run) => {
                const tpl = templates.find((tp) => tp.id === run.template_id)
                if (tpl) setConfirm({ template: tpl, action: "stop", run })
              }}
              onStopMany={(runs, label) => setStopMany({ runs, label })}
              stopping={stopMutation.isPending}
              emptyLabel={activeRuns.length > 0 ? t("activeFilteredEmpty") : t("activeEmpty")}
              labels={{
                profitLoss: t("profitLoss"), thisRun: t("thisRun"), stop: t("stop"),
                trades: t("trades"), open: t("open"), uptime: t("uptime"),
                runsSuffix: t("runsSuffix"), mixed: t("mixed"), ungrouped: t("ungrouped"),
                goLive: t("goLive"),
              }}
            />
          </div>
        )}

        {/* ── Strategies ── */}
        {topTab === "strategies" && (
          <div className="mt-6 space-y-4">

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted-foreground)] shrink-0">{t("groupBy")}</span>
              <ViewSwitcher
                options={[
                  { id: "none", label: t("groupByNone") },
                  { id: "groups", label: t("groupByCoinGroups") },
                  { id: "coins", label: t("groupByCoins") },
                  { id: "strategies", label: t("groupByStrategies") },
                ]}
                value={strGroupBy}
                onChange={(v) => setStrGroupBy(v as GroupByMode)}
              />
            </div>
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
                ) : pageGrouped ? (
                  pageGrouped.map((row, idx) => {
                    const showHeader = idx === 0 || pageGrouped[idx - 1].key !== row.key
                    const running = row.items.filter((tp) => runningByTemplate.has(tp.id)).length
                    return (
                      <Fragment key={row.tpl.id}>
                        {showHeader && (
                          <TableRow className="bg-[var(--muted)]/40 hover:bg-[var(--muted)]/40">
                            <TableCell colSpan={7} className="py-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2 text-xs font-semibold">
                                  {row.title}
                                  <span className="font-normal text-[var(--muted-foreground)] tabular-nums">{row.items.length}</span>
                                  {running > 0 && (
                                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">{t("runningCount", { count: running })}</Badge>
                                  )}
                                </span>
                                <Button
                                  variant="default" size="sm" className="h-7 cursor-pointer"
                                  disabled={startDisabled}
                                  onClick={() => setStartGroup({ templates: row.items, label: row.title })}
                                >
                                  <Play className="h-3.5 w-3.5 mr-1.5" />{t("startAll", { count: row.items.length })}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        {renderTemplateRow(row.tpl)}
                      </Fragment>
                    )
                  })
                ) : (
                  pageItems.map(renderTemplateRow)
                )}
              </TableBody>
            </Table>

            {/* Pagination — over templates (flat) or groups (grouped) */}
            {paginationTotal > 0 && (
              <div className="flex items-center justify-between px-4 py-1.5 border-t">
                <span className="text-xs text-[var(--muted-foreground)]">
                  {t("showing", {
                    from: (safePage - 1) * PER_PAGE + 1,
                    to: Math.min(safePage * PER_PAGE, paginationTotal),
                    total: paginationTotal,
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
                startDisabled={startDisabled}
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
            <div className="flex flex-col gap-2 py-1">
              <div className="flex flex-col gap-1.5">
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
              <p className="text-xs text-amber-600 dark:text-amber-400">{t("startCaution")}</p>
              {(() => { const s = tickSymbol(confirm?.template); return s ? tickWarn([s]) : null })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>{t("cancel")}</Button>
            <Button
              size="sm"
              variant={confirm?.action === "stop" ? "secondary" : "default"}
              disabled={confirm?.action === "start" && startDisabled}
              onClick={runConfirm}
            >
              {confirm?.action === "start" ? t("confirmStart") : t("confirmStop")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Stop all runs in an aggregate card ── */}
      <Dialog open={!!stopMany} onOpenChange={(o) => !o && setStopMany(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("stopManyTitle")}</DialogTitle>
            <DialogDescription>{t("stopManyBody", { count: stopMany?.runs.length ?? 0, label: stopMany?.label ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setStopMany(null)}>{t("cancel")}</Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                stopMany?.runs.forEach((r) => stopMutation.mutate(r.id))
                setStopMany(null)
              }}
            >
              {t("confirmStopMany", { count: stopMany?.runs.length ?? 0 })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Start all templates in a group ── */}
      <Dialog open={!!startGroup} onOpenChange={(o) => !o && setStartGroup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("startGroupTitle")}</DialogTitle>
            <DialogDescription>{t("startGroupBody", { count: startGroup?.templates.length ?? 0, label: startGroup?.label ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("investmentEach")}</label>
              <div className="relative">
                <Input
                  type="number" min={1} step={1} value={investment}
                  onChange={(e) => setInvestment(e.target.valueAsNumber)}
                  className="pr-14" autoFocus
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">USDT</span>
              </div>
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("startCaution")}</p>
            {(() => {
              const symbols = [...new Set((startGroup?.templates ?? []).map(tickSymbol).filter((s): s is string => s !== null))]
              return symbols.length > 0 ? tickWarn(symbols) : null
            })()}
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setStartGroup(null)}>{t("cancel")}</Button>
            <Button size="sm" disabled={startDisabled} onClick={startGroupConfirm}>{t("confirmStartGroup", { count: startGroup?.templates.length ?? 0 })}</Button>
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
