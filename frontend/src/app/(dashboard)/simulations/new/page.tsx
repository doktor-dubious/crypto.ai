"use client"

import { useState, useEffect, useRef } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  ChevronDown, ChevronLeft, ChevronRight, Check,
} from "lucide-react"
import {
  addMonths, subMonths, addYears, subYears, subDays,
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isToday, isBefore, isAfter,
  differenceInCalendarDays, format,
} from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCustomer } from "@/components/providers/customer-provider"
import { simulationsApi, predictionStrategiesApi, outletGroupsApi, customerConfigurationApi, salesApi, type SimulationRunRequest } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Simulation type options ───────────────────────────────────────────────────

const SIMULATION_TYPES = [
  { value: 1, labelKey: "typeStrategy" },
  { value: 3, labelKey: "typeSameDraw" },
  { value: 4, labelKey: "typeSameSale" },
] as const

type SimType = (typeof SIMULATION_TYPES)[number]["value"]

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
  const startPad = (getDay(monthStart) + 6) % 7 // Monday-first

  function setYear(y: number) {
    setView(new Date(y, view.getMonth(), 1))
    setYearPickerOpen(false)
  }

  return (
    <div className={cn("select-none w-full", disabled && "opacity-40 pointer-events-none")}>
      {/* Month / year nav */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-0.5">
          <button onClick={() => setView(subYears(view, 1))} className="p-1 rounded hover:bg-[var(--muted)] transition-colors cursor-pointer" title="Previous year">
            <ChevronLeft className="h-3 w-3 opacity-60" />
          </button>
          <button onClick={() => setView(subMonths(view, 1))} className="p-1 rounded hover:bg-[var(--muted)] transition-colors cursor-pointer" title="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Clickable month + year label → opens year picker */}
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

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} className="text-center text-xs text-[var(--muted-foreground)] font-medium py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
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

// ─── localStorage helpers (scoped per customer) ─────────────────────────────

const SIMN_STORAGE_PREFIX = "gorm:simNew:"

function loadSimNJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${SIMN_STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveSimNJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${SIMN_STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

export default function SimulationsNewPage() {
  const t = useTranslations("simulations.new")
  const { activeCustomer } = useCustomer()
  const cid = activeCustomer?.id ?? ""

  const [name, setName] = useState(() => loadSimNJson<string>(cid, "name", ""))
  const [description, setDescription] = useState(() => loadSimNJson<string>(cid, "description", ""))
  const [simType, setSimType] = useState<SimType>(() => loadSimNJson<SimType>(cid, "simType", 1))
  const [delay, setDelay] = useState(() => loadSimNJson<number>(cid, "delay", 14))
  const [strategyId, setStrategyId] = useState<string | null>(() => loadSimNJson<string | null>(cid, "strategyId", null))
  const [outletGroupId, setOutletGroupId] = useState<string | null>(() => loadSimNJson<string | null>(cid, "outletGroupId", null))
  const [startDate, setStartDate] = useState<Date | undefined>(() => { const v = loadSimNJson<string | null>(cid, "startDate", null); return v ? new Date(v) : undefined })
  const [endDate, setEndDate] = useState<Date | undefined>(() => { const v = loadSimNJson<string | null>(cid, "endDate", null); return v ? new Date(v) : undefined })

  const { data: strategies = [] } = useQuery({
    queryKey: ["prediction-strategies", activeCustomer?.id],
    queryFn: () => predictionStrategiesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const { data: outletGroups = [] } = useQuery({
    queryKey: ["outlet-groups", activeCustomer?.id],
    queryFn: () => outletGroupsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const { data: customerConfig } = useQuery({
    queryKey: ["customer-configuration", activeCustomer?.id],
    queryFn: () => customerConfigurationApi.get(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const { data: salesDateRange } = useQuery({
    queryKey: ["sales-date-range", activeCustomer?.id],
    queryFn: () => salesApi.getDateRange(activeCustomer!.id),
    enabled: !!activeCustomer,
    staleTime: 5 * 60_000,
  })

  const lastSalesDate = salesDateRange?.max_date ? new Date(salesDateRange.max_date) : undefined
  // Start: must leave at least 1 day to simulate, so max = lastSalesDate - 1
  const startMaxDate = lastSalesDate ? subDays(lastSalesDate, 1) : undefined
  // End: cannot go beyond last day with sales data
  const endMaxDate = lastSalesDate

  // Default outlet group to customer configuration value when data loads
  // ─── Persist state to localStorage ─────────────────────────────────────────

  useEffect(() => { if (cid) saveSimNJson(cid, "name", name) }, [cid, name])
  useEffect(() => { if (cid) saveSimNJson(cid, "description", description) }, [cid, description])
  useEffect(() => { if (cid) saveSimNJson(cid, "simType", simType) }, [cid, simType])
  useEffect(() => { if (cid) saveSimNJson(cid, "delay", delay) }, [cid, delay])
  useEffect(() => { if (cid) saveSimNJson(cid, "strategyId", strategyId) }, [cid, strategyId])
  useEffect(() => { if (cid) saveSimNJson(cid, "outletGroupId", outletGroupId) }, [cid, outletGroupId])
  useEffect(() => { if (cid) saveSimNJson(cid, "startDate", startDate?.toISOString() ?? null) }, [cid, startDate])
  useEffect(() => { if (cid) saveSimNJson(cid, "endDate", endDate?.toISOString() ?? null) }, [cid, endDate])

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setName(loadSimNJson<string>(cid, "name", ""))
      setDescription(loadSimNJson<string>(cid, "description", ""))
      setSimType(loadSimNJson<SimType>(cid, "simType", 1))
      setDelay(loadSimNJson<number>(cid, "delay", 14))
      setStrategyId(loadSimNJson<string | null>(cid, "strategyId", null))
      setOutletGroupId(loadSimNJson<string | null>(cid, "outletGroupId", null))
      const sd = loadSimNJson<string | null>(cid, "startDate", null)
      setStartDate(sd ? new Date(sd) : undefined)
      const ed = loadSimNJson<string | null>(cid, "endDate", null)
      setEndDate(ed ? new Date(ed) : undefined)
    }
    prevCidRef.current = cid
  }, [cid])

  const defaultGroupId = customerConfig?.group_id ?? null
  const resolvedGroupId = outletGroupId === null && defaultGroupId ? defaultGroupId : outletGroupId

  const selectedStrategy = strategies.find((s) => s.id === strategyId) ?? null

  const selectedTypeLabel = t(SIMULATION_TYPES.find((s) => s.value === simType)!.labelKey as Parameters<typeof t>[0])

  const runMutation = useMutation({
    mutationFn: (req: SimulationRunRequest) => simulationsApi.runAsync(req),
    onSuccess: () => toast.success(t("toastQueued")),
    onError: () => toast.error(t("toastError")),
  })

  function handleGenerate() {
    if (!activeCustomer) return void toast.error(t("errorNoCustomer"))
    if (!startDate || !endDate) return void toast.error(t("errorNoDates"))
    if (isBefore(endDate, startDate)) return void toast.error(t("errorDateOrder"))
    const resolvedName = name.trim() ||
      `${selectedTypeLabel} simulation ${format(startDate, "d MMM yyyy")} – ${format(endDate, "d MMM yyyy")}`
    runMutation.mutate({
      customer_id: activeCustomer.id,
      name: resolvedName,
      description: description.trim() || undefined,
      simulation_from: format(startDate, "yyyy-MM-dd"),
      simulation_to: format(endDate, "yyyy-MM-dd"),
      simulation_type: simType,
      delay,
      prediction_strategy_id: strategyId,
      outlet_group_id: resolvedGroupId || undefined,
    })
    if (!name.trim()) setName(resolvedName)
  }

  function handleClear() {
    setName("")
    setDescription("")
    setSimType(1)
    setDelay(14)
    setStrategyId(null)
    setOutletGroupId(null) // null = restore to customer config default
    setStartDate(undefined)
    setEndDate(undefined)
  }

  function handleStartSelect(d: Date) {
    setStartDate(d)
    // Mirror to end date; keep end date if it's already after the new start and within sales range
    if (!endDate || isBefore(endDate, d)) {
      setEndDate(endMaxDate && isAfter(d, endMaxDate) ? endMaxDate : d)
    }
  }

  const dayCount = startDate && endDate
    ? differenceInCalendarDays(endDate, startDate) + 1
    : null

  return (
    <div className="max-w-5xl px-6 py-6 flex flex-col gap-8">

      {/* ── Fields ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldName")}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("fieldNamePlaceholder")}
            className="h-8 text-sm"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldDescription")}</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("fieldDescriptionPlaceholder")}
            rows={2}
            className="resize-none text-sm"
          />
        </div>

        {/* Simulation Type */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldType")}</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span>{selectedTypeLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {SIMULATION_TYPES.map((s) => (
                <DropdownMenuItem
                  key={s.value}
                  onClick={() => setSimType(s.value)}
                  className="flex items-center justify-between"
                >
                  {t(s.labelKey as Parameters<typeof t>[0])}
                  {simType === s.value && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Delay */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldDelay")}</label>
          <Input
            type="number"
            min={0}
            value={delay}
            onChange={(e) => setDelay(Math.max(0, Number(e.target.value)))}
            className="h-8 text-sm w-72"
          />
        </div>

        {/* Strategy */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldStrategy")}</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span className={cn(!selectedStrategy && "text-[var(--muted-foreground)]")}>
                  {selectedStrategy ? selectedStrategy.name : t("fieldStrategyNone")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              <DropdownMenuItem
                onClick={() => setStrategyId(null)}
                className="flex items-center justify-between"
              >
                <span className="text-[var(--muted-foreground)]">{t("fieldStrategyNone")}</span>
                {strategyId === null && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
              </DropdownMenuItem>
              {strategies.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => setStrategyId(s.id)}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{s.name}</span>
                  {strategyId === s.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Outlet Group */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldOutletGroup")}</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span className={cn(!resolvedGroupId && "text-[var(--muted-foreground)]")}>
                  {resolvedGroupId
                    ? (outletGroups.find((g) => g.id === resolvedGroupId)?.name ?? t("fieldOutletGroupNone"))
                    : t("fieldOutletGroupNone")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              <DropdownMenuItem
                onClick={() => setOutletGroupId("")}
                className="flex items-center justify-between"
              >
                <span className="text-[var(--muted-foreground)]">{t("fieldOutletGroupNone")}</span>
                {!resolvedGroupId && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
              </DropdownMenuItem>
              {outletGroups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => setOutletGroupId(g.id)}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{g.name}</span>
                  {resolvedGroupId === g.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

      </div>

      {/* ── Timeline ───────────────────────────────────────────────────────── */}
      <div className="relative">

        {/* Connecting line behind the circles */}
        <div className="absolute top-5 left-1/4 right-1/4 h-px bg-[var(--border)] z-0" />

        <div className="grid grid-cols-2 gap-8">

          {/* Step 1 — Start Date */}
          <div className="flex flex-col items-center gap-3 relative z-10">
            <StepCircle n={1} active={!!startDate} />
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-sm font-medium">{t("stepStart")}</span>
              <span className="text-xs text-[var(--muted-foreground)] h-4">
                {startDate ? format(startDate, "d MMM yyyy") : t("noDateSelected")}
              </span>
            </div>
            <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card,var(--background))] p-4">
              <MiniCalendar
                selected={startDate}
                onSelect={handleStartSelect}
                maxDate={endDate ?? startMaxDate}
              />
            </div>
          </div>

          {/* Step 2 — End Date */}
          <div className="flex flex-col items-center gap-3 relative z-10">
            <StepCircle n={2} active={!!endDate} />
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className={cn("text-sm font-medium", !startDate && "text-[var(--muted-foreground)]")}>
                {t("stepEnd")}
              </span>
              <span className="text-xs text-[var(--muted-foreground)] h-4">
                {endDate ? format(endDate, "d MMM yyyy") : t("noDateSelected")}
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
        {dayCount !== null && (
          <div className="absolute top-[4.25rem] left-1/2 -translate-x-1/2 z-20 bg-background px-2">
            <span className="text-xs text-[var(--muted-foreground)] tabular-nums whitespace-nowrap">
              {dayCount} {dayCount === 1 ? "day" : "days"}
            </span>
          </div>
        )}
      </div>


      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleClear} className="cursor-pointer">
          {t("clearButton")}
        </Button>
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={runMutation.isPending || !startDate || !endDate}
          className="cursor-pointer"
        >
          {runMutation.isPending ? t("generating") : t("generateButton")}
        </Button>
      </div>

    </div>
  )
}
