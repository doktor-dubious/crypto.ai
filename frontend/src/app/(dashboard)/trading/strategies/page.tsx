"use client"

// Trading → Strategies → List. Every saved strategy in one master table, with
// the same detail pane Paper Trade used to carry (Details / Data / AI / Trades /
// Analyze / Actions).
//
// This is the middle of the pipeline: strategies are CREATED on the analysis
// workbenches (Strategies → New) and PAPER TRADED from here. Paper Trade itself
// went back to being the run monitor — it no longer owns this table.
//
// A row is either a concrete strategy (pinned to one coin / pair / timeframe) or
// an ABSTRACT one (parameters only — the market is chosen when a run starts).

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  ArrowUpDown, ChevronDown, ChevronUp, Focus, Globe, Play, Search, Star, Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { ViewSwitcher } from "@/components/ui/view-switcher"
import { cn } from "@/lib/utils"
import { strategyLabel } from "@/components/trading/strategy-meta"
import { TemplateDetailPane } from "@/components/trading/paper/template-detail-pane"
import { StartRunDialog, type RunTarget } from "@/components/trading/strategies/start-run-dialog"
import {
  coinGroupsApi, coinsApi, liveTradeApi, paperTradeApi, strategyTemplatesApi,
  type StrategyTemplate, type StrategyTemplateScope, type TradeSource,
} from "@/lib/api"

const STORAGE_PREFIX = "gorm:strategies:"
const PER_PAGE = 10

type SortField = "name" | "strategy" | "kind" | "coin" | "timeframe" | "created" | "trades" | "pnl"
type GroupByMode = "none" | "groups" | "coins" | "strategies" | "kind"

// Sort defaults to newest-first: a strategy you just saved on a workbench sorts
// to the top row rather than alphabetically into the middle of a paged table,
// where it reads as a save that silently failed. The persisted keys carry a
// version suffix so a browser holding the old name/asc default picks this up.
const SORT_FIELD_KEY = "sortField.v2"
const SORT_DIR_KEY = "sortDir.v2"

// Compact enough to sit in a table column, precise enough to tell two saves of
// the same strategy a minute apart apart.
const createdAt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  })

// Ordered by consequence: simulated → real orders, fake money → real money.
const ALL_VENUES: TradeSource[] = ["paper", "testnet", "live"]

// Where a strategy is running, at a glance. Three fixed slots so the column stays
// scannable down the page; an unlit slot means "not running there". Live is the
// one that has to be unmistakable, so it gets the alarm colour.
const VENUE_DOT: Record<TradeSource, string> = {
  paper: "bg-emerald-500",
  testnet: "bg-amber-500",
  live: "bg-red-500",
}

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

export default function StrategiesPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <StrategiesList />
    </Suspense>
  )
}

function StrategiesList() {
  const t = useTranslations("strategies")
  const tp = useTranslations("paperTrade")
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  // ── Data ──
  const { data: templates = [] } = useQuery({
    queryKey: ["strategyTemplates", "all"],
    queryFn: () => strategyTemplatesApi.list(),
  })
  const { data: coins = [] } = useQuery({
    queryKey: ["coins"],
    queryFn: () => coinsApi.list({ limit: 1000 }),
  })
  const { data: coinGroups = [] } = useQuery({
    queryKey: ["coin-groups"],
    queryFn: () => coinGroupsApi.list(),
  })
  // Every run, not just the active ones — the "#N" run-name suffix counts runs
  // started today whether or not they are still going, and the Trades column
  // reports a strategy's whole record.
  const { data: allRuns = [] } = useQuery({
    queryKey: ["paperRuns", "all"],
    queryFn: () => paperTradeApi.listRuns(),
    refetchInterval: 15000,
  })
  const { data: allLiveRuns = [] } = useQuery({
    queryKey: ["liveRuns", "all"],
    queryFn: () => liveTradeApi.listRuns(),
    refetchInterval: 15000,
  })

  const coinById = useMemo(() => new Map(coins.map((c) => [c.id, c])), [coins])
  const runningTemplateIds = useMemo(
    () => new Set(
      [...allRuns, ...allLiveRuns].filter((r) => r.status === "running").map((r) => r.template_id),
    ),
    [allRuns, allLiveRuns],
  )

  // Per-strategy record, kept SPLIT BY VENUE rather than pre-pooled. Paper fills,
  // testnet orders and real money are three different claims about a strategy, so
  // the table lets you pick which ones the Trades column speaks for — and the
  // running dots show where it is executing right now.
  const statsByTemplate = useMemo(() => {
    type VenueStat = { trades: number; pnl: number; capital: number; running: boolean }
    const acc = new Map<string, Map<TradeSource, VenueStat>>()
    const add = (
      templateId: string, venue: TradeSource,
      nTrades: number, pnl: number | null, capital: number, running: boolean,
    ) => {
      let byVenue = acc.get(templateId)
      if (!byVenue) { byVenue = new Map(); acc.set(templateId, byVenue) }
      const row = byVenue.get(venue) ?? { trades: 0, pnl: 0, capital: 0, running: false }
      row.trades += nTrades
      row.running ||= running
      // Only runs with a P/L reading contribute to the ratio, so a just-started
      // run can't dilute the percentage with its stake and no result.
      if (pnl != null) { row.pnl += pnl; row.capital += capital }
      byVenue.set(venue, row)
    }
    for (const r of allRuns) {
      add(r.template_id, "paper", r.n_trades, r.pnl.total, r.initial_capital, r.status === "running")
    }
    for (const r of allLiveRuns) {
      add(r.template_id, r.is_testnet ? "testnet" : "live",
          r.n_trades, r.pnl.total, r.initial_capital, r.status === "running")
    }
    return acc
  }, [allRuns, allLiveRuns])

  // ── Table state ──
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>(() => loadJson<SortField>(SORT_FIELD_KEY, "created"))
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => loadJson<"asc" | "desc">(SORT_DIR_KEY, "desc"))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(() => loadJson<string | null>("selected", null))
  // The run the pane's Trades tab should open on, when the selection came from a
  // row that stood for one specific run. Not persisted — it's a property of the
  // click, not of the selection.
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupByMode>(() => loadJson<GroupByMode>("groupBy", "none"))
  // Which venues the Trades column speaks for. All three by default — the column
  // then reports a strategy's whole record, and untick to read one venue alone.
  // Note this filters the FIGURES, not the rows: a strategy with no trades on the
  // ticked venues still lists, it just has nothing to report.
  const [venues, setVenues] = useState<Set<TradeSource>>(
    () => new Set(loadJson<TradeSource[]>("venues", [...ALL_VENUES])),
  )
  useEffect(() => { saveJson("venues", [...venues]) }, [venues])

  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson(SORT_FIELD_KEY, sortField) }, [sortField])
  useEffect(() => { saveJson(SORT_DIR_KEY, sortDir) }, [sortDir])
  useEffect(() => { saveJson("selected", selectedId) }, [selectedId])
  useEffect(() => { saveJson("groupBy", groupBy) }, [groupBy])

  // Deep link from Paper Trade's Active / Sweep tabs: ?selected=<id>&run=<runId>.
  // Consumed once and stripped from the URL, so a later in-page selection isn't
  // snapped back to it on the next render.
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current) return
    const id = searchParams.get("selected")
    if (!id) return
    deepLinked.current = true
    setSearch("")
    setShowOnlySelected(false)
    setSelectedId(id)
    setSelectedRunId(searchParams.get("run"))
    router.replace("/trading/strategies")
  }, [searchParams, router])

  // ── Dialogs ──
  const [startTemplate, setStartTemplate] = useState<StrategyTemplate | null>(null)
  // Paper investment for the next started run — remembered across runs (default 100).
  const [investment, setInvestment] = useState<number>(() => loadJson<number>("investment", 100))
  useEffect(() => { if (Number.isFinite(investment)) saveJson("investment", investment) }, [investment])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkUnderstood, setBulkUnderstood] = useState(false)
  const [bulkConfirmText, setBulkConfirmText] = useState("")
  const [deleteTemplate, setDeleteTemplate] = useState<StrategyTemplate | null>(null)

  // ── Mutations ──
  const startMutation = useMutation({
    // The target decides which executor gets the run — and for the two exchange
    // venues, which Binance account it is frozen to for life.
    mutationFn: ({ id, amount, name, scope, target }: {
      id: string
      amount: number
      name: string
      scope: StrategyTemplateScope | null
      target: RunTarget
    }) =>
      target === "paper"
        ? paperTradeApi.start(id, amount, { name, scope })
        : liveTradeApi.start(id, amount, { testnet: target === "testnet", name, scope }),
    onSuccess: (_run, { target }) => {
      queryClient.invalidateQueries({ queryKey: ["paperRuns"] })
      queryClient.invalidateQueries({ queryKey: ["liveRuns"] })
      setStartTemplate(null)
      const destination = target === "paper" ? "/trading/paper" : "/trading/live"
      toast.success(t(target === "paper" ? "started" : "startedLive"), {
        action: { label: t("startedOpen"), onClick: () => router.push(destination) },
      })
    },
    // The API explains WHY (missing keys, exchange unreachable, budget below the
    // exchange minimum) and that is exactly what the user needs to act on, so
    // surface it rather than a generic failure.
    onError: (err: Error) => toast.error(err.message || t("startError")),
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
  // Only the unusual case is worth a word: an abstract strategy is flagged, a
  // market-bound one is left blank because the Coin and Timeframe columns beside
  // it already say which market it is bound to. Drives search and sort too, so
  // typing "abstract" finds them and sorting groups them together.
  const venueLabel = (v: TradeSource) =>
    v === "paper" ? t("venuePaper") : v === "testnet" ? t("venueTestnet") : t("venueLive")
  const kindOf = (tpl: StrategyTemplate) => (tpl.is_abstract ? t("kindAbstract") : "")
  // Group headers still need naming on both sides of the split.
  const kindGroupTitle = (tpl: StrategyTemplate) => (tpl.is_abstract ? t("kindAbstract") : t("kindFixed"))
  // An abstract strategy has no market of its own — say so rather than showing a
  // blank cell, which reads as missing data.
  const marketCell = (tpl: StrategyTemplate, value: string) =>
    tpl.is_abstract
      ? <span className="text-[var(--muted-foreground)] italic">{t("any")}</span>
      : value || <span className="text-[var(--muted-foreground)]">—</span>

  // The strategy's record over the TICKED venues only: trade count, and what
  // those trades returned on the capital behind them (capital-weighted, the only
  // way to combine runs that started with different stakes). The percentage is
  // omitted until a run reports a P/L, so a fresh strategy reads its count
  // rather than a fake 0.00%.
  const recordOf = (tpl: StrategyTemplate) => {
    const byVenue = statsByTemplate.get(tpl.id)
    if (!byVenue) return null
    let trades = 0, pnl = 0, capital = 0
    const contributing: TradeSource[] = []
    for (const v of ALL_VENUES) {
      if (!venues.has(v)) continue
      const s = byVenue.get(v)
      if (!s) continue
      trades += s.trades; pnl += s.pnl; capital += s.capital
      if (s.trades > 0) contributing.push(v)
    }
    return { trades, pct: capital ? (100 * pnl) / capital : null, contributing }
  }

  const tradesCell = (tpl: StrategyTemplate) => {
    const rec = recordOf(tpl)
    if (!rec || rec.trades === 0) return <span className="text-[var(--muted-foreground)]">—</span>
    // Real money mixed with paper is a caveat, not a footnote — and now it's one
    // the reader can resolve by unticking a venue.
    const mixed = rec.contributing.length > 1
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title={
          mixed
            ? t("tradesMixedVenues", { venues: rec.contributing.map((v) => venueLabel(v)).join(", ") })
            : t("tradesOneVenue", { venue: venueLabel(rec.contributing[0]) })
        }
      >
        <span>{rec.trades.toLocaleString("en-US")}</span>
        {rec.pct != null && (
          <span className={cn("font-mono", rec.pct >= 0 ? "text-emerald-500" : "text-red-500")}>
            ({rec.pct > 0 ? "+" : ""}{rec.pct.toFixed(2)}%)
          </span>
        )}
        {mixed && <span className="text-amber-500" aria-hidden>*</span>}
      </span>
    )
  }

  // Three fixed slots — lit where the strategy has a RUNNING run right now.
  // Independent of the venue tick-boxes: those scope the reported figures, this
  // reports live state, and hiding it would be hiding that money is at work.
  const runningDots = (tpl: StrategyTemplate) => {
    const byVenue = statsByTemplate.get(tpl.id)
    const live = ALL_VENUES.filter((v) => byVenue?.get(v)?.running)
    return (
      <span
        className="inline-flex items-center gap-1 shrink-0"
        title={live.length ? t("runningOn", { venues: live.map((v) => venueLabel(v)).join(", ") }) : t("notRunning")}
      >
        {ALL_VENUES.map((v) => (
          <span
            key={v}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              byVenue?.get(v)?.running ? VENUE_DOT[v] : "bg-[var(--muted-foreground)]/20",
            )}
          />
        ))}
      </span>
    )
  }

  // Runs of a strategy started today — the "#N" in the suggested run name.
  const sameDayRuns = useMemo(() => {
    if (!startTemplate) return 0
    const today = new Date().toDateString()
    return allRuns.filter(
      (r) => r.template_id === startTemplate.id && new Date(r.started_at).toDateString() === today,
    ).length
  }, [allRuns, startTemplate])

  // ── Derived: filter + sort ──
  const filtered = useMemo(() => {
    let items = showOnlySelected ? templates.filter((tp2) => selectedIds.has(tp2.id)) : templates
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((tpl) =>
        tpl.name.toLowerCase().includes(q) ||
        strategyLabel(tpl.strategy).toLowerCase().includes(q) ||
        kindOf(tpl).toLowerCase().includes(q) ||
        symbolOf(tpl).toLowerCase().includes(q) ||
        timeframeOf(tpl).toLowerCase().includes(q),
      )
    }
    return [...items].sort((a, b) => {
      // Created compares as an instant, not as its rendered text — the column
      // shows "Aug 6, 20:08", which would sort alphabetically by month name.
      if (sortField === "created") {
        const d = Date.parse(a.created_at) - Date.parse(b.created_at)
        const cmpC = d === 0 ? a.name.localeCompare(b.name) : d
        return sortDir === "asc" ? cmpC : -cmpC
      }
      // Numeric columns compare as numbers; an untraded strategy sorts below
      // every traded one rather than tying with a genuine 0.00%.
      if (sortField === "trades" || sortField === "pnl") {
        const num = (tpl: StrategyTemplate) => {
          const rec = recordOf(tpl)
          if (!rec || rec.trades === 0) return -Infinity
          return sortField === "trades" ? rec.trades : rec.pct ?? -Infinity
        }
        const d = num(a) - num(b)
        const cmpN = d === 0 ? a.name.localeCompare(b.name) : d
        return sortDir === "asc" ? cmpN : -cmpN
      }
      let va: string, vb: string
      switch (sortField) {
        case "name": va = a.name; vb = b.name; break
        case "strategy": va = strategyLabel(a.strategy); vb = strategyLabel(b.strategy); break
        case "kind": va = kindOf(a); vb = kindOf(b); break
        case "coin": va = symbolOf(a); vb = symbolOf(b); break
        case "timeframe": va = timeframeOf(a); vb = timeframeOf(b); break
      }
      const cmp = va.localeCompare(vb, undefined, { numeric: true })
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [templates, showOnlySelected, selectedIds, search, sortField, sortDir, coinById, statsByTemplate, venues]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => templates.find((tpl) => tpl.id === selectedId) ?? null, [templates, selectedId])

  // ── Grouped sections. Null when grouping is off. ──
  const groupedSections = useMemo(() => {
    if (groupBy === "none") return null
    let keyOf: (tpl: StrategyTemplate) => { key: string; title: string }
    if (groupBy === "coins") {
      keyOf = (tpl) => {
        const cid = tpl.scope?.coin_id
        return { key: `coin:${cid ?? "none"}`, title: (cid ? coinById.get(cid)?.symbol : null) ?? t("ungrouped") }
      }
    } else if (groupBy === "strategies") {
      keyOf = (tpl) => ({ key: `strat:${tpl.strategy}`, title: strategyLabel(tpl.strategy) })
    } else if (groupBy === "kind") {
      keyOf = (tpl) => ({ key: `kind:${tpl.is_abstract}`, title: kindGroupTitle(tpl) })
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
  }, [groupBy, filtered, coinById, coinGroups, t]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pagination (10 per page). Always paginates by ROW, even when grouped —
  // grouping just inserts a header before each group's first row on the page. ──
  const [page, setPage] = useState(1)
  // Reset to page 1 when the view actually CHANGES — never on mount, and never
  // on a re-run with unchanged values. A plain `[deps] → setPage(1)` effect also
  // fires on mount, where it raced the "page to the selected row" effect below
  // and won under React Strict Mode (dev double-invokes effects: the paging
  // effect is ref-guarded and no-ops on the second pass, this one is not). The
  // table then sat on page 1 while the detail pane showed a strategy from
  // page 5. Comparing the values rather than relying on the dep array makes the
  // reset idempotent, so replaying an effect can't move the page.
  const lastViewRef = useRef<string | null>(null)
  useEffect(() => {
    const view = JSON.stringify([search, showOnlySelected, sortField, sortDir, groupBy])
    if (lastViewRef.current === view) return
    const isFirst = lastViewRef.current === null
    lastViewRef.current = view
    if (!isFirst) setPage(1)
  }, [search, showOnlySelected, sortField, sortDir, groupBy])
  const orderedGrouped = useMemo(
    () => (groupedSections ? groupedSections.flatMap((s) => s.items.map((tpl) => ({ tpl, key: s.key, title: s.title, items: s.items }))) : null),
    [groupedSections],
  )
  const paginationTotal = filtered.length
  const totalPages = Math.max(1, Math.ceil(paginationTotal / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)
  const pageGrouped = orderedGrouped ? orderedGrouped.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE) : null

  // ── Keep the selected strategy on screen ──
  // Which page holds it, in whatever order the table is currently showing.
  const pageOfSelected = useMemo(() => {
    if (!selectedId) return null
    const order = orderedGrouped ? orderedGrouped.map((g) => g.tpl) : filtered
    const idx = order.findIndex((tpl) => tpl.id === selectedId)
    return idx < 0 ? null : Math.floor(idx / PER_PAGE) + 1
  }, [selectedId, orderedGrouped, filtered])
  // Jump there once per selection. A deep link only sets selectedId — the table
  // would otherwise stay on the page it was already showing, so the row it just
  // selected sits offscreen and the table looks like it ignored the link.
  // Guarded by a ref rather than run on every pageOfSelected change, or paging
  // away from the selected row would snap back.
  const pagedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedId || pageOfSelected == null) return
    if (pagedForRef.current === selectedId) return
    pagedForRef.current = selectedId
    setPage(pageOfSelected)
  }, [selectedId, pageOfSelected])

  // ── Actions ──
  function toggleSort(field: SortField) {
    // First click on Created reads newest-first — ascending would open on the
    // oldest strategies, which is never what the column is being clicked for.
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir(field === "created" ? "desc" : "asc") }
  }
  function toggleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelect(id: string) {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function handleBulkDelete() {
    ;[...selectedIds].forEach((id) => deleteMutation.mutate(id))
    setBulkDeleteOpen(false); setBulkUnderstood(false); setBulkConfirmText("")
    setSelectedIds(new Set())
  }

  // One strategy row — shared between the flat and grouped table bodies.
  const renderRow = (tpl: StrategyTemplate) => (
    <TableRow
      key={tpl.id}
      data-state={selectedId === tpl.id ? "selected" : undefined}
      className="cursor-pointer"
      // A row stands for the strategy, not one of its runs — drop any run pinned
      // by an earlier deep link.
      onClick={() => { setSelectedId(tpl.id); setSelectedRunId(null) }}
      onContextMenu={(e) => { e.preventDefault(); toggleStar(tpl.id) }}
    >
      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selectedIds.has(tpl.id)} onCheckedChange={() => toggleSelect(tpl.id)} />
      </TableCell>
      <TableCell className="font-medium">
        <span className="flex items-center gap-2">
          {runningDots(tpl)}
          {tpl.name}
        </span>
      </TableCell>
      <TableCell><Badge variant="secondary" className="text-xs font-normal">{strategyLabel(tpl.strategy)}</Badge></TableCell>
      <TableCell>
        {tpl.is_abstract && (
          <Badge variant="outline" className="text-xs font-normal gap-1" title={t("kindAbstractHint")}>
            <Globe className="h-3 w-3" />{t("kindAbstract")}
          </Badge>
        )}
      </TableCell>
      <TableCell>{marketCell(tpl, symbolOf(tpl))}</TableCell>
      <TableCell className="font-mono text-xs">{marketCell(tpl, timeframeOf(tpl))}</TableCell>
      <TableCell className="text-xs whitespace-nowrap tabular-nums text-[var(--muted-foreground)]">
        {createdAt(tpl.created_at)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{tradesCell(tpl)}</TableCell>
      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 cursor-pointer text-[var(--muted-foreground)] hover:text-foreground"
          title={t("paperTradeAction")}
          aria-label={t("paperTradeAction")}
          onClick={() => setStartTemplate(tpl)}
        >
          <Play className="h-3.5 w-3.5" />
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
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
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
                { id: "kind", label: t("groupByKind") },
              ]}
              value={groupBy}
              onChange={(v) => setGroupBy(v as GroupByMode)}
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Scope the Trades column to one or more venues. Rows are never
                hidden by this — a strategy with nothing on the ticked venues
                still lists, it just has no figures to report. */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--muted-foreground)] shrink-0">{t("tradesFrom")}</span>
              {ALL_VENUES.map((v) => (
                <label key={v} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <Checkbox
                    checked={venues.has(v)}
                    onCheckedChange={() => setVenues((prev) => {
                      const n = new Set(prev)
                      n.has(v) ? n.delete(v) : n.add(v)
                      return n
                    })}
                  />
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className={cn("h-1.5 w-1.5 rounded-full", VENUE_DOT[v])} />
                    {venueLabel(v)}
                  </span>
                </label>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <Input placeholder={t("searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 w-56 text-xs" />
            </div>
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
                        <Checkbox checked={filtered.length > 0 && filtered.every((tpl) => selectedIds.has(tpl.id))} />
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.map((tpl) => tpl.id)))}>{t("selectAll")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.filter((tpl) => starredIds.has(tpl.id)).map((tpl) => tpl.id)))}>{t("selectStarred")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.filter((tpl) => runningTemplateIds.has(tpl.id)).map((tpl) => tpl.id)))}>{t("selectRunning")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.filter((tpl) => tpl.is_abstract).map((tpl) => tpl.id)))}>{t("selectAbstract")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSelectedIds(new Set())}>{t("clearSelection")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>
                <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                <TableHead><SortHeader field="strategy" label={t("colStrategy")} /></TableHead>
                <TableHead><SortHeader field="kind" label={t("colKind")} /></TableHead>
                <TableHead><SortHeader field="coin" label={t("colCoin")} /></TableHead>
                <TableHead><SortHeader field="timeframe" label={t("colTimeframe")} /></TableHead>
                <TableHead><SortHeader field="created" label={t("colCreated")} /></TableHead>
                <TableHead className="text-right">
                  <span className="flex justify-end" title={t("colTradesHint")}>
                    <SortHeader field="trades" label={t("colTrades")} />
                  </span>
                </TableHead>
                <TableHead className="text-center">{t("colAction")}</TableHead>
                <TableHead className="w-10 text-center" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-sm text-[var(--muted-foreground)]">
                    {templates.length === 0 ? t("emptyNoStrategies") : t("emptyNoMatch")}
                  </TableCell>
                </TableRow>
              ) : pageGrouped ? (
                pageGrouped.map((row, idx) => {
                  const showHeader = idx === 0 || pageGrouped[idx - 1].key !== row.key
                  const running = row.items.filter((tpl) => runningTemplateIds.has(tpl.id)).length
                  return (
                    <Fragment key={row.tpl.id}>
                      {showHeader && (
                        <TableRow className="bg-[var(--muted)]/40 hover:bg-[var(--muted)]/40">
                          <TableCell colSpan={10} className="py-1.5">
                            <span className="flex items-center gap-2 text-xs font-semibold">
                              {row.title}
                              <span className="font-normal text-[var(--muted-foreground)] tabular-nums">{row.items.length}</span>
                              {running > 0 && (
                                <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">{t("runningCount", { count: running })}</Badge>
                              )}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                      {renderRow(row.tpl)}
                    </Fragment>
                  )
                })
              ) : (
                pageItems.map(renderRow)
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
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
            <div className="px-4 py-2 border-b bg-[var(--muted)]/30 text-sm font-semibold flex items-center gap-2">
              {selected.name}
              {selected.is_abstract && (
                <Badge variant="outline" className="text-[10px] font-normal gap-1">
                  <Globe className="h-3 w-3" />{t("kindAbstract")}
                </Badge>
              )}
            </div>
            <TemplateDetailPane
              key={selected.id}
              template={selected}
              coinById={coinById}
              initialRunId={selectedRunId}
              isRunning={runningTemplateIds.has(selected.id)}
              onStartStop={(tpl) => setStartTemplate(tpl)}
              onDelete={(tpl) => setDeleteTemplate(tpl)}
            />
          </section>
        )}
      </div>

      {/* ── Start a paper run ── */}
      <StartRunDialog
        template={startTemplate}
        coinById={coinById}
        sameDayRuns={sameDayRuns}
        investment={investment}
        onInvestmentChange={setInvestment}
        starting={startMutation.isPending}
        onCancel={() => setStartTemplate(null)}
        onStart={({ name, investment: amount, scope, target }) => {
          if (!startTemplate) return
          startMutation.mutate({ id: startTemplate.id, amount, name, scope, target })
        }}
      />

      {/* ── Delete a single strategy (from the detail pane) ── */}
      <Dialog open={!!deleteTemplate} onOpenChange={(o) => !o && setDeleteTemplate(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">{tp("deleteTitle")}</DialogTitle>
            <DialogDescription>{tp("deleteOneBody", { name: deleteTemplate?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTemplate(null)}>{tp("cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={() => { if (deleteTemplate) deleteMutation.mutate(deleteTemplate.id); setDeleteTemplate(null) }}>{tp("deleteTemplate")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete ── */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{tp("bulkDeleteTitle", { count: selectedIds.size })}</DialogTitle>
            <DialogDescription>{tp("bulkDeleteDescription", { count: selectedIds.size })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={bulkUnderstood} onCheckedChange={(v) => setBulkUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{tp("bulkDeleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{tp("deleteTypeToConfirm", { word: tp("deleteConfirmWord") })}</label>
              <Input value={bulkConfirmText} onChange={(e) => setBulkConfirmText(e.target.value)} placeholder={tp("deleteConfirmWord")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteOpen(false)}>{tp("cancel")}</Button>
            <Button variant="destructive" size="sm" disabled={!bulkUnderstood || bulkConfirmText !== tp("deleteConfirmWord")} onClick={handleBulkDelete}>
              {tp("bulkDeleteConfirm", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
