"use client"

// The variations one grid search produced, and what each scored.
//
// The column order is the argument: TRAIN first (the half the search was allowed
// to look at, and what the rows are ranked by), VALIDATION beside it (the half it
// wasn't). A grid ranked on the full range finds the best-fitting noise —
// searching N combos yields a top |t| of about sqrt(2·ln N) from chance alone —
// so the header states that threshold against this search's own N, and rows that
// didn't trade enough to be worth reading are dimmed and sorted last.
//
// Clicking a row opens what that variation actually was, with a button to apply
// it to the strategy.

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  ArrowUpDown, ChevronDown, ChevronUp, Focus, Search, Star, Trash2,
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
import { InfoIcon } from "@/components/trading/info-icon"
import { VariationDialog } from "@/components/trading/optimize/variation-dialog"
import {
  strategyOptimizationsApi,
  type OptimizationResult, type StrategyOptimization,
} from "@/lib/api"

const PER_PAGE = 10

type SortField =
  | "coin" | "interval" | "trainT" | "trainBps" | "sharpe" | "valT" | "valBps"
  | "trades" | "winRate" | "ret" | "skew" | "maxDD"
type Sort = { field: SortField; dir: "asc" | "desc" }

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

/** The axes this grid actually SEARCHED. An axis with a single ticked value was
 *  held constant, so calling it a variation would be misleading — these are the
 *  ones the variation popup highlights. */
function variedAxes(spec: StrategyOptimization["spec"]): Set<string> {
  const varied = new Set<string>()
  const many = (a: unknown[] | undefined) => (a?.length ?? 0) > 1
  // Anything but a single named coin means the grid moved across markets.
  if (spec.coins && spec.coins.mode !== "single") varied.add("coin")
  if (many(spec.intervals)) varied.add("interval")
  if (many(spec.threshold)) varied.add("threshold")
  if (many(spec.holdBars)) varied.add("holdBars")
  if (many(spec.sides)) varied.add("side")
  if (many(spec.voldiv)) varied.add("voldiv")
  if (many(spec.btcFilter)) varied.add("btc")
  // Whatever this strategy's own signal knobs are.
  for (const [key, values] of Object.entries(spec.paramAxes ?? {})) {
    if (many(values)) varied.add(key)
  }
  // The string-valued axes: indicator kinds, or swing-composite subsets. An
  // indicator kind also counts as varied when only its own knob moved.
  if (many(spec.indicators) || Object.values(spec.indicatorValues ?? {}).some(
    (byKind) => Object.values(byKind ?? {}).some((v) => many(v)))) varied.add("indicator")
  if (many(spec.signalSubsets)) varied.add("subset")
  if (many(spec.volGate)) varied.add("volGate")
  if (many(spec.htfGate)) varied.add("htfGate")
  // An exit axis counts as varied if the MODE moved or any of its ladders did.
  const ladder = (m: Record<string, number[]> | undefined) =>
    Object.values(m ?? {}).some((v) => (v?.length ?? 0) > 1)
  if (many(spec.slModes) || ladder(spec.slValues)) varied.add("sl")
  if (many(spec.tpModes) || ladder(spec.tpValues)) varied.add("tp")
  return varied
}

// Φ(x) via Abramowitz & Stegun 7.1.26 — accurate to ~1e-7, which is far tighter
// than anything this number is used to decide.
/** Return per unit of its own scatter, per trade — t with the sample size taken
 *  back out (t = Sharpe · √n, so Sharpe = t / √n). Nothing new is stored for it:
 *  it is exactly recoverable from the two columns already recorded.
 *
 *  Worth having beside t because t rewards TRADING MORE. A 5m variation taking
 *  900 trades out-scores an identical 1h one taking 60 on t alone, purely from
 *  the √n term — and these grids vary timeframe. Sharpe compares the quality of
 *  the edge without that thumb on the scale. It is per-trade, not annualised:
 *  useful for ranking variations against each other, not against a benchmark.
 */
function perTradeSharpe(t: number, n: number): number | null {
  return n > 0 && Number.isFinite(t) ? t / Math.sqrt(n) : null
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x) / Math.SQRT2
  const tt = 1 / (1 + 0.3275911 * z)
  const y = 1 - ((((1.061405429 * tt - 1.453152027) * tt + 1.421413741) * tt - 0.284496736) * tt
    + 0.254829592) * tt * Math.exp(-z * z)
  return 0.5 * (1 + sign * y)
}

/** How often a search of `n` PURE-NOISE variations would produce a best t at
 *  least this good: 1 − Φ(t)^n.
 *
 *  This replaced a `sqrt(2·ln n)` threshold, which is the asymptotic expected
 *  maximum and is badly off at the sizes these grids actually run: at n=151 it
 *  gives 3.17 while the true expected best is 2.65, so it read as "the typical
 *  fluke" while actually sitting near the 89th percentile of one. A direct
 *  probability says the same thing without needing to be calibrated by eye.
 *
 *  Independence is assumed and is NOT true here — variations share trades, so
 *  the effective number of tests is smaller and the real rate is lower. Treat it
 *  as a rough guide; the validation column is the test that needs no assumptions.
 */
function noiseBeatRate(t: number, n: number): number {
  if (!Number.isFinite(t) || n < 1) return 1
  // Computed on the tail with log1p/expm1: Φ(t)^n underflows to a flat 0 or 1
  // exactly where the answer is interesting.
  const tail = 1 - normalCdf(t)
  return -Math.expm1(n * Math.log1p(-tail))
}

const tTone = (v: number) =>
  v >= 3 ? "text-green-500" : v >= 2 ? "text-amber-400" : v <= -2 ? "text-red-400" : "text-muted-foreground"

export function OptimizationResults({
  optimization,
  onImplement,
  onDelete,
}: {
  optimization: StrategyOptimization
  onImplement: (scope: { coin_id: string; quote_asset: string; interval: string }, params: Record<string, unknown>) => void
  onDelete: () => void
}) {
  const t = useTranslations("optimize")
  const running = optimization.status === "running" || optimization.status === "pending"

  const { data: results = [] } = useQuery({
    queryKey: ["optimizationResults", optimization.id],
    queryFn: () => strategyOptimizationsApi.results(optimization.id),
    refetchInterval: running ? 4000 : false,
  })

  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>({ field: "trainT", dir: "desc" })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [page, setPage] = useState(1)
  const [openRow, setOpenRow] = useState<OptimizationResult | null>(null)

  useEffect(() => { setPage(1) }, [search, showOnlySelected, sort])

  const filtered = useMemo(() => {
    let items = showOnlySelected ? results.filter((r) => selectedIds.has(r.id)) : results
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((r) => {
        const p = r.params as Record<string, unknown>
        return [
          r.coin_symbol ?? "", r.interval, String(p.slMode), String(p.tpMode),
          String(p.htfGate), String(p.volGate), String(p.side), String(p.threshold),
        ].join(" ").toLowerCase().includes(q)
      })
    }
    return [...items].sort((a, b) => {
      // Qualification dominates every sort: a 7-trade combo topping the table on
      // any column would read as a finding, and it isn't one.
      if (a.qualified !== b.qualified) return a.qualified ? -1 : 1
      let cmp: number
      switch (sort.field) {
        case "coin": cmp = (a.coin_symbol ?? "").localeCompare(b.coin_symbol ?? ""); break
        case "interval": cmp = a.interval.localeCompare(b.interval); break
        case "trainT": cmp = a.train_edge_t - b.train_edge_t; break
        case "trainBps": cmp = a.train_avg_net_bps - b.train_avg_net_bps; break
        case "sharpe":
          cmp = (perTradeSharpe(a.train_edge_t, a.train_n_trades) ?? -Infinity)
              - (perTradeSharpe(b.train_edge_t, b.train_n_trades) ?? -Infinity)
          break
        case "valT": cmp = a.val_edge_t - b.val_edge_t; break
        case "valBps": cmp = a.val_avg_net_bps - b.val_avg_net_bps; break
        case "trades": cmp = a.n_trades - b.n_trades; break
        case "winRate": cmp = a.win_rate_pct - b.win_rate_pct; break
        // Nulls (results predating these metrics) sort last either way.
        case "skew": cmp = (a.skew ?? -Infinity) - (b.skew ?? -Infinity); break
        case "maxDD": cmp = (a.max_drawdown_pct ?? Infinity) - (b.max_drawdown_pct ?? Infinity); break
        case "ret": cmp = a.total_return_pct - b.total_return_pct; break
      }
      if (cmp === 0) cmp = a.id.localeCompare(b.id)
      return sort.dir === "asc" ? cmp : -cmp
    })
  }, [results, search, sort, showOnlySelected, selectedIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const baseline = results.find((r) => r.is_baseline)
  const varied = useMemo(() => variedAxes(optimization.spec), [optimization.spec])
  const best = filtered.find((r) => r.qualified)

  function toggleSort(field: SortField) {
    setSort((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "desc" }))
  }
  const selectWhere = (pred: (r: OptimizationResult) => boolean) =>
    setSelectedIds(new Set(filtered.filter(pred).map((r) => r.id)))

  function SortHeader({ field, label, right }: { field: SortField; label: string; right?: boolean }) {
    const active = sort.field === field
    return (
      <button
        onClick={() => toggleSort(field)}
        className={cn("flex items-center gap-1 font-medium hover:text-foreground transition-colors cursor-pointer", right && "ml-auto")}
      >
        {label}
        {active ? (sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  return (
    <section className="rounded-lg border overflow-hidden">
      <div className="px-4 py-2 border-b bg-[var(--muted)]/30 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{optimization.name}</p>
          {optimization.description && (
            <p className="text-xs text-[var(--muted-foreground)]">{optimization.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <Input placeholder={t("searchResults")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 w-52 text-xs" />
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive cursor-pointer" title={t("deleteTitle")} onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* The caveat, sized to this search's own best result. */}
      <div className="px-4 py-2 border-b text-[11px] text-[var(--muted-foreground)] space-y-0.5">
        <p>
          {t("rankedOnTrain")}{" "}
          {best && results.length > 1 && (() => {
            const rate = noiseBeatRate(best.train_edge_t, results.length)
            // 1-in-20 is where a result stops being something noise routinely
            // produces. Below it, still a candidate — not a conclusion.
            const weak = rate >= 0.05
            return (
              <span className={cn(weak ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                {t(weak ? "noiseWeak" : "noiseStrong", {
                  t: best.train_edge_t.toFixed(2),
                  n: results.length.toLocaleString("en-US"),
                  pct: rate >= 0.01 ? `${Math.round(rate * 100)}%` : "<1%",
                })}
              </span>
            )
          })()}
        </p>
        {baseline && best && (
          <p>
            {t("baselineCompare", {
              baseT: baseline.train_edge_t.toFixed(2),
              baseVal: baseline.val_edge_t.toFixed(2),
              bestT: best.train_edge_t.toFixed(2),
              bestVal: best.val_edge_t.toFixed(2),
            })}
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 pl-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1 cursor-pointer text-[var(--muted-foreground)] hover:text-foreground">
                      <Checkbox checked={filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))} />
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => selectWhere(() => true)}>{t("selectAll")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => selectWhere((r) => starredIds.has(r.id))}>{t("selectStarred")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedIds(new Set())}>{t("clearSelection")}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => selectWhere((r) => r.qualified)}>{t("selectQualified")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => selectWhere((r) => r.val_edge_t >= 2)}>{t("selectValidated")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead><SortHeader field="coin" label={t("colCoin")} /></TableHead>
              <TableHead><SortHeader field="interval" label={t("colTimeframe")} /></TableHead>
              <TableHead>{t("colVariation")}</TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <SortHeader field="trainT" label={t("colTrainT")} right />
                  <InfoIcon text={t("explainT")} />
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <SortHeader field="trainBps" label={t("colTrainBps")} right />
                  <InfoIcon text={t("explainBps")} />
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <SortHeader field="sharpe" label={t("colSharpe")} right />
                  <InfoIcon text={t("explainSharpe")} />
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <SortHeader field="valT" label={t("colValT")} right />
                  <InfoIcon text={t("explainT")} />
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <SortHeader field="valBps" label={t("colValBps")} right />
                  <InfoIcon text={t("explainBps")} />
                </span>
              </TableHead>
              <TableHead className="text-right"><SortHeader field="trades" label={t("colTrades")} right /></TableHead>
              <TableHead className="text-right"><SortHeader field="winRate" label={t("colWinRate")} right /></TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <SortHeader field="skew" label={t("colSkew")} right />
                  <InfoIcon text={t("explainSkew")} />
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <SortHeader field="maxDD" label={t("colMaxDD")} right />
                  <InfoIcon text={t("explainMaxDD")} />
                </span>
              </TableHead>
              <TableHead className="w-10 text-center" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} className="h-24 text-center text-sm text-[var(--muted-foreground)]">
                  {running ? t("resultsPending") : t("resultsEmpty")}
                </TableCell>
              </TableRow>
            ) : pageRows.map((r) => {
              const p = r.params as Record<string, unknown>
              return (
                <TableRow
                  key={r.id}
                  data-state={selectedIds.has(r.id) ? "selected" : undefined}
                  className={cn(
                    "cursor-pointer",
                    !r.qualified && "opacity-50",
                    // The row to compare everything else against — tinted rather
                    // than only badged, so it's findable while scrolling.
                    r.is_baseline && "bg-sky-500/10 hover:bg-sky-500/15",
                  )}
                  onClick={() => setOpenRow(r)}
                  onContextMenu={(e) => { e.preventDefault(); setStarredIds((prev) => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n }) }}
                >
                  <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => setSelectedIds((prev) => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })} />
                  </TableCell>
                  <TableCell className="font-medium">
                    {r.coin_symbol ?? "—"}
                    {r.is_baseline && <Badge variant="outline" className="ml-1.5 text-[10px] font-normal">{t("baseline")}</Badge>}
                  </TableCell>
                  <TableCell className="font-mono">{r.interval}</TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">
                    {t("variationSummary", {
                      streak: String(p.threshold), hold: String(p.holdBars), side: String(p.side),
                    })}
                    {String(p.slMode) !== "none" && ` · SL ${p.slMode}`}
                    {String(p.tpMode) !== "none" && ` · TP ${p.tpMode}`}
                    {String(p.htfGate) !== "off" && ` · HTF ${p.htfGate}`}
                    {String(p.volGate) !== "off" && ` · vol ${p.volGate}`}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono tabular-nums", tTone(r.train_edge_t))}>{r.train_edge_t.toFixed(2)}</TableCell>
                  <TableCell className={cn("text-right font-mono tabular-nums", r.train_avg_net_bps >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {r.train_avg_net_bps >= 0 ? "+" : ""}{r.train_avg_net_bps.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                    {perTradeSharpe(r.train_edge_t, r.train_n_trades)?.toFixed(3) ?? "—"}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono tabular-nums", tTone(r.val_edge_t))}>{r.val_edge_t.toFixed(2)}</TableCell>
                  <TableCell className={cn("text-right font-mono tabular-nums", r.val_avg_net_bps >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {r.val_avg_net_bps >= 0 ? "+" : ""}{r.val_avg_net_bps.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.n_trades.toLocaleString("en-US")}
                    {!r.qualified && <span className="text-amber-500" title={t("underpopulated")}> *</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.win_rate_pct.toFixed(0)}%</TableCell>
                  <TableCell className={cn(
                    "text-right font-mono tabular-nums",
                    // Only strong skew is worth flagging; mild asymmetry is normal.
                    // Negative is the dangerous direction — small wins funded by
                    // rare large losses, which t and Sharpe both flatter.
                    r.skew != null && r.skew <= -1 ? "text-amber-500"
                      : r.skew != null && r.skew >= 1 ? "text-sky-500"
                      : "text-[var(--muted-foreground)]",
                  )}>
                    {r.skew == null ? "—" : `${r.skew > 0 ? "+" : ""}${r.skew.toFixed(2)}`}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                    {r.max_drawdown_pct == null ? "—" : `${r.max_drawdown_pct.toFixed(1)}%`}
                  </TableCell>
                  <TableCell className="text-center" onClick={(e) => { e.stopPropagation(); setStarredIds((prev) => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n }) }}>
                    <button className="cursor-pointer" aria-label={t("star")}>
                      <Star className={cn("h-4 w-4", starredIds.has(r.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
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
            {t("showing", { from: (safePage - 1) * PER_PAGE + 1, to: Math.min(safePage * PER_PAGE, filtered.length), total: filtered.length })}
          </span>
          {totalPages > 1 && (
            <Pagination className="w-auto mx-0">
              <PaginationContent>
                <PaginationItem><PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} /></PaginationItem>
                {buildPaginationPages(safePage, totalPages).map((p, i) =>
                  p === "ellipsis"
                    ? <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                    : <PaginationItem key={p}><PaginationLink isActive={safePage === p} onClick={() => setPage(p)}>{p}</PaginationLink></PaginationItem>
                )}
                <PaginationItem><PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} /></PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-3 py-2 border-t bg-[var(--muted)]/30">
          <span className="text-xs text-[var(--muted-foreground)]">{t("selectedCount", { selected: selectedIds.size, total: filtered.length })}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer" onClick={() => setShowOnlySelected((v) => !v)} title={showOnlySelected ? t("showAll") : t("showOnlySelected")}>
            <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
          </Button>
        </div>
      )}

      <VariationDialog
        result={openRow}
        varied={varied}
        strategy={optimization.strategy}
        onClose={() => setOpenRow(null)}
        onImplement={(scope, params) => { onImplement(scope, params); setOpenRow(null) }}
      />
    </section>
  )
}
