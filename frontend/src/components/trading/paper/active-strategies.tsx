"use client"

// Active (running) strategies on the Paper Trade page. Each running strategy is
// a card (full or minimised); the user's minimise/expand choice persists per
// group-by mode. Ordering is stable by default (newest-started first) so the
// layout doesn't churn as trades land; the "Active Up" toggle re-sorts open
// positions + most-recently-traded to the top on demand. A "Group by" mode
// (coin groups / coins / strategies) collapses many runs into one aggregate card.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Square, ChevronDown, Radio } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { cn } from "@/lib/utils"
import { formatUptime } from "@/components/workers/worker-ui"
import { strategyLabel } from "@/components/trading/strategy-meta"
import type { PaperTradeRun, PaperTradePnl, CoinResponse, CoinGroup } from "@/lib/api"

const FULL_LIMIT = 4

export type GroupByMode = "none" | "groups" | "coins" | "strategies"

// Persist which cards the user minimised / expanded (by display key), scoped per
// group-by mode so switching modes doesn't clobber the other mode's choices.
const COLLAPSED_KEY = "gorm:paperTrade:collapsedByMode"
const EXPANDED_KEY = "gorm:paperTrade:expandedByMode"

type ModeSets = Record<string, string[]>

function loadModeSets(key: string): ModeSets {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as ModeSets) : {}
  } catch { return {} }
}
function saveModeSets(key: string, value: ModeSets) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

// Group thousands with a comma and always show 2 decimals (e.g. 2425.67 →
// 2,425.67). The sign prefix is added separately so positives read "+…".
const num2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtPnl(v: number | null | undefined): string {
  if (v == null) return "—"
  return `${v > 0 ? "+" : ""}${num2(v)}`
}

// Percent of the run's starting stake (same base as the total, so buckets and
// total are directly comparable). Empty string when there's nothing to show.
function fmtPct(v: number | null | undefined, initial: number): string {
  if (v == null || !initial) return ""
  const p = (v / initial) * 100
  return `${p > 0 ? "+" : ""}${num2(p)}%`
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
  uptime: string
  runsSuffix: string
  mixed: string
  ungrouped: string
  goLive: string
}

// ─── Display model ─────────────────────────────────────────────────────────────
// A card is either a single run or an aggregate of several runs; both render
// through the same DisplayItem so ordering / minimise logic stays uniform.

interface DisplayItem {
  key: string
  title: string
  aggregate: boolean
  symbol: string | null            // single only
  runCount: number
  strategyBadge: string | null
  position: "long" | "short" | "mixed" | null
  openCount: number
  n_trades: number
  initial_capital: number
  pnl: PaperTradePnl
  uptime_s: number | null
  last_trade_at: string | null
  started_at: string
  error: string | null
  runs: PaperTradeRun[]
  single: PaperTradeRun | null
}

const PNL_KEYS = ["total", "h1", "h3", "h6", "h12", "h24", "week", "month"] as const

function sumPnl(runs: PaperTradeRun[]): PaperTradePnl {
  const out = {} as PaperTradePnl
  for (const k of PNL_KEYS) {
    let s = 0
    let any = false
    for (const r of runs) {
      const v = r.pnl[k]
      if (v != null) { s += v; any = true }
    }
    out[k] = any ? s : null
  }
  return out
}

function maxTs(runs: PaperTradeRun[], pick: (r: PaperTradeRun) => string | null): string | null {
  let best: string | null = null
  for (const r of runs) {
    const v = pick(r)
    if (v && (!best || Date.parse(v) > Date.parse(best))) best = v
  }
  return best
}

function singleItem(r: PaperTradeRun, coinById: Map<string, CoinResponse>): DisplayItem {
  return {
    key: r.id,
    // What the user named THIS run; sweep-started runs have none, so they fall
    // back to the strategy's name frozen at start.
    title: r.name ?? r.template_name,
    aggregate: false,
    symbol: r.scope?.coin_id ? coinById.get(r.scope.coin_id)?.symbol ?? null : null,
    runCount: 1,
    strategyBadge: strategyLabel(r.strategy),
    position: r.position,
    openCount: r.position ? 1 : 0,
    n_trades: r.n_trades,
    initial_capital: r.initial_capital,
    pnl: r.pnl,
    uptime_s: r.uptime_s,
    last_trade_at: r.last_trade_at,
    started_at: r.started_at,
    error: r.error,
    runs: [r],
    single: r,
  }
}

function aggregateItem(key: string, title: string, runs: PaperTradeRun[]): DisplayItem {
  const openRuns = runs.filter((r) => r.position)
  const dirs = new Set(openRuns.map((r) => r.position))
  const position: DisplayItem["position"] =
    openRuns.length === 0 ? null : dirs.size === 1 ? (openRuns[0].position ?? null) : "mixed"
  return {
    key,
    title,
    aggregate: true,
    symbol: null,
    runCount: runs.length,
    strategyBadge: null,
    position,
    openCount: openRuns.length,
    n_trades: runs.reduce((s, r) => s + r.n_trades, 0),
    initial_capital: runs.reduce((s, r) => s + r.initial_capital, 0),
    pnl: sumPnl(runs),
    uptime_s: runs.reduce<number | null>((m, r) => (r.uptime_s != null ? Math.max(m ?? 0, r.uptime_s) : m), null),
    last_trade_at: maxTs(runs, (r) => r.last_trade_at),
    started_at: runs.reduce((min, r) => (Date.parse(r.started_at) < Date.parse(min) ? r.started_at : min), runs[0].started_at),
    error: null,
    runs,
    single: null,
  }
}

function buildDisplayItems(
  runs: PaperTradeRun[],
  groupBy: GroupByMode,
  coinById: Map<string, CoinResponse>,
  coinGroups: CoinGroup[],
  labels: Labels,
): DisplayItem[] {
  if (groupBy === "none") return runs.map((r) => singleItem(r, coinById))

  // key + label per run for the chosen grouping.
  let keyOf: (r: PaperTradeRun) => { key: string; title: string }
  if (groupBy === "coins") {
    keyOf = (r) => {
      const cid = r.scope?.coin_id
      const sym = cid ? coinById.get(cid)?.symbol : null
      return { key: `coin:${cid ?? "none"}`, title: sym ?? "—" }
    }
  } else if (groupBy === "strategies") {
    keyOf = (r) => ({ key: `strat:${r.strategy}`, title: strategyLabel(r.strategy) })
  } else {
    // coin groups — assign each coin to the first group (by name) that contains it.
    const sorted = [...coinGroups].sort((a, b) => a.name.localeCompare(b.name))
    const coinToGroup = new Map<string, { id: string; name: string }>()
    for (const g of sorted) {
      for (const cid of g.member_coin_ids) {
        if (!coinToGroup.has(cid)) coinToGroup.set(cid, { id: g.id, name: g.name })
      }
    }
    keyOf = (r) => {
      const cid = r.scope?.coin_id
      const g = cid ? coinToGroup.get(cid) : undefined
      return g ? { key: `cg:${g.id}`, title: g.name } : { key: "cg:ungrouped", title: labels.ungrouped }
    }
  }

  const order: string[] = []
  const byKey = new Map<string, { title: string; runs: PaperTradeRun[] }>()
  for (const r of runs) {
    const { key, title } = keyOf(r)
    let bucket = byKey.get(key)
    if (!bucket) { bucket = { title, runs: [] }; byKey.set(key, bucket); order.push(key) }
    bucket.runs.push(r)
  }
  return order.map((key) => { const b = byKey.get(key)!; return aggregateItem(key, b.title, b.runs) })
}

export function ActiveStrategies({
  runs,
  coinById,
  coinGroups,
  groupBy,
  activeUp,
  onStopRun,
  onStopMany,
  onGoLive,
  href,
  stopping,
  emptyLabel,
  labels,
}: {
  runs: PaperTradeRun[]
  coinById: Map<string, CoinResponse>
  coinGroups: CoinGroup[]
  groupBy: GroupByMode
  activeUp: boolean
  onStopRun: (run: PaperTradeRun) => void
  onStopMany: (runs: PaperTradeRun[], label: string) => void
  onGoLive?: (run: PaperTradeRun) => void
  href?: (run: PaperTradeRun) => string
  stopping: boolean
  emptyLabel: string
  labels: Labels
}) {
  // Minimise / expand choices, kept per group-by mode.
  const [collapsedByMode, setCollapsedByMode] = useModeSets(COLLAPSED_KEY)
  const [expandedByMode, setExpandedByMode] = useModeSets(EXPANDED_KEY)
  const collapsed = useMemo(() => new Set(collapsedByMode[groupBy] ?? []), [collapsedByMode, groupBy])
  const expanded = useMemo(() => new Set(expandedByMode[groupBy] ?? []), [expandedByMode, groupBy])

  const items = useMemo(
    () => buildDisplayItems(runs, groupBy, coinById, coinGroups, labels),
    [runs, groupBy, coinById, coinGroups, labels],
  )

  // Forget keys for cards that no longer exist (per current mode).
  useEffect(() => {
    const live = new Set(items.map((d) => d.key))
    const prune = (m: ModeSets) => {
      const cur = m[groupBy] ?? []
      const next = cur.filter((id) => live.has(id))
      return next.length === cur.length ? m : { ...m, [groupBy]: next }
    }
    setCollapsedByMode(prune)
    setExpandedByMode(prune)
  }, [items, groupBy, setCollapsedByMode, setExpandedByMode])

  const minimize = (id: string) => {
    setCollapsedByMode((m) => ({ ...m, [groupBy]: [...new Set([...(m[groupBy] ?? []), id])] }))
    setExpandedByMode((m) => ({ ...m, [groupBy]: (m[groupBy] ?? []).filter((x) => x !== id) }))
  }
  const expand = (id: string) => {
    setExpandedByMode((m) => ({ ...m, [groupBy]: [...new Set([...(m[groupBy] ?? []), id])] }))
    setCollapsedByMode((m) => ({ ...m, [groupBy]: (m[groupBy] ?? []).filter((x) => x !== id) }))
  }

  // Ordering. Stable (newest-started first) by default; Active Up promotes open
  // positions + most-recently-traded to the top.
  const sorted = useMemo(() => {
    const ts = (v: string | null) => (v ? Date.parse(v) : -Infinity)
    return [...items].sort((a, b) => {
      if (activeUp) {
        const ao = a.openCount > 0 ? 1 : 0
        const bo = b.openCount > 0 ? 1 : 0
        if (ao !== bo) return bo - ao
        const at = ts(a.last_trade_at)
        const bt = ts(b.last_trade_at)
        if (at !== bt) return bt - at
      }
      return Date.parse(b.started_at) - Date.parse(a.started_at)
    })
  }, [items, activeUp])

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-[var(--muted-foreground)]">
        {emptyLabel}
      </div>
    )
  }

  const isFull = (item: DisplayItem, idx: number) =>
    (idx < FULL_LIMIT && !collapsed.has(item.key)) || expanded.has(item.key)
  const fulls = sorted.filter((r, i) => isFull(r, i))
  const compact = sorted.filter((r, i) => !isFull(r, i))

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-3">
      {fulls.map((item) => (
        <FullCard
          key={item.key}
          item={item}
          onStopRun={onStopRun}
          onStopMany={onStopMany}
          onGoLive={onGoLive}
          href={href}
          stopping={stopping}
          labels={labels}
          onMinimize={() => minimize(item.key)}
        />
      ))}

      {compact.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {compact.map((item) => (
            <CompactCard
              key={item.key}
              item={item}
              labels={labels}
              onExpand={() => expand(item.key)}
            />
          ))}
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}

// Small helper: a localStorage-backed ModeSets state (persisted on every change).
function useModeSets(key: string): [ModeSets, (updater: (m: ModeSets) => ModeSets) => void] {
  const [state, setState] = useState<ModeSets>(() => loadModeSets(key))
  useEffect(() => { saveModeSets(key, state) }, [key, state])
  return [state, setState]
}

function FullCard({
  item,
  onStopRun,
  onStopMany,
  onGoLive,
  href,
  stopping,
  labels,
  onMinimize,
}: {
  item: DisplayItem
  onStopRun: (run: PaperTradeRun) => void
  onStopMany: (runs: PaperTradeRun[], label: string) => void
  onGoLive?: (run: PaperTradeRun) => void
  href?: (run: PaperTradeRun) => string
  stopping: boolean
  labels: Labels
  onMinimize: () => void
}) {
  const buckets: [string, number | null][] = [
    ["1h", item.pnl.h1], ["3h", item.pnl.h3], ["6h", item.pnl.h6], ["12h", item.pnl.h12],
    ["24h", item.pnl.h24], ["1w", item.pnl.week], ["1M", item.pnl.month],
    ["All time", item.pnl.total],
  ]
  const stop = () => (item.aggregate ? onStopMany(item.runs, item.title) : item.single && onStopRun(item.single))
  return (
    <div className="rounded-lg border bg-background overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 border-b bg-[var(--muted)]/30 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* A real anchor, not a click handler: the strategy page is somewhere
              you routinely want in a second tab while this one keeps polling.
              next/link still navigates client-side on a plain click, but
              middle-click, ctrl/cmd-click and "Open in new tab" now work. */}
          {href && item.single ? (
            <Link
              href={href(item.single)}
              className="font-semibold truncate hover:underline underline-offset-2"
            >
              {item.title}
            </Link>
          ) : (
            <span className="font-semibold truncate">{item.title}</span>
          )}
          <span className="text-sm text-[var(--muted-foreground)]">
            {item.aggregate ? `${item.runCount} ${labels.runsSuffix}` : item.symbol ?? "—"}
          </span>
          {item.strategyBadge && <Badge variant="secondary" className="text-xs shrink-0">{item.strategyBadge}</Badge>}
          {item.position && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs shrink-0 capitalize",
                item.position === "long"
                  ? "border-emerald-500/40 text-emerald-500"
                  : item.position === "short"
                    ? "border-red-500/40 text-red-500"
                    : "border-amber-500/40 text-amber-500",
              )}
            >
              {item.position === "mixed" ? labels.mixed : item.position}
            </Badge>
          )}
          <span className="text-xs text-[var(--muted-foreground)] shrink-0 tabular-nums">
            {item.n_trades.toLocaleString("en-US")} {labels.trades}
            {item.openCount > 0 ? ` · ${item.openCount} ${labels.open}` : ""}
          </span>
        </div>
        <span className="text-xs text-[var(--muted-foreground)] tabular-nums shrink-0">
          {labels.uptime} {formatUptime(item.uptime_s)}
        </span>
      </div>

      {/* Body */}
      <div className="flex items-start gap-3 p-3">
        <div className="flex flex-col items-center justify-center gap-0.5 rounded-md border size-32 shrink-0">
          <span className={cn("text-3xl font-semibold tabular-nums", pnlColor(item.pnl.total))}>
            {fmtPnl(item.pnl.total)}
          </span>
          <span className={cn("text-sm tabular-nums", pnlColor(item.pnl.total))}>
            {fmtPct(item.pnl.total, item.initial_capital)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {buckets.map(([label, v]) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <div className="flex flex-col items-center justify-center rounded-md border size-16">
                  <span className={cn("text-xs font-medium tabular-nums", pnlColor(v))}>{fmtPnl(v)}</span>
                  <span className={cn("text-[9px] tabular-nums", pnlColor(v))}>{fmtPct(v, item.initial_capital)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* Run ID (single) or run count (aggregate) + controls */}
        <div className="ml-auto flex items-stretch gap-3 shrink-0">
          <div className="flex flex-col items-end justify-center max-w-[9rem]">
            {item.aggregate ? (
              <>
                <span className="text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]/70">{labels.runsSuffix}</span>
                <span className="text-sm font-mono text-[var(--muted-foreground)] tabular-nums">{item.runCount}</span>
              </>
            ) : (
              <>
                <span className="text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]/70">ID</span>
                <span className="text-[10px] font-mono text-[var(--muted-foreground)] break-all text-right leading-tight select-all" title={item.single?.id}>
                  {item.single?.id}
                </span>
              </>
            )}
          </div>
          {/* Top → bottom: Minimize, Go Live, Stop — with a bit more vertical air. */}
          <div className="flex flex-col items-center justify-between self-stretch min-h-36 py-0.5">
            <button
              onClick={onMinimize}
              aria-label="Minimize"
              title="Minimize"
              className="text-[var(--muted-foreground)] hover:text-foreground transition-colors cursor-pointer"
            >
              <Minimize size={16} animateOnHover />
            </button>
            {/* Go Live — carry this single strategy onto the live (testnet) page.
                Aggregate cards have no single template, so it's shown only for runs. */}
            {onGoLive && item.single && (
              <button
                onClick={() => onGoLive(item.single!)}
                aria-label={labels.goLive}
                title={labels.goLive}
                className="text-[var(--muted-foreground)] hover:text-emerald-500 transition-colors cursor-pointer"
              >
                <Radio className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={stop}
              disabled={stopping}
              aria-label={labels.stop}
              title={labels.stop}
              className="text-[var(--muted-foreground)] hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Square className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {item.error && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          {item.error}
        </div>
      )}
    </div>
  )
}

// Collapsed tile: title + coin/run-count + the P/L figure. Click to expand.
function CompactCard({
  item,
  labels,
  onExpand,
}: {
  item: DisplayItem
  labels: Labels
  onExpand: () => void
}) {
  return (
    <button
      onClick={onExpand}
      className="flex flex-col gap-1.5 rounded-lg border bg-background p-3 text-left hover:border-[var(--foreground)]/30 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium text-sm truncate">{item.title}</span>
        <span className="text-xs text-[var(--muted-foreground)] shrink-0">
          {item.aggregate ? `${item.runCount} ${labels.runsSuffix}` : item.symbol ?? ""}
        </span>
        {item.position && (
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              item.position === "long" ? "bg-emerald-500" : item.position === "short" ? "bg-red-500" : "bg-amber-500",
            )}
          />
        )}
        <ChevronDown className="h-3.5 w-3.5 ml-auto shrink-0 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{labels.profitLoss}</span>
        <div className="flex flex-col items-end leading-tight">
          <span className={cn("text-lg font-semibold tabular-nums", pnlColor(item.pnl.total))}>
            {fmtPnl(item.pnl.total)}
          </span>
          <span className={cn("text-[10px] tabular-nums", pnlColor(item.pnl.total))}>
            {fmtPct(item.pnl.total, item.initial_capital)}
          </span>
        </div>
      </div>
    </button>
  )
}
