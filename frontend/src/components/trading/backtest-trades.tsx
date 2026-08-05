"use client"

// The trade list under the charts on a strategy workbench's Results tab — the
// backtest read one round-trip at a time, the way a paper run's Trades tab reads.
// Same shell as the other tables: search, sortable headers, a checkbox column
// (with a select menu) on the left, a star column on the right, and pagination.
//
// Deliberately a SHORT list. A year-long scalp backtest runs to thousands of
// trades and the server only sends the first ~25; the point is to see what the
// entries and exits actually look like, not to audit them all. Everything above
// this table — the segment stats, the equity curve, the Analytics buckets —
// covers every trade, so both the header and the summary line say what they are
// counting rather than letting 25 read as the whole story.
//
// Stars and selection are per-analysis and deliberately NOT persisted: a
// backtest trade has no identity that survives a knob change. Row #7 after
// raising the threshold is a different trade at a different time, so a
// remembered star would be pointing at something else entirely.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import {
  ArrowUpDown, ChevronDown, ChevronUp, Focus, Search, Star,
} from "lucide-react"
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
import { TradeAnalysisDialog } from "@/components/trading/paper/trade-analysis-dialog"
import { paperTradeApi, type BacktestTradeRow, type SwingScope } from "@/lib/api"

const PER_PAGE = 10
const SORT_KEY = "crypt:backtestTrades:sort"

type SortField =
  | "seq" | "side" | "entry" | "entryPrice" | "exit" | "exitPrice" | "held" | "ret" | "reason"
type Sort = { field: SortField; dir: "asc" | "desc" }

// Default order is the backtest's own: entry order, oldest first.
function loadSort(): Sort {
  if (typeof window === "undefined") return { field: "seq", dir: "asc" }
  try {
    const raw = localStorage.getItem(SORT_KEY)
    return raw ? (JSON.parse(raw) as Sort) : { field: "seq", dir: "asc" }
  } catch { return { field: "seq", dir: "asc" } }
}

// Windowed page links (max 7), matching the other tables.
function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

export function BacktestTrades({
  rows,
  // Every trade the backtest produced — the denominator this list is a sample of.
  totalTrades,
  scope,
  strategy,
  params,
}: {
  rows: BacktestTradeRow[]
  totalTrades: number | null
  // The setup these trades came from — posted with a row to draw its popup,
  // since a backtest trade has no stored row to look up.
  scope: SwingScope
  strategy: string
  params: Record<string, unknown>
}) {
  const t = useTranslations("strategies")

  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>(loadSort)
  const [selectedSeqs, setSelectedSeqs] = useState<Set<number>>(new Set())
  const [starredSeqs, setStarredSeqs] = useState<Set<number>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [page, setPage] = useState(1)
  // Row whose kline popup is open — the same chart the paper Trades tab opens.
  const [analysisRow, setAnalysisRow] = useState<BacktestTradeRow | null>(null)

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)) } catch { /* ignore */ }
  }, [sort])
  // A new analysis is a new set of trades — seq 7 now means something else, so
  // every seq-keyed piece of state has to go with it.
  const rowsToken = rows.length ? `${rows.length}:${rows[0].entry_time}:${rows[0].ret_bps}` : "empty"
  useEffect(() => {
    setSelectedSeqs(new Set())
    setStarredSeqs(new Set())
    setShowOnlySelected(false)
    setPage(1)
    setAnalysisRow(null)
  }, [rowsToken])
  useEffect(() => { setPage(1) }, [search, showOnlySelected, sort])

  // Prices span coins from BTC to sub-cent meme tokens; significant digits keep
  // both readable without a per-coin format.
  const px = (v: number) => v.toLocaleString(undefined, { maximumSignificantDigits: 8 })
  const dt = (v: string) => new Date(v).toLocaleString()

  const filtered = useMemo(() => {
    let items = showOnlySelected ? rows.filter((r) => selectedSeqs.has(r.seq)) : rows
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((r) =>
        [
          String(r.seq), r.side, r.exit_reason, `${r.bars_held}`,
          px(r.entry_price), px(r.exit_price), r.ret_bps.toFixed(1),
          dt(r.entry_time), dt(r.exit_time),
        ].join(" ").toLowerCase().includes(q),
      )
    }
    const ts = (v: string) => Date.parse(v)
    return [...items].sort((a, b) => {
      let cmp: number
      switch (sort.field) {
        case "seq": cmp = a.seq - b.seq; break
        case "side": cmp = a.side.localeCompare(b.side); break
        case "entry": cmp = ts(a.entry_time) - ts(b.entry_time); break
        case "entryPrice": cmp = a.entry_price - b.entry_price; break
        case "exit": cmp = ts(a.exit_time) - ts(b.exit_time); break
        case "exitPrice": cmp = a.exit_price - b.exit_price; break
        case "held": cmp = a.bars_held - b.bars_held; break
        case "ret": cmp = a.ret_bps - b.ret_bps; break
        case "reason": cmp = a.exit_reason.localeCompare(b.exit_reason); break
      }
      if (cmp === 0) cmp = a.seq - b.seq  // stable tiebreak
      return sort.dir === "asc" ? cmp : -cmp
    })
  }, [rows, search, sort, showOnlySelected, selectedSeqs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Describes the ROWS ON SCREEN, never the whole backtest — the segment cards
  // above own that claim, and this list is only the first ~25 trades.
  const summary = useMemo(() => {
    const wins = filtered.filter((r) => r.ret_bps > 0).length
    const losses = filtered.filter((r) => r.ret_bps < 0).length
    const mean = filtered.length
      ? filtered.reduce((s, r) => s + r.ret_bps, 0) / filtered.length
      : 0
    return {
      total: filtered.length,
      long: filtered.filter((r) => r.side === "long").length,
      short: filtered.filter((r) => r.side === "short").length,
      wins, losses, mean,
    }
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  if (rows.length === 0) return null
  const truncated = totalTrades != null && totalTrades > rows.length

  function toggleSort(field: SortField) {
    setSort((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }))
  }
  function toggleStar(seq: number) {
    setStarredSeqs((prev) => { const n = new Set(prev); n.has(seq) ? n.delete(seq) : n.add(seq); return n })
  }
  function toggleSelect(seq: number) {
    setSelectedSeqs((prev) => { const n = new Set(prev); n.has(seq) ? n.delete(seq) : n.add(seq); return n })
  }
  const selectWhere = (pred: (r: BacktestTradeRow) => boolean) =>
    setSelectedSeqs(new Set(filtered.filter(pred).map((r) => r.seq)))

  function SortHeader({ field, label, right }: { field: SortField; label: string; right?: boolean }) {
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3 className="text-sm font-medium">{t("backtestTradesTitle")}</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            {truncated
              ? t("backtestTradesTruncated", { shown: rows.length, total: totalTrades!.toLocaleString("en-US") })
              : t("backtestTradesAll", { count: rows.length })}
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <Input
            placeholder={t("backtestTradesSearch")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 w-56 text-xs"
          />
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        {/* Summary of the rows currently shown — not of the backtest. */}
        <div className="flex items-center gap-4 px-3 py-2 border-b text-xs flex-wrap">
          <span className="font-medium tabular-nums">
            {t("backtestSummaryShown", { count: summary.total })}
          </span>
          <span className="text-[var(--muted-foreground)] tabular-nums">
            <span className="text-emerald-500">{summary.long}</span> {t("summaryLong")}
            {" · "}
            <span className="text-red-500">{summary.short}</span> {t("summaryShort")}
          </span>
          <span className="text-[var(--muted-foreground)] tabular-nums">
            <span className="text-emerald-500">{summary.wins}</span> {t("summaryWins")}
            {" · "}
            <span className="text-red-500">{summary.losses}</span> {t("summaryLosses")}
            {summary.wins + summary.losses > 0 && (
              <span> ({((100 * summary.wins) / (summary.wins + summary.losses)).toFixed(0)}% {t("summaryWinRate")})</span>
            )}
          </span>
          <span className="text-[var(--muted-foreground)] tabular-nums">
            {t("backtestSummaryMean")}{" "}
            <span className={cn("font-mono", summary.mean >= 0 ? "text-emerald-500" : "text-red-500")}>
              {summary.mean >= 0 ? "+" : ""}{summary.mean.toFixed(1)} bps
            </span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1 cursor-pointer text-[var(--muted-foreground)] hover:text-foreground">
                        <Checkbox checked={filtered.length > 0 && filtered.every((r) => selectedSeqs.has(r.seq))} />
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => selectWhere(() => true)}>{t("selectAll")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => selectWhere((r) => starredSeqs.has(r.seq))}>{t("selectStarred")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSelectedSeqs(new Set())}>{t("clearSelection")}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => selectWhere((r) => r.side === "long")}>{t("selectLong")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => selectWhere((r) => r.side === "short")}>{t("selectShort")}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => selectWhere((r) => r.ret_bps > 0)}>{t("selectWins")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => selectWhere((r) => r.ret_bps < 0)}>{t("selectLosses")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>
                <TableHead className="w-10 text-right"><SortHeader field="seq" label="#" right /></TableHead>
                <TableHead><SortHeader field="side" label={t("colSide")} /></TableHead>
                <TableHead><SortHeader field="entry" label={t("colEntry")} /></TableHead>
                <TableHead className="text-right"><SortHeader field="entryPrice" label={t("colEntryPrice")} right /></TableHead>
                <TableHead><SortHeader field="exit" label={t("colExit")} /></TableHead>
                <TableHead className="text-right"><SortHeader field="exitPrice" label={t("colExitPrice")} right /></TableHead>
                <TableHead className="text-right"><SortHeader field="held" label={t("colHeld")} right /></TableHead>
                <TableHead className="text-right"><SortHeader field="ret" label={t("colReturn")} right /></TableHead>
                <TableHead><SortHeader field="reason" label={t("colReason")} /></TableHead>
                <TableHead className="w-10 text-center" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center text-sm text-[var(--muted-foreground)]">
                    {t("backtestTradesNoMatch")}
                  </TableCell>
                </TableRow>
              ) : pageRows.map((r) => (
                <TableRow
                  key={r.seq}
                  data-state={selectedSeqs.has(r.seq) ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => setAnalysisRow(r)}
                  onContextMenu={(e) => { e.preventDefault(); toggleStar(r.seq) }}
                >
                  <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedSeqs.has(r.seq)} onCheckedChange={() => toggleSelect(r.seq)} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">{r.seq}</TableCell>
                  <TableCell className={cn(r.side === "long" ? "text-emerald-500" : "text-red-500")}>{r.side}</TableCell>
                  <TableCell className="tabular-nums">{dt(r.entry_time)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{px(r.entry_price)}</TableCell>
                  <TableCell className="tabular-nums">{dt(r.exit_time)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{px(r.exit_price)}</TableCell>
                  <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">
                    {t("barsHeld", { bars: r.bars_held, interval: scope.interval })}
                  </TableCell>
                  <TableCell className={cn(
                    "text-right font-mono tabular-nums",
                    r.ret_bps >= 0 ? "text-emerald-500" : "text-red-500",
                  )}>
                    {r.ret_bps >= 0 ? "+" : ""}{r.ret_bps.toFixed(1)} bps
                  </TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">{r.exit_reason}</TableCell>
                  <TableCell className="text-center" onClick={(e) => { e.stopPropagation(); toggleStar(r.seq) }}>
                    <button className="cursor-pointer" aria-label={t("star")}>
                      <Star className={cn("h-4 w-4", starredSeqs.has(r.seq) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t">
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
        {selectedSeqs.size > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t bg-[var(--muted)]/30">
            <span className="text-xs text-[var(--muted-foreground)]">
              {t("selectedCount", { selected: selectedSeqs.size, total: filtered.length })}
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

      <p className="text-[10px] text-[var(--muted-foreground)]">{t("backtestTradesNote")}</p>

      <TradeAnalysisDialog
        open={analysisRow != null}
        queryKey={[
          "backtestTradeAnalysis", scope.coin_id, scope.quote_asset, scope.interval,
          strategy, JSON.stringify(params), analysisRow?.seq, analysisRow?.entry_time,
        ]}
        queryFn={() => paperTradeApi.backtestTradeAnalysis({
          coin_id: scope.coin_id,
          quote_asset: scope.quote_asset,
          interval: scope.interval,
          strategy,
          params,
          seq: analysisRow!.seq,
          side: analysisRow!.side,
          entry_time: analysisRow!.entry_time,
          entry_price: analysisRow!.entry_price,
          exit_time: analysisRow!.exit_time,
          exit_price: analysisRow!.exit_price,
          ret_bps: analysisRow!.ret_bps,
          exit_reason: analysisRow!.exit_reason,
        })}
        onClose={() => setAnalysisRow(null)}
      />
    </div>
  )
}
