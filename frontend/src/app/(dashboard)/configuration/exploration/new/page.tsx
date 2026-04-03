"use client"

import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  addMonths, subMonths, addYears, subYears, subDays,
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isToday, isBefore, isAfter,
  differenceInCalendarDays, format,
} from "date-fns"
import { optimizationApi, salesApi, tasksApi, predictionStrategiesApi, outletGroupsApi, type OptimizeSettingsRequest } from "@/lib/api"
import { useCustomer } from "@/components/providers/customer-provider"
import { ChevronDown, ChevronLeft, ChevronRight, Check, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function InfoIcon({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0 mt-px" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

// ─── Settings definition ──────────────────────────────────────────────────────

interface ToggleSetting {
  type: "toggle"
  key: string
  labelKey: string
  infoKey: string
  optionCount: number
}

interface RangeSetting {
  type: "range"
  key: string
  labelKey: string
  infoKey: string
  fromKey: string
  toKey: string
  iterKey: string
  fromDefault: number
  toDefault: number
  iterDefault: number
  step?: number
}

type Setting = ToggleSetting | RangeSetting

const SETTINGS: Setting[] = [
  { type: "toggle", key: "optimize_variation_adjustment", labelKey: "optimizeVariationAdjustment", infoKey: "optimizeVariationAdjustmentInfo", optionCount: 2 },
  { type: "toggle", key: "optimize_eo_methodology", labelKey: "optimizeEoMethodology", infoKey: "optimizeEoMethodologyInfo", optionCount: 2 },
  { type: "toggle", key: "optimize_eo_extrapolation", labelKey: "optimizeEoExtrapolation", infoKey: "optimizeEoExtrapolationInfo", optionCount: 4 },
  { type: "toggle", key: "optimize_covariate_handling", labelKey: "optimizeCovariateHandling", infoKey: "optimizeCovariateHandlingInfo", optionCount: 3 },
  { type: "toggle", key: "optimize_weekday_profile_correction", labelKey: "optimizeWeekdayProfileCorrection", infoKey: "optimizeWeekdayProfileCorrectionInfo", optionCount: 2 },
  { type: "range", key: "optimize_history_window", labelKey: "optimizeHistoryWindow", infoKey: "optimizeHistoryWindowInfo", fromKey: "history_window_from", toKey: "history_window_to", iterKey: "history_window_iterations", fromDefault: 365, toDefault: 730, iterDefault: 4 },
  { type: "range", key: "optimize_correction_strength", labelKey: "optimizeCorrectionStrength", infoKey: "optimizeCorrectionStrengthInfo", fromKey: "correction_strength_from", toKey: "correction_strength_to", iterKey: "correction_strength_iterations", fromDefault: 1.0, toDefault: 0.0, iterDefault: 4, step: 0.1 },
  { type: "range", key: "optimize_correction_threshold", labelKey: "optimizeCorrectionThreshold", infoKey: "optimizeCorrectionThresholdInfo", fromKey: "correction_threshold_from", toKey: "correction_threshold_to", iterKey: "correction_threshold_iterations", fromDefault: 0.0, toDefault: 1.0, iterDefault: 4, step: 0.1 },
]

function formatEstimatedTime(minutes: number): string {
  if (minutes < 1) return "<1 minute"
  if (minutes < 60) return `~${Math.round(minutes)} minutes`
  const hours = minutes / 60
  if (hours < 24) return `~${hours.toFixed(1)} hours`
  const days = hours / 24
  return `~${days.toFixed(1)} days`
}

// ─── Inline calendar ───────────────────────────────────────────────────────────

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

// ─── Step circle ──────────────────────────────────────────────────────────────

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

export default function ExplorationNewPage() {
  const t = useTranslations("configuration")
  const router = useRouter()
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()

  const [name, setName] = useState("")
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [rangeParams, setRangeParams] = useState<Record<string, number>>({})
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [worker, setWorker] = useState<string | null>(null)

  const { data: strategies = [] } = useQuery({
    queryKey: ["prediction-strategies", activeCustomer?.id],
    queryFn: () => predictionStrategiesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const selectedStrategy = strategies.find((s) => s.id === selectedStrategyId) ?? null

  const { data: outletGroups = [] } = useQuery({
    queryKey: ["outlet-groups", activeCustomer?.id],
    queryFn: () => outletGroupsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const selectedGroup = outletGroups.find((g) => g.id === selectedGroupId) ?? null

  const { data: salesDateRange } = useQuery({
    queryKey: ["sales-date-range", activeCustomer?.id],
    queryFn: () => salesApi.getDateRange(activeCustomer!.id),
    enabled: !!activeCustomer,
    staleTime: 5 * 60_000,
  })

  const firstSalesDate = salesDateRange?.min_date ? new Date(salesDateRange.min_date) : undefined
  const lastSalesDate = salesDateRange?.max_date ? new Date(salesDateRange.max_date) : undefined
  const startMaxDate = lastSalesDate ? subDays(lastSalesDate, 1) : undefined
  const endMaxDate = lastSalesDate

  function handleStartSelect(d: Date) {
    setStartDate(d)
    if (!endDate || isBefore(endDate, d)) {
      setEndDate(endMaxDate && isAfter(d, endMaxDate) ? endMaxDate : d)
    }
  }

  const simulationDays = startDate && endDate
    ? differenceInCalendarDays(endDate, startDate) + 1
    : 180

  const { data: workers = [] } = useQuery({
    queryKey: ["workers"],
    queryFn: () => tasksApi.listWorkers(),
    staleTime: 30_000,
  })

  const getRangeVal = (key: string, fallback: number) => rangeParams[key] ?? fallback

  const simulationCount = useMemo(() => {
    const active = SETTINGS.filter((s) => enabled[s.key])
    if (active.length === 0) return 0
    return active.reduce((acc, s) => {
      if (s.type === "toggle") return acc * s.optionCount
      return acc * (getRangeVal(s.iterKey, s.iterDefault) || 1)
    }, 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rangeParams])

  const estimatedMinutes = simulationCount * 3 * (simulationDays / 180)
  const estimatedTimeStr = simulationCount > 0 ? formatEstimatedTime(estimatedMinutes) : ""

  const mutation = useMutation({
    mutationFn: (data: OptimizeSettingsRequest) => optimizationApi.runAsync(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      queryClient.invalidateQueries({ queryKey: ["optimizationRuns"] })
      toast.success(t("optimizeStarted"))
      router.push("/configuration/exploration")
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to start optimization")
    },
  })

  function handleStart() {
    if (!activeCustomer || simulationCount === 0 || !startDate || !endDate) return
    const data: OptimizeSettingsRequest = {
      customer_id: activeCustomer.id,
      name: name.trim() || undefined,
      optimize_variation_adjustment: !!enabled.optimize_variation_adjustment,
      optimize_eo_methodology: !!enabled.optimize_eo_methodology,
      optimize_eo_extrapolation: !!enabled.optimize_eo_extrapolation,
      optimize_covariate_handling: !!enabled.optimize_covariate_handling,
      optimize_weekday_profile_correction: !!enabled.optimize_weekday_profile_correction,
      simulation_from: format(startDate, "yyyy-MM-dd"),
      simulation_to: format(endDate, "yyyy-MM-dd"),
      prediction_strategy_id: selectedStrategyId || undefined,
      outlet_group_id: selectedGroupId || undefined,
      worker: worker || undefined,
    }
    for (const s of SETTINGS) {
      if (s.type !== "range" || !enabled[s.key]) continue
      ;(data as unknown as Record<string, unknown>)[s.key] = true
      ;(data as unknown as Record<string, unknown>)[s.fromKey] = getRangeVal(s.fromKey, s.fromDefault)
      ;(data as unknown as Record<string, unknown>)[s.toKey] = getRangeVal(s.toKey, s.toDefault)
      ;(data as unknown as Record<string, unknown>)[s.iterKey] = getRangeVal(s.iterKey, s.iterDefault)
    }
    mutation.mutate(data)
  }

  function handleClear() {
    setName("")
    setSelectedStrategyId(null)
    setSelectedGroupId(null)
    setEnabled({})
    setRangeParams({})
    setStartDate(undefined)
    setEndDate(undefined)
    setWorker(null)
  }

  if (!activeCustomer) {
    return (
      <div className="max-w-2xl px-6 py-6">
        <p className="text-sm text-muted-foreground">{t("noCustomer")}</p>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="max-w-3xl px-6 py-6 flex flex-col gap-6">
      {/* Name */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("optimizeName" as Parameters<typeof t>[0])}</label>
          <InfoIcon text={t("optimizeNameInfo" as Parameters<typeof t>[0])} />
        </div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("optimizeNamePlaceholder" as Parameters<typeof t>[0])}
          className="h-8 text-sm"
        />
      </div>

      {/* Settings toggles */}
      <div className="space-y-2">
        {SETTINGS.map((setting) => (
          <div key={setting.key}>
            <div className="flex items-center justify-between py-1.5">
              <label className="flex items-center gap-3 cursor-pointer">
                <Switch
                  checked={!!enabled[setting.key]}
                  onCheckedChange={(v) => setEnabled((prev) => ({ ...prev, [setting.key]: v }))}
                />
                <span className="text-sm">{t(setting.labelKey as Parameters<typeof t>[0])}</span>
                <InfoIcon text={t(setting.infoKey as Parameters<typeof t>[0])} />
              </label>
              <span className="text-xs text-muted-foreground">
                {enabled[setting.key]
                  ? setting.type === "toggle"
                    ? t("optimizeOptions", { count: setting.optionCount })
                    : t("optimizeOptions", { count: getRangeVal(setting.iterKey, setting.iterDefault) })
                  : ""}
              </span>
            </div>
            {setting.type === "range" && enabled[setting.key] && (
              <div className="ml-12 mb-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-10">{t("optimizeRangeFrom" as Parameters<typeof t>[0])}</span>
                <Input
                  type="number"
                  step={setting.step}
                  value={getRangeVal(setting.fromKey, setting.fromDefault)}
                  onChange={(e) => setRangeParams((p) => ({ ...p, [setting.fromKey]: Number(e.target.value) }))}
                  className="w-20 h-7 text-xs text-right"
                />
                <span className="text-muted-foreground w-6 text-center">{t("optimizeRangeTo" as Parameters<typeof t>[0])}</span>
                <Input
                  type="number"
                  step={setting.step}
                  value={getRangeVal(setting.toKey, setting.toDefault)}
                  onChange={(e) => setRangeParams((p) => ({ ...p, [setting.toKey]: Number(e.target.value) }))}
                  className="w-20 h-7 text-xs text-right"
                />
                <span className="text-muted-foreground">{t("optimizeRangeIter" as Parameters<typeof t>[0])}</span>
                <Input
                  type="number"
                  min={2}
                  max={20}
                  value={getRangeVal(setting.iterKey, setting.iterDefault)}
                  onChange={(e) => setRangeParams((p) => ({ ...p, [setting.iterKey]: Math.max(2, Math.min(20, Number(e.target.value) || 2)) }))}
                  className="w-14 h-7 text-xs text-right"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Prediction Strategy */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("optimizeStrategy" as Parameters<typeof t>[0])}</label>
          <InfoIcon text={t("optimizeStrategyInfo" as Parameters<typeof t>[0])} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
              <span className={cn(!selectedStrategy && "text-[var(--muted-foreground)]")}>
                {selectedStrategy?.name ?? t("optimizeStrategyPlaceholder" as Parameters<typeof t>[0])}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
            <DropdownMenuItem
              onClick={() => setSelectedStrategyId(null)}
              className="flex items-center justify-between"
            >
              <span className="text-[var(--muted-foreground)]">{t("optimizeStrategyNone" as Parameters<typeof t>[0])}</span>
              {selectedStrategyId === null && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
            </DropdownMenuItem>
            {strategies.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => setSelectedStrategyId(s.id)}
                className="flex items-center justify-between"
              >
                <span className="truncate">{s.name}</span>
                {selectedStrategyId === s.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Outlet Group */}
      {outletGroups.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("optimizeOutletGroup" as Parameters<typeof t>[0])}</label>
            <InfoIcon text={t("optimizeOutletGroupInfo" as Parameters<typeof t>[0])} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span className={cn(!selectedGroup && "text-[var(--muted-foreground)]")}>
                  {selectedGroup?.name ?? t("optimizeOutletGroupAll" as Parameters<typeof t>[0])}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              <DropdownMenuItem
                onClick={() => setSelectedGroupId(null)}
                className="flex items-center justify-between"
              >
                <span className="text-[var(--muted-foreground)]">{t("optimizeOutletGroupAll" as Parameters<typeof t>[0])}</span>
                {selectedGroupId === null && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
              </DropdownMenuItem>
              {outletGroups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => setSelectedGroupId(g.id)}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{g.name}</span>
                  {selectedGroupId === g.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Worker */}
      {workers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("optimizeWorker" as Parameters<typeof t>[0])}</label>
            <InfoIcon text={t("optimizeWorkerInfo" as Parameters<typeof t>[0])} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span className={cn(!worker && "text-[var(--muted-foreground)]")}>
                  {worker ?? t("optimizeWorkerAny" as Parameters<typeof t>[0])}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuItem
                onClick={() => setWorker(null)}
                className="flex items-center justify-between"
              >
                <span className="text-[var(--muted-foreground)]">{t("optimizeWorkerAny" as Parameters<typeof t>[0])}</span>
                {worker === null && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
              </DropdownMenuItem>
              {workers.map((w) => (
                <DropdownMenuItem
                  key={w.name}
                  onClick={() => setWorker(w.name)}
                  className="flex items-center justify-between"
                >
                  <span>{w.name}</span>
                  {worker === w.name && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Simulation period — timeline layout */}
      <div className="border-t pt-4 relative">
        {/* Connecting line behind the circles */}
        <div className="absolute top-[calc(1rem+1.25rem)] left-1/4 right-1/4 h-px bg-[var(--border)] z-0" />

        <div className="grid grid-cols-2 gap-8">
          {/* Step 1 — Start Date */}
          <div className="flex flex-col items-center gap-3 relative z-10">
            <StepCircle n={1} active={!!startDate} />
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-sm font-medium">{t("optimizeStartDate" as Parameters<typeof t>[0])}</span>
              <span className="text-xs text-[var(--muted-foreground)] h-4">
                {startDate ? format(startDate, "d MMM yyyy") : "\u00A0"}
              </span>
            </div>
            <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card,var(--background))] p-4">
              <MiniCalendar
                selected={startDate}
                onSelect={handleStartSelect}
                minDate={firstSalesDate}
                maxDate={endDate ?? startMaxDate}
              />
            </div>
          </div>

          {/* Step 2 — End Date */}
          <div className="flex flex-col items-center gap-3 relative z-10">
            <StepCircle n={2} active={!!endDate} />
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className={cn("text-sm font-medium", !startDate && "text-[var(--muted-foreground)]")}>
                {t("optimizeEndDate" as Parameters<typeof t>[0])}
              </span>
              <span className="text-xs text-[var(--muted-foreground)] h-4">
                {endDate ? format(endDate, "d MMM yyyy") : "\u00A0"}
              </span>
            </div>
            <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card,var(--background))] p-4">
              <MiniCalendar
                selected={endDate}
                onSelect={setEndDate}
                minDate={startDate}
                maxDate={endMaxDate}
                disabled={!startDate}
              />
            </div>
          </div>
        </div>

        {/* Day count — centered between the two columns */}
        {startDate && endDate && (
          <div className="absolute top-[calc(1rem+2.75rem)] left-1/2 -translate-x-1/2 z-20 bg-background px-2">
            <span className="text-xs text-[var(--muted-foreground)] tabular-nums whitespace-nowrap">
              {differenceInCalendarDays(endDate, startDate) + 1} {t("optimizeDays" as Parameters<typeof t>[0])}
            </span>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="space-y-1.5 border-t pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {simulationCount > 0
              ? t("optimizeSimulationsRequired", { count: simulationCount })
              : t("optimizeNoSettings")}
          </span>
        </div>
        {simulationCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("optimizeEstimatedTime", { time: estimatedTimeStr })}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleClear} className="cursor-pointer">
          Clear
        </Button>
        <Button
          size="sm"
          onClick={handleStart}
          disabled={simulationCount === 0 || !startDate || !endDate || mutation.isPending}
          className="cursor-pointer"
        >
          {t("optimizeStart")}
        </Button>
      </div>
    </div>
    </TooltipProvider>
  )
}
