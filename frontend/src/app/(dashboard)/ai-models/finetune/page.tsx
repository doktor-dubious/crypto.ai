"use client"

import { useState, useMemo, useEffect, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  addMonths, subMonths, addYears, subYears,
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isToday, isBefore, isAfter,
  differenceInCalendarDays, format,
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
  predictionEnginesApi, customersApi, outletGroupsApi, finetuneApi, tasksApi,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

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

  // ── Finetune state
  const [ftCustomerId, setFtCustomerId] = useState<string | null>(() => loadJson<string | null>("ftCustomerId", null))
  const [ftGroupId, setFtGroupId] = useState<string | null>(() => loadJson<string | null>("ftGroupId", null))
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

  const { data: ftCustomers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list({ limit: 100 }),
    staleTime: 5 * 60 * 1000,
  })

  const { data: ftGroups = [] } = useQuery({
    queryKey: ["outlet-groups", ftCustomerId],
    queryFn: () => outletGroupsApi.list(ftCustomerId!),
    enabled: !!ftCustomerId,
  })

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
    if (!ftCustomerId) { toast.error(t("finetuneErrorNoCustomer")); return }
    const resolvedName = ftName.trim() || `Fine-tune ${format(new Date(), "yyyy-MM-dd HH:mm")}`
    finetuneMutation.mutate({
      prediction_engine_id: selectedEngineId,
      customer_id: ftCustomerId,
      name: resolvedName,
      description: ftDescription.trim() || undefined,
      outlet_group_id: ftGroupId,
      start_date: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
      end_date: endDate ? format(endDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      context_length: loadJson<number>("ftContextLength", 512),
      horizon: loadJson<number>("ftHorizon", 64),
      epochs: loadJson<number>("ftEpochs", 50),
      early_stopping_patience: loadJson<number>("ftEarlyStoppingPatience", 0),
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
    setFtCustomerId(null)
    setFtGroupId(null)
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
  useEffect(() => { saveJson("ftCustomerId", ftCustomerId) }, [ftCustomerId])
  useEffect(() => { saveJson("ftGroupId", ftGroupId) }, [ftGroupId])
  useEffect(() => { saveJson("ftStartDate", startDate?.toISOString() ?? null) }, [startDate])
  useEffect(() => { saveJson("ftEndDate", endDate?.toISOString() ?? null) }, [endDate])
  useEffect(() => { saveJson("ftWorker", ftWorker) }, [ftWorker])

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

        {/* Customer */}
        <FieldRow label={t("finetuneCustomer")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer">
                <span className={cn(!ftCustomerId && "text-[var(--muted-foreground)]")}>
                  {ftCustomerId ? ftCustomers.find((c) => c.id === ftCustomerId)?.name ?? "—" : t("finetuneCustomerPlaceholder")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              {ftCustomers.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => { setFtCustomerId(c.id); setFtGroupId(null) }}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{c.name}</span>
                  {ftCustomerId === c.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>

        {/* Outlet Group */}
        <FieldRow label={t("finetuneOutletGroup")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--input-border,var(--border))] bg-transparent text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer" disabled={!ftCustomerId}>
                <span className={cn(!ftGroupId && "text-[var(--muted-foreground)]")}>
                  {ftGroupId ? ftGroups.find((g) => g.id === ftGroupId)?.name ?? "—" : t("finetuneOutletGroupPlaceholder")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-2 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-60 overflow-y-auto">
              <DropdownMenuItem
                onClick={() => setFtGroupId(null)}
                className="flex items-center justify-between"
              >
                <span className="text-[var(--muted-foreground)]">{t("finetuneOutletGroupPlaceholder")}</span>
                {ftGroupId === null && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
              </DropdownMenuItem>
              {ftGroups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => setFtGroupId(g.id)}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{g.name} ({g.outlet_count})</span>
                  {ftGroupId === g.id && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
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
                maxDate={endDate}
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
                minDate={startDate}
                disabled={!startDate}
              />
            </div>
          </div>
        </div>

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
          Clear
        </Button>
        <Button
          size="sm"
          onClick={handleStartFinetune}
          disabled={finetuneMutation.isPending || !selectedEngineId}
          className="cursor-pointer"
        >
          {finetuneMutation.isPending ? t("finetuneStarting") : t("finetuneStart")}
        </Button>
      </div>
    </div>
  )
}
