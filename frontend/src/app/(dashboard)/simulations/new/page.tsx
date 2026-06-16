"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  addMonths, subMonths, addYears, subYears,
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isToday, isBefore, isAfter,
  differenceInCalendarDays, format, parseISO,
} from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { coinsApi, klinesApi, klineSimulationsApi, klineStrategiesApi, tasksApi } from "@/lib/api"
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
  const [strategyId, setStrategyId] = useState<string | null>(null)
  // Worker is ephemeral (depends on live availability), so not persisted.
  const [worker, setWorker] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<Date | undefined>(DEFAULT_START)
  const [endDate, setEndDate] = useState<Date | undefined>(DEFAULT_END)

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
  const selectedStrategy = strategies.find((s) => s.id === strategyId) ?? null
  const { data: strategyParams = [] } = useQuery({
    queryKey: ["klineStrategyParams", strategyId],
    queryFn: () => klineStrategiesApi.listParameters(strategyId!),
    enabled: !!strategyId,
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

  const createMutation = useMutation({
    mutationFn: () => klineSimulationsApi.create({
      coin_id: coinId!,
      quote_asset: quoteAsset!,
      interval: timeframe!,
      start_date: format(startDate!, "yyyy-MM-dd"),
      end_date: format(endDate!, "yyyy-MM-dd"),
      models: [selectedStrategy!.forecast_engine!],
      name: name.trim() || null,
      description: description.trim() || null,
      strategy: selectedStrategy!.simulation_strategy,
      forecast_vol: selectedStrategy!.forecast_vol,
      worker: worker || undefined,
      config: {
        strategy_id: selectedStrategy!.id,
        strategy_name: selectedStrategy!.name,
        parameters: Object.fromEntries(selectedParams.map((p) => [p.name, p.value])),
      },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["klineSimulations"] })
      // Keep the form persisted after a run so the user can return and tweak a
      // selection to launch a variation; "Clear" still wipes it explicitly.
      toast.success("Simulation queued")
      router.push("/simulations/completed")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start simulation"),
  })

  function handleClear() {
    setName(""); setDescription(""); setCoinId(null); setQuoteAsset(null); setTimeframe(null)
    setStrategyId(null); setWorker(null)
    setStartDate(DEFAULT_START); setEndDate(DEFAULT_END)
  }

  function handleStartSelect(d: Date) {
    setStartDate(d)
    if (endDate && isBefore(endDate, d)) setEndDate(undefined)
  }

  const valid = coinId && quoteAsset && timeframe && strategyId && selectedStrategy?.forecast_engine
    && startDate && endDate && !isAfter(startDate, endDate)

  return (
    <div className="max-w-5xl px-6 py-6">
      <h1 className="text-lg font-semibold mb-6">New Simulation</h1>

      <div className="flex flex-col gap-5">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BTC 2025 Volatility Test" />
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

        {/* Simulation Strategy (preset) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Simulation Strategy</label>
          <select value={strategyId ?? ""} onChange={(e) => setStrategyId(e.target.value || null)} className={SELECT_CLASS}>
            <option value="">{strategies.length === 0 ? "No strategies — create one first" : "Select strategy..."}</option>
            {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {selectedStrategy && (
            <p className="text-xs text-[var(--muted-foreground)] max-w-2xl">
              {strategyLabel(selectedStrategy.simulation_strategy)} · engine:{" "}
              {selectedStrategy.forecast_engine
                ? <span className="font-mono">{selectedStrategy.forecast_engine}</span>
                : <span className="text-amber-500">none set</span>}
              {selectedStrategy.forecast_vol ? " · volatility forecast on" : ""}
              {selectedParams.length ? ` · ${selectedParams.length} parameter${selectedParams.length === 1 ? "" : "s"}` : ""}
            </p>
          )}
          {selectedStrategy && !selectedStrategy.forecast_engine && (
            <p className="text-xs text-amber-500 max-w-2xl">
              This strategy has no Forecast Engine set — choose one on the Strategies page before running.
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
    </div>
  )
}
