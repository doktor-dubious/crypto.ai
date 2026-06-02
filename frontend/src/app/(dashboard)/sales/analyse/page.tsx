"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { CalendarIcon } from "lucide-react"
import { format, differenceInCalendarDays } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useCustomer } from "@/components/providers/customer-provider"
import { outletGroupsApi, customerConfigurationApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { DataQualityTab } from "@/components/analysis/data-quality-tab"
import { OutlierTab } from "@/components/analysis/outlier-tab"
import { PatternsTab } from "@/components/analysis/patterns-tab"
import { DeliveryTab } from "@/components/analysis/delivery-tab"
import { SegmentationTab } from "@/components/analysis/segmentation-tab"
import { HealthCheckTab } from "@/components/analysis/health-check-tab"
import { CohortTab } from "@/components/analysis/cohort-tab"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SS_PREFIX = "gorm:salesAnalyse:"
function loadSsV<T>(cid: string, k: string, fb: T): T {
  if (typeof window === "undefined") return fb
  try {
    const r = localStorage.getItem(`${SS_PREFIX}${cid}:${k}`)
    return r ? JSON.parse(r) : fb
  } catch { return fb }
}
function saveSsV(cid: string, k: string, v: unknown) {
  if (typeof window !== "undefined")
    localStorage.setItem(`${SS_PREFIX}${cid}:${k}`, JSON.stringify(v))
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SalesAnalysePage() {
  const t = useTranslations("salesAnalysis")
  const { activeCustomer } = useCustomer()
  const customerId = activeCustomer?.id
  const cid = customerId ?? ""

  // Filters (persisted)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    () => loadSsV<string | null>(cid, "groupId", null),
  )
  const [weeks, setWeeks] = useState(() => loadSsV<number>(cid, "weeks", 104))
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const saved = loadSsV<{ from?: string; to?: string } | null>(cid, "dateRange", null)
    if (saved?.from) {
      return {
        from: new Date(saved.from + "T00:00:00"),
        to: saved.to ? new Date(saved.to + "T00:00:00") : undefined,
      }
    }
    return undefined
  })
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(
    () => loadSsV<string>(cid, "tab", "data-quality"),
  )

  // Tab underline indicator
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab])

  // Restore saved values when customer ID becomes available or changes
  const prevCidRef = useRef("")
  const readyToSaveRef = useRef(false)
  useEffect(() => {
    if (cid && prevCidRef.current !== cid) {
      readyToSaveRef.current = false
      setSelectedGroupId(loadSsV<string | null>(cid, "groupId", null))
      setWeeks(loadSsV(cid, "weeks", 104))
      const savedDr = loadSsV<{ from?: string; to?: string } | null>(cid, "dateRange", null)
      setDateRange(savedDr?.from ? {
        from: new Date(savedDr.from + "T00:00:00"),
        to: savedDr.to ? new Date(savedDr.to + "T00:00:00") : undefined,
      } : undefined)
      setActiveTab(loadSsV(cid, "tab", "data-quality"))
      // Allow persisting after state has settled (next render cycle)
      requestAnimationFrame(() => { readyToSaveRef.current = true })
    }
    prevCidRef.current = cid
  }, [cid])

  // Persist (only after restore has completed for this customer)
  useEffect(() => { if (cid && readyToSaveRef.current) saveSsV(cid, "groupId", selectedGroupId) }, [cid, selectedGroupId])
  useEffect(() => { if (cid && readyToSaveRef.current) saveSsV(cid, "weeks", weeks) }, [cid, weeks])
  useEffect(() => {
    if (cid && readyToSaveRef.current) {
      saveSsV(cid, "dateRange", dateRange?.from ? {
        from: format(dateRange.from, "yyyy-MM-dd"),
        to: dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined,
      } : null)
    }
  }, [cid, dateRange])
  useEffect(() => { if (cid && readyToSaveRef.current) saveSsV(cid, "tab", activeTab) }, [cid, activeTab])

  // Customer config (for production group default)
  const { data: customerConfig } = useQuery({
    queryKey: ["customer-config", customerId],
    queryFn: () => customerConfigurationApi.get(customerId!),
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  // Outlet groups
  const { data: groups = [] } = useQuery({
    queryKey: ["outlet-groups", customerId],
    queryFn: () => outletGroupsApi.list(customerId!),
    enabled: !!customerId,
    staleTime: 60 * 1000,
  })

  const effectiveGroupId = useMemo(() => {
    if (selectedGroupId !== null) return selectedGroupId
    if (customerConfig?.production_group_id) return customerConfig.production_group_id
    return groups[0]?.id ?? null
  }, [selectedGroupId, customerConfig?.production_group_id, groups])

  // Outlets in group
  const { data: groupOutlets = [] } = useQuery({
    queryKey: ["outlet-group-outlets", effectiveGroupId],
    queryFn: () => outletGroupsApi.getOutlets(effectiveGroupId!),
    enabled: !!effectiveGroupId,
    staleTime: 60 * 1000,
  })

  const outletIds = useMemo(() => groupOutlets.map((o) => o.id), [groupOutlets])

  // Date range
  const endDate = useMemo(() => {
    if (dateRange?.to) return format(dateRange.to, "yyyy-MM-dd")
    return new Date().toISOString().slice(0, 10)
  }, [dateRange?.to])

  const startDate = useMemo(() => {
    if (dateRange?.from) return format(dateRange.from, "yyyy-MM-dd")
    const d = new Date()
    d.setDate(d.getDate() - weeks * 7)
    return d.toISOString().slice(0, 10)
  }, [dateRange?.from, weeks])

  function handleDateRangeChange(range: DateRange | undefined) {
    setDateRange(range)
    if (range?.from && range?.to) {
      const days = differenceInCalendarDays(range.to, range.from)
      setWeeks(Math.max(1, Math.round(days / 7)))
    }
  }

  function handleWeeksChange(newWeeks: number) {
    setWeeks(newWeeks)
    setDateRange(undefined)
  }

  const ready = !!customerId && outletIds.length > 0

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px]">
      {/* Toolbar */}
      <div className="flex items-end gap-4 flex-wrap">
        {/* Outlet Group */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("outletGroup")}</label>
          <select
            value={effectiveGroupId ?? ""}
            onChange={(e) => setSelectedGroupId(e.target.value || null)}
            className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer min-w-[200px]"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.outlet_count})
              </option>
            ))}
          </select>
        </div>

        {/* Weeks */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("period")}</label>
          <Input
            type="number"
            min={1}
            max={520}
            value={weeks}
            onChange={(e) => handleWeeksChange(Math.max(1, parseInt(e.target.value) || 104))}
            className="h-8 w-20 text-xs"
          />
        </div>

        {/* Date Range Picker */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--muted-foreground)]">{t("dateRange")}</label>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-8 justify-start text-left text-xs font-normal min-w-[220px] cursor-pointer",
                  !dateRange?.from && "text-[var(--muted-foreground)]",
                )}
              >
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "MMM d, yyyy")} &ndash; {format(dateRange.to, "MMM d, yyyy")}
                    </>
                  ) : (
                    format(dateRange.from, "MMM d, yyyy")
                  )
                ) : (
                  t("dateRangePlaceholder")
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex gap-0">
                <Calendar
                  mode="range"
                  captionLayout="dropdown"
                  defaultMonth={dateRange?.from ?? new Date(new Date().getFullYear(), new Date().getMonth() - 1)}
                  selected={dateRange}
                  onSelect={handleDateRangeChange}
                  numberOfMonths={1}
                  startMonth={new Date(2020, 0)}
                  endMonth={new Date(new Date().getFullYear() + 1, 11)}
                />
                <Calendar
                  mode="range"
                  captionLayout="dropdown"
                  defaultMonth={dateRange?.to ?? new Date()}
                  selected={dateRange}
                  onSelect={handleDateRangeChange}
                  numberOfMonths={1}
                  startMonth={new Date(2020, 0)}
                  endMonth={new Date(new Date().getFullYear() + 1, 11)}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Outlet count */}
      {outletIds.length > 0 && (
        <div className="text-xs text-[var(--muted-foreground)] -mt-3">
          {t("outletCount", { count: outletIds.length })}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList
          ref={tabsListRef}
          className="w-full bg-transparent border-b border-[var(--border)] rounded-none p-0 h-auto flex relative"
        >
          <TabsTrigger
            value="data-quality"
            className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"
          >
            {t("tabDataQuality")}
          </TabsTrigger>
          <TabsTrigger
            value="outliers"
            className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"
          >
            {t("tabOutliers")}
          </TabsTrigger>
          <TabsTrigger
            value="patterns"
            className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"
          >
            {t("tabPatterns")}
          </TabsTrigger>
          <TabsTrigger
            value="delivery"
            className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"
          >
            {t("tabDelivery")}
          </TabsTrigger>
          <TabsTrigger
            value="segmentation"
            className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"
          >
            {t("tabSegmentation")}
          </TabsTrigger>
          <TabsTrigger
            value="health-check"
            className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"
          >
            {t("tabHealthCheck")}
          </TabsTrigger>
          <TabsTrigger
            value="cohorts"
            className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"
          >
            {t("tabCohorts")}
          </TabsTrigger>
          <div
            className="absolute bottom-0 h-0.5 bg-[var(--foreground)] transition-all duration-300 ease-in-out z-0"
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        </TabsList>

        <TabsContent value="data-quality">
          <DataQualityTab
            customerId={cid}
            outletIds={outletIds}
            startDate={startDate}
            endDate={endDate}
            active={ready && activeTab === "data-quality"}
          />
        </TabsContent>
        <TabsContent value="outliers">
          <OutlierTab
            customerId={cid}
            outletIds={outletIds}
            startDate={startDate}
            endDate={endDate}
            active={ready && activeTab === "outliers"}
          />
        </TabsContent>
        <TabsContent value="patterns">
          <PatternsTab
            customerId={cid}
            outletIds={outletIds}
            startDate={startDate}
            endDate={endDate}
            active={ready && activeTab === "patterns"}
          />
        </TabsContent>
        <TabsContent value="delivery">
          <DeliveryTab
            customerId={cid}
            outletIds={outletIds}
            startDate={startDate}
            endDate={endDate}
            active={ready && activeTab === "delivery"}
          />
        </TabsContent>
        <TabsContent value="segmentation">
          <SegmentationTab
            customerId={cid}
            outletIds={outletIds}
            startDate={startDate}
            endDate={endDate}
            active={ready && activeTab === "segmentation"}
          />
        </TabsContent>
        <TabsContent value="health-check">
          <HealthCheckTab
            customerId={cid}
            outletIds={outletIds}
            active={ready && activeTab === "health-check"}
          />
        </TabsContent>
        <TabsContent value="cohorts">
          <CohortTab
            customerId={cid}
            active={!!cid && activeTab === "cohorts"}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
