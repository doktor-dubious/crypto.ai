"use client"

// Active (running) strategies on the Paper Trade page. Ordered open-positions
// first, then most-recently-traded, then newest-started. The top 4 render as
// full cards (header + prominent P/L + time buckets); any beyond that — plus any
// the user minimises — collapse to a compact name + P/L tile, several per row,
// and fold back out to a full card when clicked.

import { useMemo, useState } from "react"
import { Square, ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { cn } from "@/lib/utils"
import { formatUptime } from "@/components/workers/worker-ui"
import { strategyLabel } from "@/components/trading/strategy-meta"
import type { PaperTradeRun, CoinResponse } from "@/lib/api"

const FULL_LIMIT = 4

function fmtPnl(v: number | null | undefined): string {
  if (v == null) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`
}

// Percent of the run's starting stake (same base as the total, so buckets and
// total are directly comparable). Empty string when there's nothing to show.
function fmtPct(v: number | null | undefined, initial: number): string {
  if (v == null || !initial) return ""
  const p = (v / initial) * 100
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}%`
}

function pnlColor(v: number | null | undefined): string {
  if (v == null) return "text-[var(--muted-foreground)]"
  return v >= 0 ? "text-emerald-500" : "text-red-500"
}

interface Labels {
  profitLoss: string
  thisRun: string
  stop: string
  trades: string
  open: string
}

export function ActiveStrategies({
  runs,
  coinById,
  onStop,
  stopping,
  emptyLabel,
  labels,
}: {
  runs: PaperTradeRun[]
  coinById: Map<string, CoinResponse>
  onStop: (run: PaperTradeRun) => void
  stopping: boolean
  emptyLabel: string
  labels: Labels
}) {
  // Cards the user explicitly minimised (→ compact) or expanded (→ full). A card
  // is full when it's a default-full one that wasn't minimised, or was expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const minimize = (id: string) => {
    setCollapsed((prev) => new Set(prev).add(id))
    setExpanded((prev) => { const n = new Set(prev); n.delete(id); return n })
  }
  const expand = (id: string) => {
    setExpanded((prev) => new Set(prev).add(id))
    setCollapsed((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  // Order: open positions first, then most-recently-traded, then newest-started.
  const sorted = useMemo(() => {
    const ts = (v: string | null) => (v ? Date.parse(v) : -Infinity)
    return [...runs].sort((a, b) => {
      const ao = a.position ? 1 : 0
      const bo = b.position ? 1 : 0
      if (ao !== bo) return bo - ao
      const at = ts(a.last_trade_at)
      const bt = ts(b.last_trade_at)
      if (at !== bt) return bt - at
      return Date.parse(b.started_at) - Date.parse(a.started_at)
    })
  }, [runs])

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-[var(--muted-foreground)]">
        {emptyLabel}
      </div>
    )
  }

  const isFull = (run: PaperTradeRun, idx: number) =>
    (idx < FULL_LIMIT && !collapsed.has(run.id)) || expanded.has(run.id)
  const fulls = sorted.filter((r, i) => isFull(r, i))
  const compact = sorted.filter((r, i) => !isFull(r, i))

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-3">
      {fulls.map((run) => (
        <FullCard
          key={run.id}
          run={run}
          coinById={coinById}
          onStop={onStop}
          stopping={stopping}
          labels={labels}
          onMinimize={() => minimize(run.id)}
        />
      ))}

      {compact.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {compact.map((run) => (
            <CompactCard
              key={run.id}
              run={run}
              coinById={coinById}
              labels={labels}
              onExpand={() => expand(run.id)}
            />
          ))}
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}

function FullCard({
  run,
  coinById,
  onStop,
  stopping,
  labels,
  onMinimize,
}: {
  run: PaperTradeRun
  coinById: Map<string, CoinResponse>
  onStop: (run: PaperTradeRun) => void
  stopping: boolean
  labels: Labels
  onMinimize: () => void
}) {
  const symbol = run.scope?.coin_id ? coinById.get(run.scope.coin_id)?.symbol : null
  const buckets: [string, number | null][] = [
    ["1h", run.pnl.h1], ["3h", run.pnl.h3], ["6h", run.pnl.h6], ["12h", run.pnl.h12],
    ["24h", run.pnl.h24], ["1w", run.pnl.week], ["1M", run.pnl.month],
    ["All time", run.pnl.total],
  ]
  return (
    <div className="rounded-lg border bg-background overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 border-b bg-[var(--muted)]/30 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{run.template_name}</span>
          <span className="text-sm text-[var(--muted-foreground)]">{symbol ?? "—"}</span>
          <Badge variant="secondary" className="text-xs shrink-0">{strategyLabel(run.strategy)}</Badge>
          {run.position && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs shrink-0 capitalize",
                run.position === "long"
                  ? "border-emerald-500/40 text-emerald-500"
                  : "border-red-500/40 text-red-500",
              )}
            >
              {run.position}
            </Badge>
          )}
          <span className="text-xs text-[var(--muted-foreground)] shrink-0 tabular-nums">
            {run.n_trades} {labels.trades}
            {run.position ? ` · 1 ${labels.open}` : ""}
          </span>
        </div>
        <span className="text-xs text-[var(--muted-foreground)] tabular-nums shrink-0">{formatUptime(run.uptime_s)}</span>
      </div>

      {/* Body */}
      <div className="flex items-start gap-3 p-3">
        <div className="flex flex-col items-center justify-center gap-0.5 rounded-md border size-32 shrink-0">
          <span className={cn("text-3xl font-semibold tabular-nums", pnlColor(run.pnl.total))}>
            {fmtPnl(run.pnl.total)}
          </span>
          <span className={cn("text-sm tabular-nums", pnlColor(run.pnl.total))}>
            {fmtPct(run.pnl.total, run.initial_capital)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {buckets.map(([label, v]) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <div className="flex flex-col items-center justify-center rounded-md border size-16">
                  <span className={cn("text-xs font-medium tabular-nums", pnlColor(v))}>{fmtPnl(v)}</span>
                  <span className={cn("text-[9px] tabular-nums", pnlColor(v))}>{fmtPct(v, run.initial_capital)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* Controls: stop above minimise */}
        <div className="ml-auto flex flex-col items-center justify-between self-stretch shrink-0 py-0.5">
          <button
            onClick={() => onStop(run)}
            disabled={stopping}
            aria-label={labels.stop}
            title={labels.stop}
            className="text-[var(--muted-foreground)] hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Square className="h-4 w-4" />
          </button>
          <button
            onClick={onMinimize}
            aria-label="Minimize"
            title="Minimize"
            className="text-[var(--muted-foreground)] hover:text-foreground transition-colors cursor-pointer"
          >
            <Minimize size={16} animateOnHover />
          </button>
        </div>
      </div>

      {run.error && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          {run.error}
        </div>
      )}
    </div>
  )
}

// Collapsed tile: template name + coin + the P/L figure. Click to expand.
function CompactCard({
  run,
  coinById,
  labels,
  onExpand,
}: {
  run: PaperTradeRun
  coinById: Map<string, CoinResponse>
  labels: Labels
  onExpand: () => void
}) {
  const symbol = run.scope?.coin_id ? coinById.get(run.scope.coin_id)?.symbol : null
  return (
    <button
      onClick={onExpand}
      className="flex flex-col gap-1.5 rounded-lg border bg-background p-3 text-left hover:border-[var(--foreground)]/30 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium text-sm truncate">{run.template_name}</span>
        {symbol && <span className="text-xs text-[var(--muted-foreground)] shrink-0">{symbol}</span>}
        {run.position && (
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              run.position === "long" ? "bg-emerald-500" : "bg-red-500",
            )}
          />
        )}
        <ChevronDown className="h-3.5 w-3.5 ml-auto shrink-0 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{labels.profitLoss}</span>
        <div className="flex flex-col items-end leading-tight">
          <span className={cn("text-lg font-semibold tabular-nums", pnlColor(run.pnl.total))}>
            {fmtPnl(run.pnl.total)}
          </span>
          <span className={cn("text-[10px] tabular-nums", pnlColor(run.pnl.total))}>
            {fmtPct(run.pnl.total, run.initial_capital)}
          </span>
        </div>
      </div>
    </button>
  )
}
