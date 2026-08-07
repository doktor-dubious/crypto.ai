"use client"

// The Trades tab of the strategy detail pane — one row per round-trip, pooled
// across every run of the strategy and across all three execution venues:
//
//   Paper    — simulated fills, no money, no exchange
//   Test Net — real Binance order flow against the testnet, still no money
//   Live     — real orders, real money
//
// Three checkboxes decide which venues are included. They matter: a strategy's
// paper record and its live record are different claims about it, and averaging
// them together would flatter or damn it for the wrong reasons. Nothing here
// blends the venues into a single number — the summary line reports whichever
// set is currently shown, and the Source column always says which is which.
//
// Polls while the strategy is running so new trades stream in. Same table shell
// as the master table: search, sortable headers, a checkbox column (with a
// select menu) on the left and a star column on the right. Stars + sort persist;
// selection is per visit.

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  ArrowUpDown, ChevronDown, ChevronUp, Focus, Search, Star,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"
import { useDetailPageSize } from "@/components/providers/detail-pane-provider"
import { TradeAnalysisDialog } from "@/components/trading/paper/trade-analysis-dialog"
import {
  paperTradeApi, liveTradeApi,
  type CoinResponse, type LiveTradeRun, type PaperTrade, type PaperTradeRun,
  type TradeSource,
} from "@/lib/api"

// Server cap on one trades fetch. Reaching it means the list is a partial view,
// which the unrealized-P/L reconciliation must not sum over.
const TRADES_LIMIT = 2000
const TRADE_STAR_PREFIX = "gorm:paperTrade:starredTrades:"
const TRADE_SORT_KEY = "gorm:paperTrade:tradesSort"
const TRADE_SOURCES_KEY = "gorm:paperTrade:tradeSources"

const ALL_SOURCES: TradeSource[] = ["paper", "testnet", "live"]

type TradeSortField =
  | "source" | "side" | "coin" | "qty" | "entry" | "entryPrice" | "exit" | "exitPrice"
  | "pnl" | "reason" | "ai"
type TradeSort = { field: TradeSortField; dir: "asc" | "desc" }

// A run of any venue, in the only terms this table needs.
interface VenueRun {
  id: string
  source: TradeSource
  symbol: string
  status: string
  n_trades: number
  initial_capital: number
  pnl_total: number | null
  scope: { coin_id?: string } | null
}

// trade_seq restarts at 0 in every run, so a trade is only identified by the
// pair. Used as the React key and for stars/selection.
const rowKey = (tr: PaperTrade) => `${tr.run_id}:${tr.trade_seq}`

// Stars are keyed by STRATEGY here (the composite row key already carries the
// run), so a star survives switching between the pooled and single-run views.
function loadStarredTrades(templateId: string): Set<string> {
  if (typeof window === "undefined" || !templateId) return new Set()
  try {
    const raw = localStorage.getItem(`${TRADE_STAR_PREFIX}${templateId}`)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}
function saveStarredTrades(templateId: string, keys: Set<string>) {
  if (typeof window === "undefined" || !templateId) return
  try { localStorage.setItem(`${TRADE_STAR_PREFIX}${templateId}`, JSON.stringify([...keys])) } catch { /* ignore */ }
}
// Default order matches the API: newest trade first.
function loadTradeSort(): TradeSort {
  if (typeof window === "undefined") return { field: "entry", dir: "desc" }
  try {
    const raw = localStorage.getItem(TRADE_SORT_KEY)
    return raw ? (JSON.parse(raw) as TradeSort) : { field: "entry", dir: "desc" }
  } catch { return { field: "entry", dir: "desc" } }
}
function saveTradeSort(sort: TradeSort) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(TRADE_SORT_KEY, JSON.stringify(sort)) } catch { /* ignore */ }
}
// Which venues are included, remembered across visits. Paper only by default —
// it is the venue every strategy has, and the one this page is about.
function loadSources(): Set<TradeSource> {
  if (typeof window === "undefined") return new Set<TradeSource>(["paper"])
  try {
    const raw = localStorage.getItem(TRADE_SOURCES_KEY)
    const saved = raw ? (JSON.parse(raw) as TradeSource[]) : null
    return new Set<TradeSource>(saved?.length ? saved : ["paper"])
  } catch { return new Set<TradeSource>(["paper"]) }
}

const isWin = (tr: PaperTrade) => tr.realized_pnl != null && tr.realized_pnl > 0
const isLoss = (tr: PaperTrade) => tr.realized_pnl != null && tr.realized_pnl < 0

// Signed money, always 2 decimals (e.g. +1,204.50 / -33.20 / 0.00).
const signed = (v: number) =>
  `${v > 0 ? "+" : ""}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Windowed page links (max 7), matching the master table.
function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

export function TradesTable({
  templateId, coinById, initialRunId, isRunning,
}: {
  templateId: string
  coinById: Map<string, CoinResponse>
  // Run the table should pin itself to, when the pane was opened from a row that
  // stood for one specific run (a Sweep template×coin row, an Active card).
  initialRunId?: string | null
  isRunning: boolean
}) {
  const t = useTranslations("paperTrade")

  // 10 rows normally, 15 when the detail pane is maximized — the extra height
  // is there, so spend it on rows.
  const tradesPerPage = useDetailPageSize()

  // ── Which venues to include ──
  const [sources, setSources] = useState<Set<TradeSource>>(loadSources)
  useEffect(() => {
    try { localStorage.setItem(TRADE_SOURCES_KEY, JSON.stringify([...sources])) } catch { /* ignore */ }
  }, [sources])
  const wantPaper = sources.has("paper")
  const wantLive = sources.has("testnet") || sources.has("live")

  // ── Runs, per venue ──
  // A strategy can be running on several coins at once (that's how sweeps fan a
  // param-set across the universe), and each run keeps its own trade history and
  // its own stake — so the run picker below can narrow to one of them.
  const { data: paperRuns = [] } = useQuery({
    queryKey: ["paperRuns", "all"],
    queryFn: () => paperTradeApi.listRuns(),
    refetchInterval: isRunning ? 15000 : false,
    staleTime: 10_000,
  })
  const { data: liveRuns = [] } = useQuery({
    queryKey: ["liveRuns", "all"],
    queryFn: () => liveTradeApi.listRuns(),
    refetchInterval: isRunning ? 15000 : false,
    staleTime: 10_000,
    // Live trading is opt-in; don't poll the exchange-backed endpoint for
    // strategies whose live venues aren't even being shown.
    enabled: wantLive,
  })

  const symbolOf = (scope: { coin_id?: string } | null | undefined) =>
    (scope?.coin_id ? coinById.get(scope.coin_id)?.symbol : null) ?? ""

  // Busiest first, running ahead of stopped, then coin — the run most worth
  // looking at leads, and the order can't flip between polls (sweep runs share a
  // started_at down to the microsecond).
  const runs: VenueRun[] = useMemo(() => {
    const out: VenueRun[] = []
    if (wantPaper) {
      for (const r of paperRuns as PaperTradeRun[]) {
        if (r.template_id !== templateId) continue
        out.push({
          id: r.id, source: "paper", symbol: symbolOf(r.scope), status: r.status,
          n_trades: r.n_trades, initial_capital: r.initial_capital,
          pnl_total: r.pnl.total, scope: r.scope,
        })
      }
    }
    for (const r of liveRuns as LiveTradeRun[]) {
      if (r.template_id !== templateId) continue
      const source: TradeSource = r.is_testnet ? "testnet" : "live"
      if (!sources.has(source)) continue
      out.push({
        id: r.id, source, symbol: symbolOf(r.scope), status: r.status,
        n_trades: r.n_trades, initial_capital: r.initial_capital,
        pnl_total: r.pnl.total, scope: r.scope,
      })
    }
    return out.sort((a, b) =>
      Number(b.status === "running") - Number(a.status === "running") ||
      b.n_trades - a.n_trades ||
      a.symbol.localeCompare(b.symbol) ||
      a.id.localeCompare(b.id),
    )
  }, [paperRuns, liveRuns, templateId, coinById, wantPaper, sources]) // eslint-disable-line react-hooks/exhaustive-deps

  // null = every run of the enabled venues (the default). A deep link from Sweep
  // or Active pins one specific run instead.
  const [pickedRunId, setPickedRunId] = useState<string | null>(initialRunId ?? null)
  const pickedRun = useMemo(
    () => runs.find((r) => r.id === pickedRunId) ?? null,
    [runs, pickedRunId],
  )

  // ── Trades ──
  const { data: paperTrades = [] } = useQuery({
    queryKey: ["paperTrades", templateId, "all"],
    queryFn: () => paperTradeApi.listTrades(templateId, TRADES_LIMIT, undefined, true),
    enabled: wantPaper,
    refetchInterval: isRunning ? 8000 : false,
  })
  const { data: liveTrades = [] } = useQuery({
    queryKey: ["liveTrades", templateId, "all"],
    queryFn: () => liveTradeApi.listTrades(templateId, TRADES_LIMIT, undefined, true),
    enabled: wantLive,
    refetchInterval: isRunning ? 8000 : false,
  })

  // Merged, newest first, restricted to the enabled venues and — when one is
  // pinned — to a single run.
  const trades: PaperTrade[] = useMemo(() => {
    const merged = [
      ...(wantPaper ? paperTrades : []),
      ...(wantLive ? liveTrades.filter((tr) => sources.has(tr.source)) : []),
    ].filter((tr) => (pickedRunId ? tr.run_id === pickedRunId : true))
    return merged.sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time))
  }, [paperTrades, liveTrades, wantPaper, wantLive, sources, pickedRunId])

  // The runs actually represented by the rows on screen — the denominator for
  // every percentage below.
  const shownRuns = useMemo(
    () => (pickedRun ? [pickedRun] : runs),
    [pickedRun, runs],
  )
  // Percentages use the same base as the P/L on the Active cards: the starting
  // stake. Capital never changes mid-run, so pooling runs just sums the stakes.
  const baseCapital = shownRuns.reduce((s, r) => s + (r.initial_capital || 0), 0)

  const px = (v: number | null) => (v == null ? "—" : v.toLocaleString(undefined, { maximumSignificantDigits: 8 }))
  const dt = (v: string | null) => (v == null ? "—" : new Date(v).toLocaleString())
  const runById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs])
  // The trade's own coin, from the scope frozen onto it at trade time — a sweep
  // strategy carries no coin of its own, so the row can't inherit one from the
  // strategy. Falls back to its run's scope for trades written without one.
  const coinOf = (tr: PaperTrade) =>
    symbolOf(tr.scope) || symbolOf(runById.get(tr.run_id)?.scope)
  // " / +12.77%" of the shown runs' starting stake — empty when there's no base.
  const pctOf = (v: number) =>
    baseCapital ? ` / ${v > 0 ? "+" : ""}${((100 * v) / baseCapital).toFixed(2)}%` : ""
  const runPct = (r: VenueRun) =>
    r.pnl_total == null || !r.initial_capital ? null : (100 * r.pnl_total) / r.initial_capital

  // ── Table state ──
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<TradeSort>(loadTradeSort)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [starredKeys, setStarredKeys] = useState<Set<string>>(() => loadStarredTrades(templateId))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [page, setPage] = useState(1)
  // Trade whose kline-analysis popup is open (row click), null = closed.
  const [analysisTrade, setAnalysisTrade] = useState<PaperTrade | null>(null)

  useEffect(() => { saveTradeSort(sort) }, [sort])
  // Follow the opening row: a different strategy, or the same one reopened from
  // a different Sweep/Active row, re-pins to that row's run (null → all runs).
  useEffect(() => { setPickedRunId(initialRunId ?? null) }, [templateId, initialRunId])
  // Drop a pin that no longer resolves — a stale or since-deleted run id, or a
  // run whose venue was just unchecked. Falling back to "all runs" is right:
  // silently showing a different run would swap the table out from under the
  // reader, which is exactly what the pin exists to prevent.
  useEffect(() => {
    if (pickedRunId != null && runs.length > 0 && !runs.some((r) => r.id === pickedRunId)) {
      setPickedRunId(null)
    }
  }, [runs, pickedRunId])
  useEffect(() => {
    setStarredKeys(loadStarredTrades(templateId))
    setSelectedKeys(new Set())
    setShowOnlySelected(false)
    setPage(1)
    setAnalysisTrade(null)
  }, [templateId])
  useEffect(() => { setPage(1) }, [search, showOnlySelected, sort, sources, pickedRunId])

  // ── Derived: filter + sort ──
  const filtered = useMemo(() => {
    let items = showOnlySelected ? trades.filter((tr) => selectedKeys.has(rowKey(tr))) : trades
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((tr) =>
        [
          tr.side, coinOf(tr), tr.status, tr.exit_reason ?? "", tr.ai_verdict ?? "",
          sourceLabel(tr.source, t),
          px(tr.qty), px(tr.entry_price), px(tr.exit_price),
          tr.realized_pnl == null ? "" : tr.realized_pnl.toFixed(2),
          dt(tr.entry_time), tr.exit_time == null ? "" : dt(tr.exit_time),
        ].join(" ").toLowerCase().includes(q),
      )
    }
    const ts = (v: string | null) => (v == null ? -Infinity : Date.parse(v))
    const nn = (v: number | null) => (v == null ? -Infinity : v)
    return [...items].sort((a, b) => {
      let cmp: number
      switch (sort.field) {
        case "source": cmp = ALL_SOURCES.indexOf(a.source) - ALL_SOURCES.indexOf(b.source); break
        case "side": cmp = a.side.localeCompare(b.side); break
        case "coin": cmp = coinOf(a).localeCompare(coinOf(b)); break
        case "qty": cmp = a.qty - b.qty; break
        case "entry": cmp = ts(a.entry_time) - ts(b.entry_time); break
        case "entryPrice": cmp = a.entry_price - b.entry_price; break
        case "exit": cmp = ts(a.exit_time) - ts(b.exit_time); break
        case "exitPrice": cmp = nn(a.exit_price) - nn(b.exit_price); break
        case "pnl": cmp = nn(a.realized_pnl) - nn(b.realized_pnl); break
        case "reason": cmp = (a.exit_reason ?? "").localeCompare(b.exit_reason ?? ""); break
        case "ai": cmp = (a.ai_verdict ?? "").localeCompare(b.ai_verdict ?? ""); break
      }
      // Stable tiebreak so equal keys keep a deterministic order.
      if (cmp === 0) cmp = rowKey(a).localeCompare(rowKey(b))
      return sort.dir === "asc" ? cmp : -cmp
    })
  }, [trades, search, sort, showOnlySelected, selectedKeys]) // eslint-disable-line react-hooks/exhaustive-deps

  // Summary over what's currently shown (wins/losses and the P/L sums count
  // closed trades only — an open trade has no realized P/L yet).
  const summary = useMemo(() => {
    let profit = 0
    let loss = 0
    for (const tr of filtered) {
      if (tr.realized_pnl == null) continue
      if (tr.realized_pnl > 0) profit += tr.realized_pnl
      else loss += tr.realized_pnl
    }
    return {
      total: filtered.length,
      long: filtered.filter((tr) => tr.side === "long").length,
      short: filtered.filter((tr) => tr.side === "short").length,
      wins: filtered.filter(isWin).length,
      losses: filtered.filter(isLoss).length,
      profit,
      loss,
      netPnl: profit + loss,
    }
  }, [filtered])

  // How many rows come from each venue — the honest caption for a merged table,
  // where a single net number would hide that paper and real money are mixed.
  const bySource = useMemo(() => {
    const counts = new Map<TradeSource, number>()
    for (const tr of filtered) counts.set(tr.source, (counts.get(tr.source) ?? 0) + 1)
    return ALL_SOURCES.filter((s) => counts.has(s)).map((s) => ({ source: s, n: counts.get(s)! }))
  }, [filtered])

  // The run's P/L marks its OPEN position to market; the summary above sums
  // CLOSED trades only. Spell the difference out — that gap is why this table
  // reads smaller than the same run's number on the Sweep and Active tabs. Only
  // computed for a single pinned run: pooled across runs the arithmetic would
  // mix stakes that were never comparable.
  const openPosition = useMemo(() => {
    if (!pickedRun) return null
    const nOpen = trades.filter((tr) => tr.status === "open").length
    // A truncated list would understate `realized` and so overstate unrealized.
    if (nOpen === 0 || pickedRun.pnl_total == null || trades.length >= TRADES_LIMIT) return null
    const realized = trades.reduce((s, tr) => s + (tr.realized_pnl ?? 0), 0)
    return { nOpen, unrealized: pickedRun.pnl_total - realized, runTotal: pickedRun.pnl_total }
  }, [trades, pickedRun])

  const totalPages = Math.max(1, Math.ceil(filtered.length / tradesPerPage))
  const safePage = Math.min(page, totalPages)
  const pageTrades = filtered.slice((safePage - 1) * tradesPerPage, safePage * tradesPerPage)

  // ── Actions ──
  function toggleSort(field: TradeSortField) {
    setSort((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }))
  }
  function toggleStar(key: string) {
    const next = new Set(starredKeys)
    next.has(key) ? next.delete(key) : next.add(key)
    setStarredKeys(next)
    saveStarredTrades(templateId, next)
  }
  function toggleSelect(key: string) {
    setSelectedKeys((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  function toggleSource(s: TradeSource) {
    setSources((prev) => {
      const n = new Set(prev)
      n.has(s) ? n.delete(s) : n.add(s)
      return n
    })
  }
  // Every "Select …" menu entry works over the currently filtered rows.
  const selectWhere = (pred: (tr: PaperTrade) => boolean) =>
    setSelectedKeys(new Set(filtered.filter(pred).map(rowKey)))

  function SortHeader({ field, label, right }: { field: TradeSortField; label: string; right?: boolean }) {
    const active = sort.field === field
    return (
      <button
        onClick={() => toggleSort(field)}
        className={cn(
          "flex items-center gap-1 font-medium hover:text-foreground transition-colors cursor-pointer",
          right && "ml-auto",
        )}
      >
        {label}
        {active ? (sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  // "BANK · 3 trades · -6.44%" — the same P/L basis the Sweep tab ranks by, so a
  // row there and this table can be matched up by eye.
  const runLabel = (r: VenueRun) => {
    const pct = runPct(r)
    return (
      <span className="inline-flex items-center gap-2 tabular-nums">
        <SourceBadge source={r.source} />
        <span className="font-medium">{r.symbol || "—"}</span>
        <span className="text-[var(--muted-foreground)]">{r.n_trades} {t("summaryTrades")}</span>
        {pct != null && (
          <span className={cn(pct >= 0 ? "text-emerald-500" : "text-red-500")}>
            {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
          </span>
        )}
        {r.status !== "running" && <span className="text-[var(--muted-foreground)]">({r.status})</span>}
      </span>
    )
  }

  // Venue checkboxes + run picker + search. Always visible, even with no trades,
  // so the table can never look like it speaks for more than it does.
  const toolbar = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Venues */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--muted-foreground)] shrink-0">{t("tradesSourceLabel")}</span>
          {ALL_SOURCES.map((s) => (
            <label key={s} className="flex items-center gap-1.5 cursor-pointer select-none">
              <Checkbox checked={sources.has(s)} onCheckedChange={() => toggleSource(s)} />
              <span className="text-xs">{sourceLabel(s, t)}</span>
            </label>
          ))}
        </div>
        {/* Which run(s) */}
        {runs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs cursor-pointer font-normal">
                {pickedRun ? runLabel(pickedRun) : t("tradesAllRuns", { count: runs.length })}
                <ChevronDown className="h-3 w-3 ml-1.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => setPickedRunId(null)}>
                {t("tradesAllRuns", { count: runs.length })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {runs.map((r) => (
                <DropdownMenuItem key={r.id} className="text-xs cursor-pointer" onClick={() => setPickedRunId(r.id)}>
                  {runLabel(r)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        <Input
          placeholder={t("searchTradesPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-8 w-56 text-xs"
        />
      </div>
    </div>
  )

  if (sources.size === 0) {
    return (
      <div className="space-y-3">
        {toolbar}
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{t("tradesNoSources")}</p>
      </div>
    )
  }

  if (trades.length === 0) {
    return (
      <div className="space-y-3">
        {toolbar}
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
          {pickedRun ? t("noTradesThisRun") : t("noTrades")}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {toolbar}

      <div className="rounded-lg border overflow-hidden">
        {/* Summary of the rows currently shown */}
        <div className="flex items-center gap-4 px-3 py-2 border-b text-xs flex-wrap">
          <span className="font-medium tabular-nums">{summary.total.toLocaleString("en-US")} {t("summaryTrades")}</span>
          {bySource.length > 1 && (
            <span className="text-[var(--muted-foreground)] tabular-nums inline-flex items-center gap-1.5">
              {bySource.map(({ source, n }) => (
                <span key={source} className="inline-flex items-center gap-1">
                  <SourceBadge source={source} />
                  <span>{n.toLocaleString("en-US")}</span>
                </span>
              ))}
            </span>
          )}
          <span className="text-[var(--muted-foreground)] tabular-nums">
            <span className="text-emerald-500">{summary.long.toLocaleString("en-US")}</span> {t("summaryLong")}
            {" · "}
            <span className="text-red-500">{summary.short.toLocaleString("en-US")}</span> {t("summaryShort")}
          </span>
          <span className="text-[var(--muted-foreground)] tabular-nums">
            <span className="text-emerald-500">{summary.wins.toLocaleString("en-US")}</span> {t("summaryWins")}
            {" · "}
            <span className="text-red-500">{summary.losses.toLocaleString("en-US")}</span> {t("summaryLosses")}
            {summary.wins + summary.losses > 0 && (
              <span> ({((100 * summary.wins) / (summary.wins + summary.losses)).toFixed(0)}% {t("summaryWinRate")})</span>
            )}
          </span>
          <span className="text-[var(--muted-foreground)] tabular-nums">
            {t("summaryProfit")}{" "}
            <span className="text-emerald-500 font-mono">{signed(summary.profit)}{pctOf(summary.profit)}</span>
            {" · "}
            {t("summaryLoss")}{" "}
            <span className="text-red-500 font-mono">{signed(summary.loss)}{pctOf(summary.loss)}</span>
            {" · "}
            {t("summaryNet")}{" "}
            <span className={cn("font-mono font-medium", summary.netPnl >= 0 ? "text-emerald-500" : "text-red-500")}>
              {signed(summary.netPnl)}{pctOf(summary.netPnl)}
            </span>
          </span>
        </div>

        {/* Paper money and real money in one total is not a number to act on. */}
        {bySource.length > 1 && (
          <div className="px-3 py-1.5 border-b text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/5">
            {t("tradesMixedSources")}
          </div>
        )}

        {/* Closed trades don't add up to the run's P/L while a position is open. */}
        {openPosition && (
          <div className="flex items-center gap-4 px-3 py-2 border-b text-xs flex-wrap bg-amber-500/5">
            <span className="text-amber-600 dark:text-amber-400 tabular-nums">
              {t("tradesOpenCount", { count: openPosition.nOpen })}
            </span>
            <span className="text-[var(--muted-foreground)] tabular-nums">
              {t("tradesUnrealized")}{" "}
              <span className={cn("font-mono", openPosition.unrealized >= 0 ? "text-emerald-500" : "text-red-500")}>
                {signed(openPosition.unrealized)}{pctOf(openPosition.unrealized)}
              </span>
              {" · "}
              {t("tradesRunTotal")}{" "}
              <span className={cn("font-mono font-medium", openPosition.runTotal >= 0 ? "text-emerald-500" : "text-red-500")}>
                {signed(openPosition.runTotal)}{pctOf(openPosition.runTotal)}
              </span>
            </span>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1 cursor-pointer text-[var(--muted-foreground)] hover:text-foreground">
                        <Checkbox checked={filtered.length > 0 && filtered.every((tr) => selectedKeys.has(rowKey(tr)))} />
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => selectWhere(() => true)}>{t("selectAll")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => selectWhere((tr) => starredKeys.has(rowKey(tr)))}>{t("selectStarred")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSelectedKeys(new Set())}>{t("clearSelection")}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => selectWhere((tr) => tr.side === "long")}>{t("selectLong")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => selectWhere((tr) => tr.side === "short")}>{t("selectShort")}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => selectWhere(isWin)}>{t("selectWins")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => selectWhere(isLoss)}>{t("selectLosses")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>
                <TableHead><SortHeader field="source" label={t("colSource")} /></TableHead>
                <TableHead><SortHeader field="side" label={t("colSide")} /></TableHead>
                <TableHead><SortHeader field="coin" label={t("colCoin")} /></TableHead>
                <TableHead className="text-right"><SortHeader field="qty" label={t("colQty")} right /></TableHead>
                <TableHead><SortHeader field="entry" label={t("colEntry")} /></TableHead>
                <TableHead className="text-right"><SortHeader field="entryPrice" label={t("colEntryPrice")} right /></TableHead>
                <TableHead><SortHeader field="exit" label={t("colExit")} /></TableHead>
                <TableHead className="text-right"><SortHeader field="exitPrice" label={t("colExitPrice")} right /></TableHead>
                <TableHead className="text-right"><SortHeader field="pnl" label={t("colPnl")} right /></TableHead>
                <TableHead><SortHeader field="reason" label={t("colReason")} /></TableHead>
                <TableHead><SortHeader field="ai" label={t("colAiVerdict")} /></TableHead>
                <TableHead className="w-10 text-center" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="h-24 text-center text-sm text-[var(--muted-foreground)]">{t("noTradesMatch")}</TableCell>
                </TableRow>
              ) : pageTrades.map((tr) => {
                const key = rowKey(tr)
                const open = tr.status === "open"
                // The kline popup is served by the paper-trade analysis endpoint,
                // which only knows paper trades — live rows have no equivalent yet.
                const canAnalyse = tr.source === "paper"
                return (
                  <TableRow
                    key={key}
                    data-state={selectedKeys.has(key) ? "selected" : undefined}
                    className={cn(canAnalyse && "cursor-pointer", open && "bg-amber-500/5")}
                    onClick={() => { if (canAnalyse) setAnalysisTrade(tr) }}
                    onContextMenu={(e) => { e.preventDefault(); toggleStar(key) }}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selectedKeys.has(key)} onCheckedChange={() => toggleSelect(key)} />
                    </TableCell>
                    <TableCell><SourceBadge source={tr.source} /></TableCell>
                    <TableCell className={cn(tr.side === "long" ? "text-emerald-500" : "text-red-500")}>{tr.side}</TableCell>
                    <TableCell className="font-medium">
                      {coinOf(tr) || <span className="text-[var(--muted-foreground)]">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{px(tr.qty)}</TableCell>
                    <TableCell className="tabular-nums">{dt(tr.entry_time)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{px(tr.entry_price)}</TableCell>
                    <TableCell className="tabular-nums">
                      {open ? <span className="text-amber-600 dark:text-amber-400">{t("open")}</span> : dt(tr.exit_time)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{px(tr.exit_price)}</TableCell>
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums",
                      tr.realized_pnl == null ? "text-[var(--muted-foreground)]"
                        : tr.realized_pnl >= 0 ? "text-emerald-500" : "text-red-500",
                    )}>
                      {tr.realized_pnl == null ? "—" : `${tr.realized_pnl >= 0 ? "+" : ""}${tr.realized_pnl.toFixed(2)}`}
                    </TableCell>
                    <TableCell className="text-[var(--muted-foreground)]">{open ? "—" : tr.exit_reason ?? "—"}</TableCell>
                    <TableCell>
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
                              : tr.ai_verdict === "ERROR"
                                ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                                : "border-red-500/40 text-red-500",
                          )}
                        >
                          {tr.ai_verdict === "GO" ? t("aiGo") : tr.ai_verdict === "ERROR" ? t("aiError") : t("aiNoGo")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => { e.stopPropagation(); toggleStar(key) }}>
                      <button className="cursor-pointer" aria-label={t("star")}>
                        <Star className={cn("h-4 w-4", starredKeys.has(key) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t">
            <span className="text-xs text-[var(--muted-foreground)]">
              {t("showingTrades", {
                from: (safePage - 1) * tradesPerPage + 1,
                to: Math.min(safePage * tradesPerPage, filtered.length),
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
        {selectedKeys.size > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t bg-[var(--muted)]/30">
            <span className="text-xs text-[var(--muted-foreground)]">
              {t("selectedCount", { selected: selectedKeys.size, total: filtered.length })}
            </span>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
              onClick={() => setShowOnlySelected((v) => !v)}
              title={showOnlySelected ? t("showAll") : t("showOnlySelected")}
            >
              <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
            </Button>
          </div>
        )}
      </div>

      <TradeAnalysisDialog
        open={analysisTrade != null}
        queryKey={["paperTradeAnalysis", templateId, analysisTrade?.run_id, analysisTrade?.trade_seq]}
        queryFn={() => paperTradeApi.tradeAnalysis(templateId, analysisTrade!.trade_seq, analysisTrade!.run_id)}
        onClose={() => setAnalysisTrade(null)}
      />
    </div>
  )
}

function sourceLabel(source: TradeSource, t: (k: string) => string): string {
  return source === "paper" ? t("sourcePaper") : source === "testnet" ? t("sourceTestnet") : t("sourceLive")
}

// Real money is the one that has to be unmistakable at a glance, so Live is the
// only badge that carries colour.
function SourceBadge({ source }: { source: TradeSource }) {
  const t = useTranslations("paperTrade")
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-normal",
        source === "live" && "border-red-500/50 text-red-500",
        source === "testnet" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
        source === "paper" && "text-[var(--muted-foreground)]",
      )}
    >
      {sourceLabel(source, t)}
    </Badge>
  )
}
