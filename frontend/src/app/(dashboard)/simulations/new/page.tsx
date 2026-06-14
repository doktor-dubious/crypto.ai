"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import {
  addMonths, subMonths, addYears, subYears,
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isToday, isBefore, isAfter,
  differenceInCalendarDays, format,
} from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { coinsApi, klinesApi, klineSimulationsApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Strategy options ───────────────────────────────────────────────────────
// Volatility-aware trading is selected live on the Backtest tab, not here — the
// forecast run is identical for these, so they only differ at backtest time.
const STRATEGY_OPTIONS = [
  { value: "price", label: "Price" },
  { value: "kline", label: "Kline" },
] as const

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

export default function NewSimulationPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [coinId, setCoinId] = useState<string | null>(null)
  const [quoteAsset, setQuoteAsset] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<string | null>(null)
  const [strategy, setStrategy] = useState<string>("price")
  const [engine, setEngine] = useState<string>("")
  const [forecastVol, setForecastVol] = useState(false)
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)

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
        if (s.strategy != null) setStrategy(s.strategy)
        if (s.engine != null) setEngine(s.engine)
        if (s.forecastVol != null) setForecastVol(s.forecastVol)
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
        name, description, coinId, quoteAsset, timeframe, strategy, engine, forecastVol,
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
      }))
    } catch { /* quota / unavailable — ignore */ }
  }, [loaded, name, description, coinId, quoteAsset, timeframe, strategy, engine, forecastVol, startDate, endDate])

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
  const timeframes = tfResp?.timeframes ?? []
  const { data: engines = [] } = useQuery({ queryKey: ["predictionEngines"], queryFn: () => klinesApi.getEngines() })

  const selectedCoin = coins.find((c) => c.id === coinId)
  const dayCount = startDate && endDate ? differenceInCalendarDays(endDate, startDate) + 1 : null

  const createMutation = useMutation({
    mutationFn: () => klineSimulationsApi.create({
      coin_id: coinId!,
      quote_asset: quoteAsset!,
      interval: timeframe!,
      start_date: format(startDate!, "yyyy-MM-dd"),
      end_date: format(endDate!, "yyyy-MM-dd"),
      models: [engine],
      name: name.trim() || null,
      description: description.trim() || null,
      strategy,
      forecast_vol: forecastVol,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["klineSimulations"] })
      // Keep the form persisted after a run so the user can return and tweak a
      // selection to launch a variation; "Clear" still wipes it explicitly.
      toast.success("Simulation queued")
      router.push("/simulations")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start simulation"),
  })

  function handleClear() {
    setName(""); setDescription(""); setCoinId(null); setQuoteAsset(null); setTimeframe(null)
    setStrategy("price"); setEngine(""); setForecastVol(false)
    setStartDate(undefined); setEndDate(undefined)
  }

  function handleStartSelect(d: Date) {
    setStartDate(d)
    if (endDate && isBefore(endDate, d)) setEndDate(undefined)
  }

  const valid = coinId && quoteAsset && timeframe && engine && startDate && endDate
    && !isAfter(startDate, endDate)

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

        {/* Simulation Strategy */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Simulation Strategy</label>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className={SELECT_CLASS}>
            {STRATEGY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {strategy === "kline" && (
            <p className="text-xs text-[var(--muted-foreground)] max-w-2xl">
              Forecasts the chart&apos;s <em>shape</em>: each bar becomes 1 (close up vs the previous bar) or 0, giving a sequence like 0011010111… The model predicts whether the next symbol is a 1 or 0. Direction accuracy and the fee-aware backtest apply; price-error metrics (MAE/MAPE) don&apos;t.
            </p>
          )}
        </div>

        {/* Forecast Engine */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Forecast Engine</label>
          <select value={engine} onChange={(e) => setEngine(e.target.value)} className={SELECT_CLASS}>
            <option value="">{engines.length === 0 ? "Loading engines..." : "Select engine..."}</option>
            {engines.map((eng) => <option key={eng.name} value={eng.name}>{eng.name}</option>)}
          </select>
        </div>

        {/* Volatility forecast */}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 cursor-pointer max-w-2xl">
            <Checkbox checked={forecastVol} onCheckedChange={(c) => setForecastVol(!!c)} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Forecast volatility</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                Also run a second one-step forecast of realized volatility (the bar&apos;s ln(high/low) range), so the Backtest tab&apos;s vol-targeting / vol-breakout strategies can use a genuine volatility forecast instead of the price band width. Roughly doubles run time.
              </span>
            </span>
          </label>
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
                  <MiniCalendar selected={startDate} onSelect={handleStartSelect} maxDate={endDate} />
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
                  <MiniCalendar selected={endDate} onSelect={setEndDate} minDate={startDate} disabled={!startDate} />
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
