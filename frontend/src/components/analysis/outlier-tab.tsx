"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Info, Sparkles, Loader2 } from "lucide-react"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ScatterChart, Scatter, CartesianGrid, XAxis, YAxis, ReferenceLine } from "recharts"
import { analysisApi, type DateOutlier, type RecurringDateOutlier } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Props {
  customerId: string
  outletIds: string[]
  startDate: string
  endDate: string
  active: boolean
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const scatterConfig: ChartConfig = {
  positive: { label: "Spike", color: "hsl(0 72% 51%)" },
  negative: { label: "Dip", color: "hsl(217 91% 60%)" },
}

const SUB_TAB_TRIGGER = "bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"

export function OutlierTab({ customerId, outletIds, startDate, endDate, active }: Props) {
  const t = useTranslations("salesAnalysis")
  const [subTab, setSubTab] = useState("recurring-sales")
  const subTabsRef = useRef<HTMLDivElement>(null)
  const [subIndicator, setSubIndicator] = useState({ left: 0, width: 0 })

  useEffect(() => {
    if (!subTabsRef.current) return
    const el = subTabsRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setSubIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [subTab])

  const { data, isLoading } = useQuery({
    queryKey: ["analysis-outliers", customerId, outletIds, startDate, endDate],
    queryFn: () => analysisApi.outliers({
      customer_id: customerId, outlet_ids: outletIds,
      start_date: startDate, end_date: endDate,
    }),
    enabled: active,
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-[var(--muted-foreground)]">
        {t("loading")}
      </div>
    )
  }
  if (!data) return null

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-4 pt-4">
        <Tabs value={subTab} onValueChange={setSubTab}>
          <TabsList
            ref={subTabsRef}
            className="w-full bg-transparent border-b border-[var(--border)] rounded-none p-0 h-auto flex relative"
          >
            <TabsTrigger value="recurring-sales" className={SUB_TAB_TRIGGER}>{t("recurringSales")}</TabsTrigger>
            <TabsTrigger value="non-recurring-sales" className={SUB_TAB_TRIGGER}>{t("nonRecurringSales")}</TabsTrigger>
            <TabsTrigger value="recurring-delivery" className={SUB_TAB_TRIGGER}>{t("recurringDelivery")}</TabsTrigger>
            <TabsTrigger value="non-recurring-delivery" className={SUB_TAB_TRIGGER}>{t("nonRecurringDelivery")}</TabsTrigger>
            <div
              className="absolute bottom-0 h-0.5 bg-[var(--foreground)] transition-all duration-300 ease-in-out z-0"
              style={{ left: subIndicator.left, width: subIndicator.width }}
            />
          </TabsList>

        <TabsContent value="recurring-sales">
          <SectionHeader title={t("recurringSales")} desc={t("recurringSalesDesc")} />
          <RecurringTable items={data.recurring_sales} t={t} customerId={customerId} outletIds={outletIds} />
        </TabsContent>

        <TabsContent value="non-recurring-sales">
          <SectionHeader title={t("nonRecurringSales")} desc={t("nonRecurringSalesDesc")} />
          <OutlierScatter items={data.non_recurring_sales} />
          <OutlierTable items={data.non_recurring_sales} t={t} />
        </TabsContent>

        <TabsContent value="recurring-delivery">
          <SectionHeader title={t("recurringDelivery")} desc={t("recurringDeliveryDesc")} />
          <RecurringTable items={data.recurring_delivery} t={t} customerId={customerId} outletIds={outletIds} />
        </TabsContent>

        <TabsContent value="non-recurring-delivery">
          <SectionHeader title={t("nonRecurringDelivery")} desc={t("nonRecurringDeliveryDesc")} />
          <OutlierScatter items={data.non_recurring_delivery} />
          <OutlierTable items={data.non_recurring_delivery} t={t} />
        </TabsContent>
      </Tabs>
    </div>
    </TooltipProvider>
  )
}

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

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-4">
      <p className="text-xs text-[var(--muted-foreground)]">{desc}</p>
    </div>
  )
}

function RecurringTable(
  { items, t, customerId, outletIds }: {
    items: RecurringDateOutlier[]
    t: (key: string) => string
    customerId: string
    outletIds: string[]
  },
) {
  const [investigating, setInvestigating] = useState<RecurringDateOutlier | null>(null)
  const [aiResponse, setAiResponse] = useState("")
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const responseRef = useRef<HTMLDivElement>(null)

  const doInvestigate = useCallback(async (row: RecurringDateOutlier) => {
    setInvestigating(row)
    setAiResponse("")
    setAiError(null)
    setAiLoading(true)
    try {
      await analysisApi.investigateOutlier(
        {
          customer_id: customerId,
          outlet_ids: outletIds,
          month: row.month,
          day: row.day,
          years: row.years,
          direction: row.direction,
        },
        (chunk) => {
          setAiResponse((prev) => prev + chunk)
        },
      )
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Investigation failed")
    } finally {
      setAiLoading(false)
    }
  }, [customerId, outletIds])

  // Auto-scroll as response streams in
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight
    }
  }, [aiResponse])

  if (items.length === 0) {
    return <div className="text-xs text-[var(--muted-foreground)] py-8 text-center">{t("noOutliers")}</div>
  }
  return (
    <>
      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">{t("month")}</TableHead>
              <TableHead className="text-xs">{t("day")}</TableHead>
              <TableHead className="text-xs">{t("years")}</TableHead>
              <TableHead className="text-xs text-right">
                <span className="inline-flex items-center gap-1 justify-end">
                  {t("zScore")}
                  <InfoIcon text={t("zScoreTooltip")} />
                </span>
              </TableHead>
              <TableHead className="text-xs">{t("direction")}</TableHead>
              <TableHead className="text-xs">{t("padStatus")}</TableHead>
              <TableHead className="text-xs w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs">{MONTH_NAMES[row.month]}</TableCell>
                <TableCell className="text-xs tabular-nums">{row.day}</TableCell>
                <TableCell className="text-xs tabular-nums">{row.years.join(", ")}</TableCell>
                <TableCell className="text-xs text-right tabular-nums">{row.avg_z_score}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant={row.direction === "positive" ? "destructive" : "secondary"} className="text-[10px]">
                    {t(row.direction)}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {row.is_registered_pad ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-600">
                      {row.pad_name ?? t("registered")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">
                      {t("unregistered")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs px-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 cursor-pointer"
                    title={t("investigate")}
                    onClick={() => doInvestigate(row)}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* AI Investigation modal */}
      <Dialog open={!!investigating} onOpenChange={(open) => { if (!open) setInvestigating(null) }}>
        <DialogContent className="sm:max-w-xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {t("investigateTitle")}
            </DialogTitle>
            <DialogDescription>
              {investigating && `${MONTH_NAMES[investigating.month]} ${investigating.day} (${investigating.years.join(", ")}) — ${t(investigating.direction)}`}
            </DialogDescription>
          </DialogHeader>
          <div
            ref={responseRef}
            className="text-sm leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-[50vh] pr-2"
          >
            {aiLoading && !aiResponse && (
              <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("investigateLoading")}
              </div>
            )}
            {aiResponse}
            {aiLoading && aiResponse && (
              <span className="inline-block ml-1 w-2 h-4 bg-[var(--foreground)] animate-pulse" />
            )}
            {aiError && (
              <div className="text-red-500 mt-2">{aiError}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function OutlierScatter({ items }: { items: DateOutlier[] }) {
  if (items.length === 0) return null
  const chartData = items.map((o) => ({
    date: o.date,
    z_score: o.z_score,
    value: o.value,
    fill: o.direction === "positive" ? scatterConfig.positive.color : scatterConfig.negative.color,
  }))

  return (
    <ChartContainer config={scatterConfig} className="h-64 w-full mb-4">
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => {
            const d = new Date(v + "T00:00:00")
            return `${d.getMonth() + 1}/${d.getDate()}`
          }}
        />
        <YAxis
          dataKey="z_score"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={48}
          label={{ value: "Z-Score", angle: -90, position: "insideLeft", style: { fontSize: 10 } }}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip content={<ChartTooltipContent hideIndicator labelKey="date" />} />
        <Scatter data={chartData} />
      </ScatterChart>
    </ChartContainer>
  )
}

function OutlierTable({ items, t }: { items: DateOutlier[]; t: (key: string) => string }) {
  if (items.length === 0) {
    return <div className="text-xs text-[var(--muted-foreground)] py-8 text-center">{t("noOutliers")}</div>
  }
  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs">{t("date")}</TableHead>
            <TableHead className="text-xs text-right">{t("value")}</TableHead>
            <TableHead className="text-xs text-right">{t("expected")}</TableHead>
            <TableHead className="text-xs text-right">{t("zScore")}</TableHead>
            <TableHead className="text-xs">{t("direction")}</TableHead>
            <TableHead className="text-xs">{t("padStatus")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.slice(0, 50).map((row) => (
            <TableRow key={row.date}>
              <TableCell className="text-xs">{row.date}</TableCell>
              <TableCell className="text-xs text-right tabular-nums">{row.value.toLocaleString()}</TableCell>
              <TableCell className="text-xs text-right tabular-nums">{row.expected.toLocaleString()}</TableCell>
              <TableCell className={cn(
                "text-xs text-right tabular-nums",
                row.z_score > 0 ? "text-red-500" : "text-blue-500",
              )}>{row.z_score}</TableCell>
              <TableCell className="text-xs">
                <Badge variant={row.direction === "positive" ? "destructive" : "secondary"} className="text-[10px]">
                  {t(row.direction)}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">
                {row.is_pad_date ? (
                  <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-600">
                    {row.pad_name ?? t("registered")}
                  </Badge>
                ) : (
                  <span className="text-[var(--muted-foreground)]">{t("noPadMatch")}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
