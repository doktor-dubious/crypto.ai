"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import {
  addMonths, subMonths, addYears, subYears,
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isToday, isBefore, isAfter,
  differenceInCalendarDays, format, parseISO,
} from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { coinsApi, klinesApi, klineSimulationsApi, klineStrategiesApi, orchestrationsApi, tasksApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Strategy options ───────────────────────────────────────────────────────
// Volatility-aware trading is selected live on the Backtest tab, not here — the
// forecast run is identical for these, so they only differ at backtest time.
const STRATEGY_OPTIONS = [
  { value: "price", label: "Price" },
  { value: "kline", label: "Kline" },
] as const

function strategyLabel(v: string | null | undefined) {
  return STRATEGY_OPTIONS.find((s) => s.value === v)?.label ?? (v || "—")
}

// Inline placeholders usable in the simulation Name; expanded per run (works for
// batch too). See `expandName`.
const NAME_PLACEHOLDERS = [
  { token: "[COIN]", desc: "coin" },
  { token: "[PAIR]", desc: "trading pair" },
  { token: "[TIMEFRAME]", desc: "timeframe" },
  { token: "[STRATEGY]", desc: "strategy" },
  { token: "[DATES]", desc: "from – to" },
] as const

// A Simulation-Strategy selection can be either a kline strategy (its id) or a
// ready orchestration group, encoded as `orch:<group_id>`.
function isOrchValue(v: string | null | undefined): v is string {
  return !!v && v.startsWith("orch:")
}

// Order timeframes by real duration (shortest first), e.g. 5m, 15m, 1h, 4h, 1d.
const INTERVAL_UNIT_MIN: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080, M: 43200 }
function intervalMinutes(s: string): number {
  const m = /^(\d+)\s*([mhdwM])$/.exec(s.trim())
  return m ? parseInt(m[1], 10) * (INTERVAL_UNIT_MIN[m[2]] ?? 1) : Number.MAX_SAFE_INTEGER
}

// ─── Inline calendar (mirrors the gorm New Simulation date-range design) ──────
const YEARS = Array.from({ length: 13 }, (_, i) => 2019 + i)

function MiniCalendar({
  selected, onSelect, minDate, maxDate, disabled,
}: {
  selected: Date | undefined
  onSelect: (d: Date) => void
  minDate?: Date
  maxDate?: Date
  disabled?: boolean
}) {
  const [view, setView] = useState<Date>(selected ?? new Date())
  const [yearPickerOpen, setYearPickerOpen] = useState(false)

  const monthStart = startOfMonth(view)
  const days = eachDayOfInterval({ start: monthStart, end: endOfMonth(view) })
  const startPad = (getDay(monthStart) + 6) % 7 // Monday-first

  function setYear(y: number) {
    setView(new Date(y, view.getMonth(), 1))
    setYearPickerOpen(false)
  }

  return (
    <div className={cn("select-none w-full", disabled && "opacity-40 pointer-events-none")}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-0.5">
          <button onClick={() => setView(subYears(view, 1))} className="p-1 rounded hover:bg-[var(--muted)] transition-colors cursor-pointer" title="Previous year">
            <ChevronLeft className="h-3 w-3 opacity-60" />
          </button>
          <button onClick={() => setView(subMonths(view, 1))} className="p-1 rounded hover:bg-[var(--muted)] transition-colors cursor-pointer" title="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="relative">
          <button
            onClick={() => setYearPickerOpen((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium hover:text-[var(--muted-foreground)] transition-colors cursor-pointer px-1 rounded"
          >
            {format(view, "MMMM yyyy")}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
          {yearPickerOpen && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 rounded-md border border-[var(--border)] bg-[var(--popover,var(--background))] shadow-lg py-1 max-h-48 overflow-y-auto w-24">
              {YEARS.map((y) => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={cn(
                    "w-full text-center text-xs px-2 py-1.5 hover:bg-[var(--muted)] transition-colors cursor-pointer",
                    y === view.getFullYear() && "font-semibold text-foreground",
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <button onClick={() => setView(addMonths(view, 1))} className="p-1 rounded hover:bg-[var(--muted)] transition-colors cursor-pointer" title="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={() => setView(addYears(view, 1))} className="p-1 rounded hover:bg-[var(--muted)] transition-colors cursor-pointer" title="Next year">
            <ChevronRight className="h-3 w-3 opacity-60" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} className="text-center text-xs text-[var(--muted-foreground)] font-medium py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: startPad }).map((_, i) => <div key={`p${i}`} />)}
        {days.map((day) => {
          const isSelected = selected && isSameDay(day, selected)
          const isOff =
            (minDate != null && isBefore(day, minDate)) ||
            (maxDate != null && isAfter(day, maxDate))
          const today = isToday(day)
          return (
            <button
              key={day.toISOString()}
              disabled={!!isOff}
              onClick={() => onSelect(day)}
              className={cn(
                "text-xs rounded py-1.5 transition-colors text-center cursor-pointer",
                isSelected ? "bg-primary text-primary-foreground font-semibold"
                  : today ? "ring-1 ring-foreground/40"
                  : "hover:bg-[var(--muted)]",
                isOff && "opacity-25 cursor-not-allowed",
              )}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepCircle({ n, active }: { n: number; active: boolean }) {
  return (
    <div className={cn(
      "h-10 w-10 rounded-full border-2 bg-background flex items-center justify-center text-sm font-semibold shrink-0 transition-colors",
      active ? "border-primary text-foreground" : "border-[var(--border)] text-[var(--muted-foreground)]",
    )}>
      {n}
    </div>
  )
}

// A labelled checkbox grid for one batch dimension (coins / pairs / etc.).
function CheckboxRegion({
  label, items, selected, onToggle, empty,
}: {
  label: string
  items: { value: string; label: string; disabled?: boolean }[]
  selected: Set<string>
  onToggle: (v: string) => void
  empty: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--muted-foreground)]">{label}</label>
        {selected.size > 0 && (
          <span className="text-xs text-[var(--muted-foreground)] tabular-nums">{selected.size} selected</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">{empty}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto rounded-md border border-input p-2">
          {items.map((it) => (
            <label
              key={it.value}
              className={cn(
                "flex items-center gap-2 text-sm select-none",
                it.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
              )}
            >
              <Checkbox
                checked={selected.has(it.value)}
                disabled={it.disabled}
                onCheckedChange={() => !it.disabled && onToggle(it.value)}
              />
              <span className="truncate">{it.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

const SELECT_CLASS = "h-9 w-72 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
const FORM_KEY = "crypt:newSimForm"
const DEFAULT_START = new Date(2025, 0, 1)   // 2025-01-01
const DEFAULT_END = new Date(2025, 11, 31)   // 2025-12-31

function clampDate(d: Date, lo?: Date, hi?: Date): Date {
  if (lo && isBefore(d, lo)) return lo
  if (hi && isAfter(d, hi)) return hi
  return d
}

export default function NewSimulationPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [coinId, setCoinId] = useState<string | null>(null)
  const [quoteAsset, setQuoteAsset] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<string | null>(null)
  // Either a kline strategy id or `orch:<group_id>` for a ready orchestration group.
  const [strategyId, setStrategyId] = useState<string | null>(null)
  // Worker is ephemeral (depends on live availability), so not persisted.
  const [worker, setWorker] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<Date | undefined>(DEFAULT_START)
  const [endDate, setEndDate] = useState<Date | undefined>(DEFAULT_END)

  const [activeTab, setActiveTab] = useState<"simulation" | "parameters" | "batch">("simulation")
  // Batch tab: multi-select each dimension; the run is their cartesian product.
  const [batchCoins, setBatchCoins] = useState<Set<string>>(new Set())
  const [batchPairs, setBatchPairs] = useState<Set<string>>(new Set())
  const [batchTfs, setBatchTfs] = useState<Set<string>>(new Set())
  const [batchStrategies, setBatchStrategies] = useState<Set<string>>(new Set())

  // Persist the whole form so it survives a refresh or navigating away and back.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FORM_KEY)
      if (raw) {
        const s = JSON.parse(raw)
        if (s.name != null) setName(s.name)
        if (s.description != null) setDescription(s.description)
        if (s.coinId != null) setCoinId(s.coinId)
        if (s.quoteAsset != null) setQuoteAsset(s.quoteAsset)
        if (s.timeframe != null) setTimeframe(s.timeframe)
        if (s.strategyId != null) setStrategyId(s.strategyId)
        if (s.startDate) setStartDate(new Date(s.startDate))
        if (s.endDate) setEndDate(new Date(s.endDate))
      }
    } catch { /* ignore malformed storage */ }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify({
        name, description, coinId, quoteAsset, timeframe, strategyId,
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
      }))
    } catch { /* quota / unavailable — ignore */ }
  }, [loaded, name, description, coinId, quoteAsset, timeframe, strategyId, startDate, endDate])

  const { data: coins = [] } = useQuery({ queryKey: ["coins"], queryFn: () => coinsApi.list({ limit: 1000 }) })
  const { data: pairsResp } = useQuery({
    queryKey: ["simFormPairs", coinId],
    queryFn: () => klinesApi.getTradingPairs(coinId!),
    enabled: !!coinId,
  })
  const pairs = pairsResp?.pairs ?? []
  const { data: tfResp } = useQuery({
    queryKey: ["simFormTfs", coinId, quoteAsset],
    queryFn: () => klinesApi.getTimeframes(coinId!, quoteAsset!),
    enabled: !!coinId && !!quoteAsset,
  })
  const timeframes = [...(tfResp?.timeframes ?? [])].sort((a, b) => intervalMinutes(a) - intervalMinutes(b))
  const { data: rangeResp } = useQuery({
    queryKey: ["simFormRange", coinId, quoteAsset, timeframe],
    queryFn: () => klinesApi.getDateRange(coinId!, quoteAsset!, timeframe!),
    enabled: !!coinId && !!quoteAsset && !!timeframe,
  })
  const dataMin = rangeResp?.start_date ? parseISO(rangeResp.start_date) : undefined
  const dataMax = rangeResp?.end_date ? parseISO(rangeResp.end_date) : undefined

  // Once the data range loads, clamp the selected dates into [first, last] so the
  // defaults (or a stale selection from another pair) stay valid.
  useEffect(() => {
    if (!rangeResp?.start_date || !rangeResp?.end_date) return
    const lo = parseISO(rangeResp.start_date)
    const hi = parseISO(rangeResp.end_date)
    setStartDate((d) => (d ? clampDate(d, lo, hi) : d))
    setEndDate((d) => (d ? clampDate(d, lo, hi) : d))
  }, [rangeResp?.start_date, rangeResp?.end_date])
  const { data: strategies = [] } = useQuery({ queryKey: ["klineStrategies"], queryFn: () => klineStrategiesApi.list() })

  // Orchestration groups appear in the Simulation Strategy dropdown — only ready
  // ones are runnable, encoded as `orch:<group_id>`.
  const { data: orchGroups = [] } = useQuery({ queryKey: ["orchestration-groups"], queryFn: () => orchestrationsApi.list() })
  const readyGroups = useMemo(() => orchGroups.filter((g) => g.status === "ready"), [orchGroups])

  // Resolve the current selection to either a strategy or an orchestration group.
  const selectedStrategy = !isOrchValue(strategyId)
    ? (strategies.find((s) => s.id === strategyId) ?? null)
    : null
  const selectedGroup = isOrchValue(strategyId)
    ? (readyGroups.find((g) => `orch:${g.id}` === strategyId) ?? null)
    : null
  // Drop the selection if it points at a group that's gone or no longer ready.
  useEffect(() => {
    if (isOrchValue(strategyId) && !readyGroups.some((g) => `orch:${g.id}` === strategyId)) {
      setStrategyId(null)
    }
  }, [strategyId, readyGroups])
  const { data: strategyParams = [] } = useQuery({
    queryKey: ["klineStrategyParams", strategyId],
    queryFn: () => klineStrategiesApi.listParameters(strategyId!),
    enabled: !!strategyId && !isOrchValue(strategyId),
  })
  const selectedParams = strategyParams.filter((p) => p.selected)

  // Available workers (local + remote), filtered to those that support the
  // strategy's forecast engine. A worker advertising no models accepts anything.
  const { data: allWorkers = [] } = useQuery({
    queryKey: ["workers"],
    queryFn: () => tasksApi.listWorkers(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
  const neededSlug = selectedStrategy?.forecast_engine ?? null
  const workers = allWorkers.filter((w) => {
    if (w.models.length === 0) return true
    if (!neededSlug) return true
    return w.models.includes(neededSlug)
  })
  // Drop the selection if the chosen worker is no longer available/eligible.
  useEffect(() => {
    if (worker && !workers.some((w) => w.name === worker)) setWorker(null)
  }, [worker, workers])

  const selectedCoin = coins.find((c) => c.id === coinId)
  const dayCount = startDate && endDate ? differenceInCalendarDays(endDate, startDate) + 1 : null

  // Expand inline name placeholders against one run's concrete parameters, so a
  // single template name works for both single and batch runs. Case-insensitive.
  function expandName(
    template: string,
    ctx: { coinSymbol: string; quoteAsset: string; interval: string; strategyName: string },
  ): string {
    const dates = startDate && endDate
      ? `${format(startDate, "yyyy.MM.dd")} - ${format(endDate, "yyyy.MM.dd")}`
      : ""
    return template
      .replace(/\[coin\]/gi, ctx.coinSymbol)
      .replace(/\[pair\]/gi, `${ctx.coinSymbol}${ctx.quoteAsset}`)
      .replace(/\[timeframe\]/gi, ctx.interval)
      .replace(/\[strategy\]/gi, ctx.strategyName)
      .replace(/\[dates\]/gi, dates)
      .trim()
  }

  // Build a create payload for one (coin, pair, interval, strategy-selection). The
  // selection is either a strategy id or `orch:<group_id>`. Shared by the single
  // run and the batch run.
  function payloadFor(opts: {
    coinId: string; quoteAsset: string; interval: string; sel: string
    name?: string | null; params?: Record<string, string>
  }) {
    const coinSymbol = coins.find((c) => c.id === opts.coinId)?.symbol ?? ""
    const strategyName = isOrchValue(opts.sel)
      ? (readyGroups.find((g) => `orch:${g.id}` === opts.sel)?.name ?? "")
      : (strategies.find((s) => s.id === opts.sel)?.name ?? "")
    const rawName = (opts.name ?? "").trim()
    const expandedName = rawName
      ? expandName(rawName, {
          coinSymbol, quoteAsset: opts.quoteAsset, interval: opts.interval, strategyName,
        }) || null
      : null
    const base = {
      coin_id: opts.coinId,
      quote_asset: opts.quoteAsset,
      interval: opts.interval,
      start_date: format(startDate!, "yyyy-MM-dd"),
      end_date: format(endDate!, "yyyy-MM-dd"),
      name: expandedName,
      description: description.trim() || null,
      worker: worker || undefined,
    }
    if (isOrchValue(opts.sel)) {
      const grp = readyGroups.find((g) => `orch:${g.id}` === opts.sel)
      return {
        ...base,
        models: [opts.sel],
        strategy: "price",
        forecast_vol: false,
        config: grp ? { orchestration_group_id: grp.id, orchestration_group_name: grp.name } : null,
      }
    }
    const strat = strategies.find((s) => s.id === opts.sel)!
    return {
      ...base,
      models: [strat.forecast_engine!],
      strategy: strat.simulation_strategy,
      forecast_vol: strat.forecast_vol,
      horizon: strat.horizon || 1,
      covariate_mode: strat.covariate_mode || "off",
      config: { strategy_id: strat.id, strategy_name: strat.name, parameters: opts.params ?? {} },
    }
  }

  const createMutation = useMutation({
    mutationFn: () => klineSimulationsApi.create(payloadFor({
      coinId: coinId!, quoteAsset: quoteAsset!, interval: timeframe!, sel: strategyId!,
      name,
      params: Object.fromEntries(selectedParams.map((p) => [p.name, p.value])),
    })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["klineSimulations"] })
      // Keep the form persisted after a run so the user can return and tweak a
      // selection to launch a variation; "Clear" still wipes it explicitly.
      toast.success("Simulation queued")
      router.push("/simulations/completed")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start simulation"),
  })

  // ── Batch tab: multi-select dimensions, run their cartesian product ─────────
  const toggleIn = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>, v: string,
  ) => setter((prev) => {
    const n = new Set(prev)
    if (n.has(v)) n.delete(v); else n.add(v)
    return n
  })

  const batchCoinList = useMemo(() => [...batchCoins], [batchCoins])
  const batchPairQueries = useQueries({
    queries: batchCoinList.map((id) => ({
      queryKey: ["simFormPairs", id],
      queryFn: () => klinesApi.getTradingPairs(id),
      enabled: !!id,
    })),
  })
  const batchPairsKey = batchPairQueries.map((q) => (q.data?.pairs ?? []).join(",")).join("|")
  const batchAvailablePairs = useMemo(() => {
    const s = new Set<string>()
    for (const q of batchPairQueries) for (const p of q.data?.pairs ?? []) s.add(p)
    return [...s].sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchPairsKey])
  // Prune pair selections no longer offered by the chosen coins.
  useEffect(() => {
    setBatchPairs((prev) => {
      const next = new Set([...prev].filter((p) => batchAvailablePairs.includes(p)))
      return next.size === prev.size ? prev : next
    })
  }, [batchAvailablePairs])

  const batchComboList = useMemo(() => {
    const out: { coin: string; pair: string }[] = []
    for (const c of batchCoins) for (const p of batchPairs) out.push({ coin: c, pair: p })
    return out
  }, [batchCoins, batchPairs])
  const batchTfQueries = useQueries({
    queries: batchComboList.map(({ coin, pair }) => ({
      queryKey: ["simFormTfs", coin, pair],
      queryFn: () => klinesApi.getTimeframes(coin, pair),
      enabled: !!coin && !!pair,
    })),
  })
  const batchTfsKey = batchTfQueries.map((q) => (q.data?.timeframes ?? []).join(",")).join("|")
  const batchAvailableTfs = useMemo(() => {
    const s = new Set<string>()
    for (const q of batchTfQueries) for (const tf of q.data?.timeframes ?? []) s.add(tf)
    return [...s].sort((a, b) => intervalMinutes(a) - intervalMinutes(b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchTfsKey])
  useEffect(() => {
    setBatchTfs((prev) => {
      const next = new Set([...prev].filter((tf) => batchAvailableTfs.includes(tf)))
      return next.size === prev.size ? prev : next
    })
  }, [batchAvailableTfs])

  // Strategy dimension for the batch: kline strategies + ready orchestration groups.
  const batchStrategyOptions = useMemo(() => [
    ...strategies.map((s) => ({ value: s.id, label: s.name, disabled: !s.forecast_engine })),
    ...readyGroups.map((g) => ({ value: `orch:${g.id}`, label: `${g.name} (orchestration)`, disabled: false })),
  ], [strategies, readyGroups])

  const batchDims = [batchCoins.size, batchPairs.size, batchTfs.size, batchStrategies.size]
  const combinationCount = batchDims.some((n) => n > 0)
    ? batchDims.filter((n) => n > 0).reduce((a, b) => a * b, 1)
    : 0

  const batchMutation = useMutation({
    mutationFn: async () => {
      const combos: { coin: string; pair: string; tf: string; sel: string }[] = []
      for (const coin of batchCoins)
        for (const pair of batchPairs)
          for (const tf of batchTfs)
            for (const sel of batchStrategies) {
              // Skip strategies with no forecast engine — nothing to run.
              if (!isOrchValue(sel) && !strategies.find((s) => s.id === sel)?.forecast_engine) continue
              combos.push({ coin, pair, tf, sel })
            }
      if (combos.length === 0) throw new Error("No runnable combinations selected")
      const results = await Promise.allSettled(combos.map((c) => {
        // Use the Name template (expanded per combo in payloadFor). When it's
        // empty, fall back to an auto label so batch runs are still identifiable.
        const sym = coins.find((x) => x.id === c.coin)?.symbol ?? ""
        const label = isOrchValue(c.sel)
          ? (readyGroups.find((g) => `orch:${g.id}` === c.sel)?.name ?? "orchestration")
          : (strategies.find((s) => s.id === c.sel)?.name ?? "")
        const autoName = `${sym}${c.pair} ${c.tf} · ${label}`
        return klineSimulationsApi.create(payloadFor({
          coinId: c.coin, quoteAsset: c.pair, interval: c.tf, sel: c.sel,
          name: name.trim() ? name : autoName,
        }))
      }))
      const ok = results.filter((r) => r.status === "fulfilled").length
      return { ok, failed: results.length - ok }
    },
    onSuccess: ({ ok, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["klineSimulations"] })
      toast.success(`Queued ${ok} simulation${ok === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`)
      router.push("/simulations/completed")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start batch"),
  })

  function handleClear() {
    setName(""); setDescription(""); setCoinId(null); setQuoteAsset(null); setTimeframe(null)
    setStrategyId(null); setWorker(null)
    setStartDate(DEFAULT_START); setEndDate(DEFAULT_END)
  }

  function handleBatchClear() {
    setBatchCoins(new Set()); setBatchPairs(new Set()); setBatchTfs(new Set()); setBatchStrategies(new Set())
  }

  function handleStartSelect(d: Date) {
    setStartDate(d)
    if (endDate && isBefore(endDate, d)) setEndDate(undefined)
  }

  const strategyReady = isOrchValue(strategyId)
    ? !!selectedGroup
    : !!(selectedStrategy && selectedStrategy.forecast_engine)
  const valid = coinId && quoteAsset && timeframe && strategyReady
    && startDate && endDate && !isAfter(startDate, endDate)
  const batchValid = batchCoins.size > 0 && batchPairs.size > 0 && batchTfs.size > 0
    && batchStrategies.size > 0 && startDate && endDate && !isAfter(startDate, endDate)

  // Tab underline indicator.
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab])

  const TAB_CLASS = "bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"

  return (
    <div className="max-w-5xl px-6 py-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex flex-col gap-0">
        <div className="relative w-full mb-6">
          <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-[var(--border)] rounded-none p-0 h-auto flex">
            <TabsTrigger value="simulation" className={TAB_CLASS}>Simulation</TabsTrigger>
            <TabsTrigger value="parameters" className={TAB_CLASS}>Parameters</TabsTrigger>
            <TabsTrigger value="batch" className={TAB_CLASS}>Batch</TabsTrigger>
          </TabsList>
          <div
            className="absolute bottom-0 h-0.5 bg-foreground transition-all duration-300 ease-in-out z-0"
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        </div>

        <TabsContent value="simulation">
      <div className="flex flex-col gap-5">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sim [COIN] [PAIR] [TIMEFRAME] — [STRATEGY]" />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
            <span className="w-full">Placeholders (expand per run):</span>
            {NAME_PLACEHOLDERS.map((p) => (
              <span key={p.token} className="inline-flex items-center gap-1">
                <code className="rounded bg-[var(--muted)] px-1 py-0.5 font-mono text-[11px]">{p.token}</code>
                <span>{p.desc}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Description</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes about this simulation" rows={3} />
        </div>

        {/* Coin */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Coin</label>
          <select value={coinId ?? ""} onChange={(e) => { setCoinId(e.target.value || null); setQuoteAsset(null); setTimeframe(null) }} className={SELECT_CLASS}>
            <option value="">Select coin...</option>
            {coins.map((c) => <option key={c.id} value={c.id}>{c.symbol} — {c.name}</option>)}
          </select>
        </div>

        {/* Trading Pair */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Trading Pair</label>
          <select value={quoteAsset ?? ""} onChange={(e) => { setQuoteAsset(e.target.value || null); setTimeframe(null) }} disabled={!coinId} className={SELECT_CLASS}>
            <option value="">Select pair...</option>
            {pairs.map((p) => <option key={p} value={p}>{selectedCoin?.symbol}{p}</option>)}
          </select>
        </div>

        {/* Timeframe */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Timeframe</label>
          <select value={timeframe ?? ""} onChange={(e) => setTimeframe(e.target.value || null)} disabled={!quoteAsset} className={SELECT_CLASS}>
            <option value="">Select timeframe...</option>
            {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </div>

        {/* Simulation Strategy — kline strategies plus ready orchestration groups */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Simulation Strategy</label>
          <select value={strategyId ?? ""} onChange={(e) => setStrategyId(e.target.value || null)} className={SELECT_CLASS}>
            <option value="">{strategies.length === 0 && readyGroups.length === 0 ? "No strategies — create one first" : "Select strategy..."}</option>
            {strategies.length > 0 && (
              <optgroup label="Strategies">
                {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            )}
            {readyGroups.length > 0 && (
              <optgroup label="Model Orchestration">
                {readyGroups.map((g) => <option key={g.id} value={`orch:${g.id}`}>{g.name}</option>)}
              </optgroup>
            )}
          </select>
          {selectedStrategy && (
            <p className="text-xs text-[var(--muted-foreground)] max-w-2xl">
              {strategyLabel(selectedStrategy.simulation_strategy)} · engine:{" "}
              {selectedStrategy.forecast_engine
                ? <span className="font-mono">{selectedStrategy.forecast_engine}</span>
                : <span className="text-amber-500">none set</span>}
              {selectedStrategy.forecast_vol ? " · volatility forecast on" : ""}
              {selectedStrategy.horizon > 1 ? ` · horizon: ${selectedStrategy.horizon} bars` : ""}
              {selectedStrategy.covariate_mode && selectedStrategy.covariate_mode !== "off" ? ` · covariates: ${selectedStrategy.covariate_mode}` : ""}
              {selectedParams.length ? ` · ${selectedParams.length} parameter${selectedParams.length === 1 ? "" : "s"}` : ""}
            </p>
          )}
          {selectedStrategy && !selectedStrategy.forecast_engine && (
            <p className="text-xs text-amber-500 max-w-2xl">
              This strategy has no Forecast Engine set — choose one on the Strategies page before running.
            </p>
          )}
          {selectedGroup && (
            <p className="text-xs text-[var(--muted-foreground)] max-w-2xl">
              Model Orchestration · {Object.keys(selectedGroup.model_composition ?? {}).length} model{Object.keys(selectedGroup.model_composition ?? {}).length === 1 ? "" : "s"} · runs the calibrated blend
            </p>
          )}
        </div>

        {/* Worker */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Worker</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-9 w-72 px-3 rounded-md border border-input bg-background text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span className={cn((!worker || (!!neededSlug && workers.length === 0)) && "text-[var(--muted-foreground)]")}>
                  {neededSlug && workers.length === 0 ? "No worker for chosen model" : (worker ?? "Any available worker")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuItem onClick={() => setWorker(null)} className="flex items-center justify-between">
                <span className="text-[var(--muted-foreground)]">Any available worker</span>
                {worker === null && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
              </DropdownMenuItem>
              {workers.map((w) => (
                <DropdownMenuItem key={w.name} onClick={() => setWorker(w.name)} className="flex items-center justify-between">
                  <span>{w.name}{w.gpu_name ? <span className="text-[var(--muted-foreground)] ml-1.5 font-mono text-xs">{w.gpu_name}</span> : null}</span>
                  {worker === w.name && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {neededSlug && workers.length === 0 ? (
            <p className="text-xs text-amber-500">
              No worker for the chosen model (<span className="font-mono">{neededSlug}</span>) is online — it can’t run until a worker that supports it is started.
            </p>
          ) : workers.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">
              No workers registered — the task will run on any available worker.
            </p>
          ) : null}
        </div>

        {/* Date Range timeline */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Date Range</label>
          <div className="relative mt-2">
            <div className="absolute top-5 left-1/4 right-1/4 h-px bg-[var(--border)] z-0" />
            <div className="grid grid-cols-2 gap-8">
              {/* Start */}
              <div className="flex flex-col items-center gap-3 relative z-10">
                <StepCircle n={1} active={!!startDate} />
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <span className="text-sm font-medium">Start Date</span>
                  <span className="text-xs text-[var(--muted-foreground)] h-4">
                    {startDate ? format(startDate, "d MMM yyyy") : "No date selected"}
                  </span>
                </div>
                <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card,var(--background))] p-4">
                  <MiniCalendar selected={startDate} onSelect={handleStartSelect} minDate={dataMin} maxDate={endDate ?? dataMax} />
                </div>
              </div>
              {/* End */}
              <div className="flex flex-col items-center gap-3 relative z-10">
                <StepCircle n={2} active={!!endDate} />
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <span className="text-sm font-medium">End Date</span>
                  <span className="text-xs text-[var(--muted-foreground)] h-4">
                    {endDate ? format(endDate, "d MMM yyyy") : "No date selected"}
                  </span>
                </div>
                <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card,var(--background))] p-4">
                  <MiniCalendar selected={endDate} onSelect={setEndDate} minDate={startDate ?? dataMin} maxDate={dataMax} disabled={!startDate} />
                </div>
              </div>
            </div>
            {dayCount !== null && (
              <div className="absolute top-[4.25rem] left-1/2 -translate-x-1/2 z-20 bg-background px-2">
                <span className="text-xs text-[var(--muted-foreground)]">{dayCount.toLocaleString()} days</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleClear} className="cursor-pointer">Clear</Button>
          <Button size="sm" onClick={() => createMutation.mutate()} disabled={!valid || createMutation.isPending} className="cursor-pointer">
            {createMutation.isPending ? "Starting…" : "Run Simulation"}
          </Button>
        </div>
      </div>
        </TabsContent>

        {/* Parameters — placeholder for now. */}
        <TabsContent value="parameters">
          <div className="flex items-center justify-center h-40 text-sm text-[var(--muted-foreground)]">
            No parameters yet.
          </div>
        </TabsContent>

        {/* Batch — run the cartesian product of the selected dimensions. */}
        <TabsContent value="batch">
          <div className="flex flex-col gap-5">
            {/* Combination count */}
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">Combination Count:</span>
              <span className="text-lg font-semibold tabular-nums">{combinationCount.toLocaleString()}</span>
            </div>

            <CheckboxRegion
              label="Coins"
              items={coins.map((c) => ({ value: c.id, label: c.symbol }))}
              selected={batchCoins}
              onToggle={(v) => toggleIn(setBatchCoins, v)}
              empty="No coins available."
            />

            <CheckboxRegion
              label="Trading Pairs"
              items={batchAvailablePairs.map((p) => ({ value: p, label: p }))}
              selected={batchPairs}
              onToggle={(v) => toggleIn(setBatchPairs, v)}
              empty={batchCoins.size === 0 ? "Select coins first." : "No trading pairs for the selected coins."}
            />

            <CheckboxRegion
              label="Timeframes"
              items={batchAvailableTfs.map((tf) => ({ value: tf, label: tf }))}
              selected={batchTfs}
              onToggle={(v) => toggleIn(setBatchTfs, v)}
              empty={batchPairs.size === 0 ? "Select trading pairs first." : "No timeframes for the selection."}
            />

            <CheckboxRegion
              label="Simulation Strategies"
              items={batchStrategyOptions}
              selected={batchStrategies}
              onToggle={(v) => toggleIn(setBatchStrategies, v)}
              empty="No strategies — create one first."
            />

            <p className="text-xs text-[var(--muted-foreground)] max-w-2xl">
              Each simulation uses the date range set on the Simulation tab
              ({startDate ? format(startDate, "d MMM yyyy") : "—"} – {endDate ? format(endDate, "d MMM yyyy") : "—"}).
              Every selected combination is queued as its own run.
            </p>

            {/* Batch actions */}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleBatchClear} className="cursor-pointer">Cancel</Button>
              <Button
                size="sm"
                onClick={() => batchMutation.mutate()}
                disabled={!batchValid || batchMutation.isPending}
                className="cursor-pointer"
              >
                {batchMutation.isPending ? "Starting…" : `Run Simulation Batch${combinationCount > 0 ? ` (${combinationCount})` : ""}`}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
