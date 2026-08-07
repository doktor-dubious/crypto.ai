"use client"

// Sweep tab on the Paper Trade page: standings of the rotating strategy×coin
// search. Top: each sweep's config + queue progress with pause/rotate/advance
// controls. Below: per-template pooled results (the statistically meaningful
// grouping) with search/sort/pagination, then the best and worst individual
// runs (sortable). Clicking a standings Runs cell opens the full per-coin
// breakdown in a paginated dialog.

import { Fragment, useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  ArrowUpDown, ChevronDown, ChevronUp, FastForward, Pause, Play, RefreshCw, Search,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { strategyLabel } from "@/components/trading/strategy-meta"
import {
  paperSweepApi,
  type SweepPairStat, type SweepRunStat, type SweepStatus, type SweepTemplateStat,
} from "@/lib/api"

const PER_PAGE = 10
const TOOLTIP_COINS = 6

function pnlClass(v: number) {
  return v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "text-[var(--muted-foreground)]"
}

function pct(v: number) {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`
}

// Windowed page links (same shape as the other tables on this page).
function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function PageFooter({
  page, setPage, total, label,
}: {
  page: number
  setPage: (updater: (p: number) => number) => void
  total: number
  label: string
}) {
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border)]">
      <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
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
                  <PaginationLink isActive={p === safePage} onClick={() => setPage(() => p)}>{p}</PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}

// ── Generic column sorting ────────────────────────────────────────────────────

type SortDir = "asc" | "desc"

function useSort<F extends string>(initialField: F, initialDir: SortDir = "desc") {
  const [field, setField] = useState<F>(initialField)
  const [dir, setDir] = useState<SortDir>(initialDir)
  const toggle = (f: F, defaultDir: SortDir = "desc") => {
    if (f === field) setDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setField(f); setDir(defaultDir) }
  }
  return { field, dir, toggle }
}

function sortRows<T, F extends string>(
  rows: T[], field: F, dir: SortDir, get: (row: T, field: F) => string | number,
): T[] {
  const mul = dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = get(a, field)
    const vb = get(b, field)
    const c = typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb))
    return c * mul
  })
}

function SortHead<F extends string>({
  field, sort, children, className,
}: {
  field: F
  sort: { field: F; dir: SortDir; toggle: (f: F) => void }
  children: React.ReactNode
  className?: string
}) {
  const active = sort.field === field
  const Icon = active ? (sort.dir === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown
  return (
    <TableHead className={cn("cursor-pointer select-none", className)} onClick={() => sort.toggle(field)}>
      <span className={cn("inline-flex items-center gap-1", className?.includes("text-right") && "justify-end w-full")}>
        {children}
        <Icon className={cn("h-3 w-3 shrink-0", active ? "" : "text-[var(--muted-foreground)]/50")} />
      </span>
    </TableHead>
  )
}

// A template name that opens the template on the Strategies tab (same gesture as
// clicking a card title on the Active tab). Plain text when no handler is wired.
// `runId` carries the specific run a row stands for (the best/worst-runs table
// is one row per template×coin). Without it the detail pane can only guess which
// of the template's runs to open, and a BANK row would land on the BTC run.
function TemplateName({ id, name, runId, onOpen }: {
  id: string
  name: string
  runId?: string
  onOpen?: (templateId: string, runId?: string) => void
}) {
  if (!onOpen) return <>{name}</>
  return (
    <span
      className="cursor-pointer hover:underline underline-offset-2"
      onClick={() => onOpen(id, runId)}
    >
      {name}
    </span>
  )
}

// ── A/B pairs (higher-timeframe gate) ────────────────────────────────────────

// The bar for believing a pair, and the same one the Analyze tab uses: a paired
// t of |2| over at least 10 matched runs. Everything below it is rendered muted
// so a big-looking delta on three coins can't read as a result.
const PAIR_MIN_N = 10
const PAIR_MIN_T = 2

function PairsTable({ pairs, t, onOpenTemplate }: {
  pairs: SweepPairStat[]
  t: ReturnType<typeof useTranslations>
  onOpenTemplate?: (templateId: string, runId?: string) => void
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">{t("sweepPairsTitle")}</h3>
        <p className="text-xs text-[var(--muted-foreground)]">{t("sweepPairsHint")}</p>
      </div>
      <div className="rounded-md border border-[var(--border)] overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sweepColTemplate")}</TableHead>
              <TableHead>{t("sweepColGate")}</TableHead>
              <TableHead className="text-right">{t("sweepColPaired")}</TableHead>
              <TableHead className="text-right">{t("sweepColBasePnl")}</TableHead>
              <TableHead className="text-right">{t("sweepColVariantPnl")}</TableHead>
              <TableHead className="text-right">{t("sweepColDelta")}</TableHead>
              <TableHead className="text-right">{t("sweepColDeltaT")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pairs.map((p) => {
              const conclusive = p.n_paired >= PAIR_MIN_N && Math.abs(p.delta_t) >= PAIR_MIN_T
              return (
                <TableRow key={`${p.base_template_id}-${p.variant_template_id}`}>
                  <TableCell className="text-xs font-medium">
                    <TemplateName id={p.base_template_id} name={p.base_template_name} onOpen={onOpenTemplate} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="secondary" className="text-[10px] font-mono">{p.variant_gate}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="underline decoration-dotted decoration-[var(--muted-foreground)]/50 underline-offset-2 cursor-help">
                            {p.n_paired}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {t("sweepPairTradesTooltip", {
                            base: p.base_trades, variant: p.variant_trades,
                          })}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className={cn("text-xs text-right", pnlClass(p.base_avg_pnl_pct))}>
                    {pct(p.base_avg_pnl_pct)}
                  </TableCell>
                  <TableCell className={cn("text-xs text-right", pnlClass(p.variant_avg_pnl_pct))}>
                    {pct(p.variant_avg_pnl_pct)}
                  </TableCell>
                  <TableCell className={cn(
                    "text-xs text-right",
                    conclusive
                      ? cn("font-medium", pnlClass(p.delta_avg_pnl_pct))
                      : "text-[var(--muted-foreground)]",
                  )}>
                    {pct(p.delta_avg_pnl_pct)}
                  </TableCell>
                  <TableCell className={cn(
                    "text-xs text-right font-mono",
                    conclusive ? "font-medium" : "text-[var(--muted-foreground)]",
                  )}>
                    {p.delta_t.toFixed(2)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ── Best / worst individual runs ──────────────────────────────────────────────

type RunSortField = "template_name" | "coin_symbol" | "interval" | "days" | "n_trades" | "pnl_pct" | "status"

function RunsTable({ title, runs, initialDir, t, onOpenTemplate }: {
  title: string
  runs: SweepRunStat[]
  initialDir: SortDir
  t: ReturnType<typeof useTranslations>
  onOpenTemplate?: (templateId: string, runId?: string) => void
}) {
  const sort = useSort<RunSortField>("pnl_pct", initialDir)
  const sorted = useMemo(
    () => sortRows(runs, sort.field, sort.dir, (r, f) => r[f]),
    [runs, sort.field, sort.dir],
  )
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="rounded-md border border-[var(--border)] overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead field="template_name" sort={sort}>{t("sweepColTemplate")}</SortHead>
              <SortHead field="coin_symbol" sort={sort}>{t("sweepColCoin")}</SortHead>
              <SortHead field="interval" sort={sort}>{t("colTimeframe")}</SortHead>
              <SortHead field="days" sort={sort} className="text-right">{t("sweepColDays")}</SortHead>
              <SortHead field="n_trades" sort={sort} className="text-right">{t("trades")}</SortHead>
              <SortHead field="pnl_pct" sort={sort} className="text-right">{t("sweepColPnl")}</SortHead>
              <SortHead field="status" sort={sort}>{t("sweepColStatus")}</SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.run_id}>
                <TableCell className="text-xs">
                  <TemplateName id={r.template_id} name={r.template_name} runId={r.run_id} onOpen={onOpenTemplate} />
                </TableCell>
                <TableCell className="text-xs font-medium">{r.coin_symbol}</TableCell>
                <TableCell className="text-xs">{r.interval}</TableCell>
                <TableCell className="text-xs text-right">{r.days.toFixed(1)}</TableCell>
                <TableCell className="text-xs text-right">{r.n_trades}</TableCell>
                <TableCell className={cn("text-xs text-right font-medium", pnlClass(r.pnl_pct))}>
                  {pct(r.pnl_pct)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(
                    "text-[10px]",
                    r.status === "running" && "border-emerald-500/40 text-emerald-500",
                  )}>
                    {r.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ── Per-coin breakdown dialog (opened from a standings Runs cell) ────────────

function CoinsDialog({ template, onClose, t }: {
  template: SweepTemplateStat | null
  onClose: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const [page, setPage] = useState(1)
  const coins = template?.coins ?? []
  const safePage = Math.min(page, Math.max(1, Math.ceil(coins.length / PER_PAGE)))
  const pageCoins = coins.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)
  return (
    <Dialog open={template !== null} onOpenChange={(open) => { if (!open) { onClose(); setPage(1) } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("sweepCoinsDialogTitle", { name: template?.template_name ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("sweepCoinsDialogBody", { count: coins.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-[var(--border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sweepColCoin")}</TableHead>
                <TableHead className="text-right">{t("trades")}</TableHead>
                <TableHead className="text-right">{t("sweepColPnl")}</TableHead>
                <TableHead>{t("sweepColStatus")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageCoins.map((c, i) => (
                <TableRow key={`${c.symbol}-${i}`}>
                  <TableCell className="text-xs font-medium">{c.symbol}</TableCell>
                  <TableCell className="text-xs text-right">{c.n_trades}</TableCell>
                  <TableCell className={cn("text-xs text-right font-medium", pnlClass(c.pnl_pct))}>
                    {pct(c.pnl_pct)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(
                      "text-[10px]",
                      c.status === "running" && "border-emerald-500/40 text-emerald-500",
                    )}>
                      {c.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PageFooter
            page={safePage}
            setPage={(u) => setPage(u)}
            total={coins.length}
            label={t("sweepShowingCoins", {
              from: coins.length === 0 ? 0 : (safePage - 1) * PER_PAGE + 1,
              to: Math.min(safePage * PER_PAGE, coins.length),
              total: coins.length,
            })}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type TemplateSortField =
  | "template_name" | "strategy" | "n_runs" | "avg_pnl_pct" | "median_pnl_pct"
  | "win_rate_pct" | "total_trades" | "total_pnl_quote"

export function SweepLeaderboard({ onOpenTemplate }: { onOpenTemplate?: (templateId: string, runId?: string) => void }) {
  const t = useTranslations("paperTrade")
  const queryClient = useQueryClient()

  const { data: sweeps = [] } = useQuery({
    queryKey: ["paper-sweeps"],
    queryFn: paperSweepApi.list,
    refetchInterval: 30_000,
  })
  const { data: board } = useQuery({
    queryKey: ["paper-sweep-leaderboard"],
    queryFn: () => paperSweepApi.leaderboard(undefined, 15),
    refetchInterval: 30_000,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      paperSweepApi.setEnabled(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["paper-sweeps"] }),
    onError: (e) => toast.error(String(e)),
  })
  const rotateMutation = useMutation({
    mutationFn: paperSweepApi.rotate,
    onSuccess: (r) => {
      toast.success(t("sweepRotated", { stopped: r.stopped, started: r.started }))
      queryClient.invalidateQueries({ queryKey: ["paper-sweeps"] })
      queryClient.invalidateQueries({ queryKey: ["paper-sweep-leaderboard"] })
      queryClient.invalidateQueries({ queryKey: ["paper-runs"] })
    },
    onError: (e) => toast.error(String(e)),
  })

  // "Advance wave" confirm dialog — force-swaps every running combo, so it's
  // guarded like the delete dialogs (checkbox + typed confirmation).
  const [advanceTarget, setAdvanceTarget] = useState<SweepStatus | null>(null)
  const [advanceUnderstood, setAdvanceUnderstood] = useState(false)
  const [advanceConfirmText, setAdvanceConfirmText] = useState("")
  const openAdvance = (s: SweepStatus) => {
    setAdvanceUnderstood(false)
    setAdvanceConfirmText("")
    setAdvanceTarget(s)
  }
  const advanceMutation = useMutation({
    mutationFn: (sweepId: string) => paperSweepApi.advance(sweepId),
    onSuccess: (r) => {
      toast.success(t("sweepAdvanced", { stopped: r.stopped, started: r.started }))
      setAdvanceTarget(null)
      queryClient.invalidateQueries({ queryKey: ["paper-sweeps"] })
      queryClient.invalidateQueries({ queryKey: ["paper-sweep-leaderboard"] })
      queryClient.invalidateQueries({ queryKey: ["paper-runs"] })
    },
    onError: (e) => toast.error(String(e)),
  })

  // Standings table state: search, sort, pagination, coins dialog.
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const sort = useSort<TemplateSortField>("avg_pnl_pct", "desc")
  const [coinsTarget, setCoinsTarget] = useState<SweepTemplateStat | null>(null)

  const standings = useMemo(() => {
    let rows = board?.templates ?? []
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((tp) =>
        tp.template_name.toLowerCase().includes(q)
        || tp.strategy.toLowerCase().includes(q)
        || strategyLabel(tp.strategy).toLowerCase().includes(q)
        || tp.coins.some((c) => c.symbol.toLowerCase().includes(q)),
      )
    }
    return sortRows(rows, sort.field, sort.dir, (r, f) => r[f])
  }, [board?.templates, search, sort.field, sort.dir])
  const safePage = Math.min(page, Math.max(1, Math.ceil(standings.length / PER_PAGE)))
  const pageStandings = standings.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  return (
    <div className="mt-6 space-y-6">
      {/* ── Sweep status cards ── */}
      {sweeps.map((s) => (
        <div key={s.id} className="rounded-md border border-[var(--border)] p-4 flex items-center gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold truncate">{s.name}</h2>
              <Badge variant="outline" className={cn(
                "text-[10px]",
                s.enabled ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500",
              )}>
                {s.enabled ? t("sweepEnabled") : t("sweepPaused")}
              </Badge>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              {t("sweepConfig", {
                templates: s.n_templates, coins: s.n_coins, cap: s.max_concurrent,
                dwell: s.dwell_days, capital: s.initial_capital,
              })}
            </p>
          </div>
          <div className="flex items-center gap-6 ml-auto">
            <div className="text-right">
              <div className="text-sm font-medium">{s.n_running}</div>
              <div className="text-[10px] text-[var(--muted-foreground)]">{t("sweepRunning")}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium">{s.n_combos_tried} / {s.n_combos_total}</div>
              <div className="text-[10px] text-[var(--muted-foreground)]">{t("sweepCombosTried")}</div>
            </div>
            <Button
              variant="outline" size="sm" className="h-8 cursor-pointer"
              disabled={rotateMutation.isPending}
              onClick={() => rotateMutation.mutate()}
              title={t("sweepRotateTooltip")}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              {t("sweepRotateNow")}
            </Button>
            <Button
              variant="outline" size="sm"
              className="h-8 cursor-pointer border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={advanceMutation.isPending || s.n_running === 0}
              onClick={() => openAdvance(s)}
              title={t("sweepAdvanceTooltip")}
            >
              <FastForward className="h-3.5 w-3.5 mr-1" />
              {t("sweepAdvance")}
            </Button>
            <Button
              variant="outline" size="sm" className="h-8 cursor-pointer"
              disabled={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate({ id: s.id, enabled: !s.enabled })}
            >
              {s.enabled
                ? <><Pause className="h-3.5 w-3.5 mr-1" />{t("sweepPause")}</>
                : <><Play className="h-3.5 w-3.5 mr-1" />{t("sweepResume")}</>}
            </Button>
          </div>
        </div>
      ))}
      {sweeps.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">{t("sweepEmpty")}</p>
      )}

      {/* ── Tick-guard notice: runs hidden from every stat below ── */}
      {board && board.n_tick_excluded > 0 && (
        <p className="text-xs text-[var(--muted-foreground)]">
          {t("sweepTickExcluded", {
            count: board.n_tick_excluded,
            pct: board.tick_pct_limit,
            symbols: board.tick_excluded_symbols.join(", "),
          })}
        </p>
      )}

      {/* ── A/B pairs: the gate's measured effect ── */}
      {board && board.pairs.length > 0 && (
        <PairsTable pairs={board.pairs} t={t} onOpenTemplate={onOpenTemplate} />
      )}

      {/* ── Per-template standings ── */}
      {board && board.templates.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-medium">{t("sweepTemplatesTitle")}</h3>
              <p className="text-xs text-[var(--muted-foreground)]">{t("sweepTemplatesHint")}</p>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <Input
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="h-8 pl-8 w-56 text-xs"
              />
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)]">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead field="template_name" sort={sort}>{t("sweepColTemplate")}</SortHead>
                    <SortHead field="strategy" sort={sort}>{t("colStrategy")}</SortHead>
                    <SortHead field="n_runs" sort={sort} className="text-right">{t("sweepColRuns")}</SortHead>
                    <SortHead field="avg_pnl_pct" sort={sort} className="text-right">{t("sweepColAvgPnl")}</SortHead>
                    <SortHead field="median_pnl_pct" sort={sort} className="text-right">{t("sweepColMedianPnl")}</SortHead>
                    <SortHead field="win_rate_pct" sort={sort} className="text-right">{t("sweepColWinRate")}</SortHead>
                    <SortHead field="total_trades" sort={sort} className="text-right">{t("trades")}</SortHead>
                    <SortHead field="total_pnl_quote" sort={sort} className="text-right">{t("sweepColTotalPnl")}</SortHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageStandings.map((tp) => (
                    <TableRow key={tp.template_id}>
                      <TableCell className="text-xs font-medium">
                        <TemplateName id={tp.template_id} name={tp.template_name} onOpen={onOpenTemplate} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="secondary" className="text-[10px]">{strategyLabel(tp.strategy)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="cursor-pointer underline decoration-dotted decoration-[var(--muted-foreground)]/50 underline-offset-2"
                                onClick={() => setCoinsTarget(tp)}
                              >
                                {tp.n_runs}{tp.n_running > 0 && (
                                  <span className="text-[var(--muted-foreground)]"> ({tp.n_running} {t("sweepRunningShort")})</span>
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <div className="grid grid-cols-[auto_auto_auto] gap-x-3 gap-y-0.5 text-xs">
                                {tp.coins.slice(0, TOOLTIP_COINS).map((c, i) => (
                                  <Fragment key={`${c.symbol}-${i}`}>
                                    <span className="font-medium">{c.symbol}</span>
                                    <span className={cn("text-right", pnlClass(c.pnl_pct))}>{pct(c.pnl_pct)}</span>
                                    <span className="text-[var(--muted-foreground)]">
                                      {c.status === "running" ? t("sweepRunningShort") : c.status}
                                    </span>
                                  </Fragment>
                                ))}
                                {tp.coins.length > TOOLTIP_COINS && (
                                  <span className="col-span-3 text-[var(--muted-foreground)]">…</span>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className={cn("text-xs text-right font-medium", pnlClass(tp.avg_pnl_pct))}>
                        {pct(tp.avg_pnl_pct)}
                      </TableCell>
                      <TableCell className={cn("text-xs text-right", pnlClass(tp.median_pnl_pct))}>
                        {pct(tp.median_pnl_pct)}
                      </TableCell>
                      <TableCell className="text-xs text-right">{tp.win_rate_pct.toFixed(0)}%</TableCell>
                      <TableCell className="text-xs text-right">{tp.total_trades}</TableCell>
                      <TableCell className={cn("text-xs text-right", pnlClass(tp.total_pnl_quote))}>
                        {tp.total_pnl_quote.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PageFooter
              page={safePage}
              setPage={(u) => setPage(u)}
              total={standings.length}
              label={t("showing", {
                from: standings.length === 0 ? 0 : (safePage - 1) * PER_PAGE + 1,
                to: Math.min(safePage * PER_PAGE, standings.length),
                total: standings.length,
              })}
            />
          </div>
        </div>
      )}

      {/* ── Best / worst individual runs ── */}
      {board && board.top_runs.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-2">
          <RunsTable title={t("sweepTopRuns")} runs={board.top_runs} initialDir="desc" t={t} onOpenTemplate={onOpenTemplate} />
          <RunsTable title={t("sweepBottomRuns")} runs={board.bottom_runs} initialDir="asc" t={t} onOpenTemplate={onOpenTemplate} />
        </div>
      )}

      {/* ── Per-coin breakdown dialog ── */}
      <CoinsDialog template={coinsTarget} onClose={() => setCoinsTarget(null)} t={t} />

      {/* ── Advance-wave confirm dialog ── */}
      <Dialog open={advanceTarget !== null} onOpenChange={(open) => { if (!open) setAdvanceTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("sweepAdvanceTitle")}</DialogTitle>
            <DialogDescription>
              {t("sweepAdvanceBody", {
                count: advanceTarget?.n_running ?? 0,
                name: advanceTarget?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox
                checked={advanceUnderstood}
                onCheckedChange={(v) => setAdvanceUnderstood(!!v)}
                className="mt-0.5 shrink-0"
              />
              <span className="text-sm">{t("sweepAdvanceUnderstand")}</span>
            </label>
            <div className="space-y-1.5">
              <span className="text-sm text-[var(--muted-foreground)]">{t("sweepAdvanceTypeToConfirm")}</span>
              <Input
                value={advanceConfirmText}
                onChange={(e) => setAdvanceConfirmText(e.target.value)}
                placeholder="advance"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setAdvanceTarget(null)}>
              {t("sweepAdvanceCancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => advanceTarget && advanceMutation.mutate(advanceTarget.id)}
              disabled={!advanceUnderstood || advanceConfirmText !== "advance" || advanceMutation.isPending}
            >
              {t("sweepAdvanceConfirm", { count: advanceTarget?.n_running ?? 0 })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
