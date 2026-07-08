"use client"

import { useState, useMemo, useEffect, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  addMonths, subMonths, addYears, subYears,
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isToday, isBefore, isAfter,
  differenceInCalendarDays, format, parseISO,
} from "date-fns"
import {
  ChevronDown, ChevronLeft, ChevronRight, Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  predictionEnginesApi, coinsApi, klinesApi, finetuneApi, tasksApi,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// Order timeframes by real duration (shortest first), e.g. 5m, 15m, 1h, 4h, 1d.
const INTERVAL_UNIT_MIN: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080, M: 43200 }
function intervalMinutes(s: string): number {
  const m = /^(\d+)\s*([mhdwM])$/.exec(s.trim())
  return m ? parseInt(m[1], 10) * (INTERVAL_UNIT_MIN[m[2]] ?? 1) : Number.MAX_SAFE_INTEGER
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORAGE_PREFIX = "gorm:aiModels:"

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value))
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[var(--muted-foreground)]">{label}</label>
      {children}
    </div>
  )
}

// ─── Inline calendar ──────────────────────────────────────────────────────────

const YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i)

function MiniCalendar({
  selected,
  onSelect,
  minDate,
  maxDate,
  disabled,
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
  const startPad = (getDay(monthStart) + 6) % 7

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
                    y === view.getFullYear() && "font-semibold text-white",
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
                isSelected ? "bg-white text-black font-semibold"
                  : today ? "ring-1 ring-white/50"
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
      active ? "border-white text-white" : "border-[var(--border)] text-[var(--muted-foreground)]",
    )}>
      {n}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIModelFinetunePage() {
  const t = useTranslations("aiModels")
  const queryClient = useQueryClient()

  // ── Engine selection
  const [selectedEngineId, setSelectedEngineId] = useState<string | null>(
    () => loadJson<string | null>("ftEngineId", null),
  )

  // ── Name and description
  const [ftName, setFtName] = useState<string>(() => loadJson<string>("ftName", ""))
  const [ftDescription, setFtDescription] = useState<string>(() => loadJson<string>("ftDescription", ""))

  // ── Finetune target (coin / trading pair / timeframe)
  const [coinId, setCoinId] = useState<string | null>(() => loadJson<string | null>("ftCoinId", null))
  const [quoteAsset, setQuoteAsset] = useState<string | null>(() => loadJson<string | null>("ftQuoteAsset", null))
  const [timeframe, setTimeframe] = useState<string | null>(() => loadJson<string | null>("ftTimeframe", null))
  const [startDate, setStartDate] = useState<Date | undefined>(() => {
    const v = loadJson<string | null>("ftStartDate", null)
    return v ? new Date(v) : undefined
  })
  const [endDate, setEndDate] = useState<Date | undefined>(() => {
    const v = loadJson<string | null>("ftEndDate", null)
    return v ? new Date(v) : undefined
  })
  const [ftWorker, setFtWorker] = useState<string | null>(() => loadJson<string | null>("ftWorker", null))

  // ── Data fetching
  const { data: engines = [] } = useQuery({
    queryKey: ["prediction-engines"],
    queryFn: () => predictionEnginesApi.list(),
  })

  const selectedEngine = useMemo(
    () => engines.find((e) => e.id === selectedEngineId) ?? null,
    [engines, selectedEngineId],
  )

  const { data: coins = [] } = useQuery({
    queryKey: ["coins"],
    queryFn: () => coinsApi.list({ limit: 1000 }),
  })
  const selectedCoin = coins.find((c) => c.id === coinId)

  const { data: pairsResp } = useQuery({
    queryKey: ["ftPairs", coinId],
    queryFn: () => klinesApi.getTradingPairs(coinId!),
    enabled: !!coinId,
  })
  const pairs = pairsResp?.pairs ?? []

  const { data: tfResp } = useQuery({
    queryKey: ["ftTimeframes", coinId, quoteAsset],
    queryFn: () => klinesApi.getTimeframes(coinId!, quoteAsset!),
    enabled: !!coinId && !!quoteAsset,
  })
  const timeframes = [...(tfResp?.timeframes ?? [])].sort((a, b) => intervalMinutes(a) - intervalMinutes(b))

  const { data: rangeResp } = useQuery({
    queryKey: ["ftRange", coinId, quoteAsset, timeframe],
    queryFn: () => klinesApi.getDateRange(coinId!, quoteAsset!, timeframe!),
    enabled: !!coinId && !!quoteAsset && !!timeframe,
  })
  const dataMin = rangeResp?.start_date ? parseISO(rangeResp.start_date) : undefined
  const dataMax = rangeResp?.end_date ? parseISO(rangeResp.end_date) : undefined

  const { data: allWorkers = [] } = useQuery({
    queryKey: ["workers"],
    queryFn: () => tasksApi.listWorkers(),
    staleTime: 30_000,
  })

  const ftWorkers = useMemo(() => {
    const slug = selectedEngine?.slug
    return allWorkers.filter((w) => {
      if (w.models.length === 0) return true
      if (!slug) return true
      return w.models.includes(slug)
    })
  }, [allWorkers, selectedEngine])

  const finetuneMutation = useMutation({
    mutationFn: (data: Parameters<typeof finetuneApi.start>[0]) => finetuneApi.start(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      queryClient.invalidateQueries({ queryKey: ["fine-tunes"] })
      toast.success(t("toastFinetuneQueued"))
    },
    onError: () => { toast.error(t("toastFinetuneError")) },
  })

  function handleStartFinetune() {
    if (!selectedEngineId) return
    if (!coinId || !quoteAsset || !timeframe) { toast.error(t("finetuneErrorNoCoin")); return }
    const resolvedName = ftName.trim() || `Fine-tune ${format(new Date(), "yyyy-MM-dd HH:mm")}`
    finetuneMutation.mutate({
      prediction_engine_id: selectedEngineId,
      coin_id: coinId,
      quote_asset: quoteAsset,
      interval: timeframe,
      name: resolvedName,
      description: ftDescription.trim() || undefined,
      start_date: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
      end_date: endDate ? format(endDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      context_length: loadJson<number>("ftContextLength", 512),
      horizon: loadJson<number>("ftHorizon", 64),
      epochs: loadJson<number>("ftEpochs", 50),
      early_stopping_method: loadJson<string>("ftEarlyStoppingMethod", "training"),
      // Patience only applies to the training-loss method; force 0 for validation.
      early_stopping_patience: loadJson<string>("ftEarlyStoppingMethod", "training") === "validation"
        ? 0 : loadJson<number>("ftEarlyStoppingPatience", 0),
      // UI stores the split as a percentage; the API expects a 0–1 fraction.
      validation_split: loadJson<number>("ftValidationSplit", 20) / 100,
      learning_rate: loadJson<number>("ftLearningRate", 0.001),
      batch_size: loadJson<number>("ftBatchSize", 32),
      worker: ftWorker,
    })
    if (!ftName.trim()) setFtName(resolvedName)
  }

  function handleStartSelect(d: Date) {
    setStartDate(d)
    if (!endDate || isBefore(endDate, d)) {
      setEndDate(undefined)
    }
  }

  function handleClear() {
    setFtName("")
    setFtDescription("")
    setSelectedEngineId(null)
    setCoinId(null)
    setQuoteAsset(null)
    setTimeframe(null)
    setStartDate(undefined)
    setEndDate(undefined)
    setFtWorker(null)
  }

  const dayCount = startDate && endDate
    ? differenceInCalendarDays(endDate, startDate) + 1
    : null

  // ── Persist state
  useEffect(() => { saveJson("ftEngineId", selectedEngineId) }, [selectedEngineId])
  useEffect(() => { saveJson("ftName", ftName) }, [ftName])
  useEffect(() => { saveJson("ftDescription", ftDescription) }, [ftDescription])
  useEffect(() => { saveJson("ftCoinId", coinId) }, [coinId])
  useEffect(() => { saveJson("ftQuoteAsset", quoteAsset) }, [quoteAsset])
  useEffect(() => { saveJson("ftTimeframe", timeframe) }, [timeframe])
  useEffect(() => { saveJson("ftStartDate", startDate?.toISOString() ?? null) }, [startDate])
  useEffect(() => { saveJson("ftEndDate", endDate?.toISOString() ?? null) }, [endDate])
  useEffect(() => { saveJson("ftWorker", ftWorker) }, [ftWorker])

  // Once the kline date range loads, default an empty selection to the full
  // data span (earliest → latest), and clamp any existing selection into it so
  // a stale value from another pair/timeframe stays valid.
  useEffect(() => {
    if (!rangeResp?.start_date || !rangeResp?.end_date) return
    const lo = parseISO(rangeResp.start_date)
    const hi = parseISO(rangeResp.end_date)
    const clamp = (d: Date) => (isBefore(d, lo) ? lo : isAfter(d, hi) ? hi : d)
    setStartDate((d) => (d ? clamp(d) : lo))
    setEndDate((d) => (d ? clamp(d) : hi))
  }, [rangeResp?.start_date, rangeResp?.end_date])

  // Clear worker if filtered out
  useEffect(() => {
    if (ftWorker && !ftWorkers.some((w) => w.name === ftWorker)) setFtWorker(null)
  }, [ftWorker, ftWorkers])

  return (
    <div className="max-w-5xl px-6 py-6 flex flex-col gap-8">
      <div className="flex flex-col gap-4">

        {/* Name */}
        <FieldRow label={t("fieldName")}>
          <Input
            value={ftName}
            onChange={(e) => setFtName(e.target.value)}
            placeholder={`Fine-tune ${format(new Date(), "yyyy-MM-dd HH:mm")}`}
            className="h-8 text-sm"
          />
        </FieldRow>

        {/* Description */}
        <FieldRow label={t("fieldDescription")}>
          <Textarea
            value={ftDescription}
            onChange={(e) => setFtDescription(e.target.value)}
            placeholder={t("fieldDescriptionPlaceholder")}
            rows={2}
            className="resize-none text-sm"
          />
        </FieldRow>

        {/* AI Model selector */}
        <FieldRow label={t("finetuneEngine")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span className={cn(!selectedEngine && "text-[var(--muted-foreground)]")}>
                  {selectedEngine?.name ?? t("finetuneEnginePlaceholder")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              {engines.map((e) => (
                <DropdownMenuItem
                  key={e.id}
                  onClick={() => setSelectedEngineId(e.id)}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{e.name}</span>
                  {selectedEngineId === e.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>

        {/* Coin */}
        <FieldRow label={t("finetuneCoin")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span className={cn("truncate", !coinId && "text-[var(--muted-foreground)]")}>
                  {selectedCoin ? `${selectedCoin.symbol} — ${selectedCoin.name}` : t("finetuneCoinPlaceholder")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              {coins.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => { setCoinId(c.id); setQuoteAsset(null); setTimeframe(null) }}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{c.symbol} — {c.name}</span>
                  {coinId === c.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>

        {/* Trading Pair */}
        <FieldRow label={t("finetuneTradingPair")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={!coinId}
                className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className={cn("truncate", !quoteAsset && "text-[var(--muted-foreground)]")}>
                  {quoteAsset ? `${selectedCoin?.symbol ?? ""}${quoteAsset}` : t("finetuneTradingPairPlaceholder")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              {pairs.map((p) => (
                <DropdownMenuItem
                  key={p}
                  onClick={() => { setQuoteAsset(p); setTimeframe(null) }}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{selectedCoin?.symbol}{p}</span>
                  {quoteAsset === p && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>

        {/* Timeframe */}
        <FieldRow label={t("finetuneTimeframe")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={!quoteAsset}
                className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className={cn("truncate", !timeframe && "text-[var(--muted-foreground)]")}>
                  {timeframe ?? t("finetuneTimeframePlaceholder")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              {timeframes.map((tf) => (
                <DropdownMenuItem
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className="flex items-center justify-between"
                >
                  <span>{tf}</span>
                  {timeframe === tf && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>

        {/* Worker */}
        {ftWorkers.length > 0 && (
          <FieldRow label={t("finetuneWorker")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                  <span className={cn(!ftWorker && "text-[var(--muted-foreground)]")}>
                    {ftWorker ?? t("finetuneWorkerAny")}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuItem
                  onClick={() => setFtWorker(null)}
                  className="flex items-center justify-between"
                >
                  <span className="text-[var(--muted-foreground)]">{t("finetuneWorkerAny")}</span>
                  {ftWorker === null && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
                {ftWorkers.map((w) => (
                  <DropdownMenuItem
                    key={w.name}
                    onClick={() => setFtWorker(w.name)}
                    className="flex items-center justify-between"
                  >
                    <span>{w.name}</span>
                    {ftWorker === w.name && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </FieldRow>
        )}
      </div>

      {/* ── Timeline ───────────────────────────────────────────────────────── */}
      <div className="relative">
        <div className="absolute top-5 left-1/4 right-1/4 h-px bg-[var(--border)] z-0" />

        <div className="grid grid-cols-2 gap-8">
          {/* Step 1 — Start Date */}
          <div className="flex flex-col items-center gap-3 relative z-10">
            <StepCircle n={1} active={!!startDate} />
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-sm font-medium">{t("finetuneStepStart")}</span>
              <span className="text-xs text-[var(--muted-foreground)] h-4">
                {startDate ? format(startDate, "d MMM yyyy") : t("finetuneNoDate")}
              </span>
            </div>
            <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card,var(--background))] p-4">
              <MiniCalendar
                selected={startDate}
                onSelect={handleStartSelect}
                minDate={dataMin}
                maxDate={endDate ?? dataMax}
              />
            </div>
          </div>

          {/* Step 2 — End Date */}
          <div className="flex flex-col items-center gap-3 relative z-10">
            <StepCircle n={2} active={!!endDate} />
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className={cn("text-sm font-medium", !startDate && "text-[var(--muted-foreground)]")}>
                {t("finetuneStepEnd")}
              </span>
              <span className="text-xs text-[var(--muted-foreground)] h-4">
                {endDate ? format(endDate, "d MMM yyyy") : t("finetuneNoDate")}
              </span>
            </div>
            <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card,var(--background))] p-4">
              <MiniCalendar
                selected={endDate}
                onSelect={setEndDate}
                minDate={startDate ?? dataMin}
                maxDate={dataMax}
                disabled={!startDate}
              />
            </div>
          </div>
        </div>

        {(dayCount !== null || (dataMin && dataMax)) && (
          <div className="absolute top-[3.5rem] left-1/2 -translate-x-1/2 z-20 bg-background px-2 flex flex-col items-center gap-0.5">
            {dataMin && dataMax && (
              <span className="text-[11px] text-[var(--muted-foreground)] whitespace-nowrap">
                {t("finetuneDataAvailable")}: {format(dataMin, "d MMM yyyy")} – {format(dataMax, "d MMM yyyy")}
              </span>
            )}
            {dayCount !== null && (
              <span className="text-xs text-[var(--muted-foreground)] tabular-nums whitespace-nowrap">
                {dayCount} {dayCount === 1 ? "day" : "days"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleClear} className="cursor-pointer">
          Clear
        </Button>
        <Button
          size="sm"
          onClick={handleStartFinetune}
          disabled={finetuneMutation.isPending || !selectedEngineId || !coinId || !quoteAsset || !timeframe}
          className="cursor-pointer"
        >
          {finetuneMutation.isPending ? t("finetuneStarting") : t("finetuneStart")}
        </Button>
      </div>
    </div>
  )
}
