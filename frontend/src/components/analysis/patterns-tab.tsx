"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { TrendingUp, TrendingDown, Minus, Info, ExternalLink } from "lucide-react"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart"
import {
  LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis, ReferenceLine,
} from "recharts"
import { analysisApi, type WeekdayEffectOutlet } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Props {
  customerId: string
  outletIds: string[]
  startDate: string
  endDate: string
  active: boolean
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const trendConfig: ChartConfig = {
  value: { label: "Sales", color: "hsl(217 91% 60%)" },
  trend_value: { label: "Trend", color: "hsl(0 72% 51%)" },
}

const weekdayConfig: ChartConfig = {
  avg_value: { label: "Avg Sales", color: "hsl(217 91% 60%)" },
}

const yearlyConfig: ChartConfig = {
  value: { label: "Seasonal Effect", color: "hsl(142 76% 36%)" },
}

const ITEMS_PER_PAGE = 10

export function PatternsTab({ customerId, outletIds, startDate, endDate, active }: Props) {
  const t = useTranslations("salesAnalysis")
  const router = useRouter()
  const [wdPage, setWdPage] = useState(1)
  const [divPage, setDivPage] = useState(1)
  const [selectedWdOutlet, setSelectedWdOutlet] = useState<WeekdayEffectOutlet | null>(null)
  const [selectedDivOutlet, setSelectedDivOutlet] = useState<{ outlet_id: string; outlet_name: string; ext_id: string; outlet_slope: number; aggregate_slope: number; divergence: number } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["analysis-patterns", customerId, outletIds, startDate, endDate],
    queryFn: () => analysisApi.patterns({
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

  const { trend, changepoints, seasonality, weekday_effects, divergent_outlets } = data
  const TrendIcon = trend.direction === "increasing" ? TrendingUp
    : trend.direction === "decreasing" ? TrendingDown : Minus

  return (
    <div className="flex flex-col gap-6 pt-4">
      {/* General Trend */}
      <section>
        <h3 className="text-sm font-medium mb-3">{t("generalTrend")}</h3>
        <div className="flex items-center gap-6 mb-4 text-xs">
          <div className="flex items-center gap-1.5">
            <TrendIcon className="h-4 w-4" />
            <span className="font-medium">{t(trend.direction)}</span>
          </div>
          <div><span className="text-[var(--muted-foreground)]">{t("slopePerWeek")}:</span> {trend.slope_per_week}</div>
          <div><span className="text-[var(--muted-foreground)]">{t("rSquared")}:</span> {trend.r_squared}</div>
        </div>

        {trend.weekly_data.length > 0 && (
          <ChartContainer config={trendConfig} className="h-72 w-full">
            <LineChart data={trend.weekly_data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={56} />
              <ChartTooltip content={<ChartTooltipContent hideIndicator labelKey="date" formatter={(v) => Number(v).toLocaleString()} />} />
              {changepoints.map((cp) => (
                <ReferenceLine
                  key={cp.date}
                  x={cp.date}
                  stroke="hsl(38 92% 50%)"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                />
              ))}
              <Line
                type="monotone"
                dataKey="value"
                stroke={trendConfig.value.color}
                strokeWidth={1.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="trend_value"
                stroke={trendConfig.trend_value.color}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </section>

      {/* Changepoints */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("changepoints")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("changepointsDesc")}</p>
        {changepoints.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("noChangepoints")}</div>
        ) : (
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">{t("date")}</TableHead>
                  <TableHead className="text-xs text-right">{t("beforeAfter")}</TableHead>
                  <TableHead className="text-xs text-right">{t("changePct")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changepoints.map((cp) => (
                  <TableRow key={cp.date}>
                    <TableCell className="text-xs">{cp.date}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {cp.before_mean.toLocaleString()} &rarr; {cp.after_mean.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {cp.magnitude_pct > 0 ? "+" : ""}{cp.magnitude_pct}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Weekly Profile */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("weeklyProfile")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("weeklyProfileDesc")}</p>
        <div className="flex items-center gap-4 mb-4 text-xs">
          <span className="text-[var(--muted-foreground)]">{t("weeklyStrength")}:</span>
          <span className="tabular-nums font-medium">{(seasonality.weekly_strength * 100).toFixed(1)}%</span>
          <Badge variant={seasonality.has_weekly ? "default" : "secondary"} className="text-[10px]">
            {seasonality.has_weekly ? t("detected") : t("notDetected")}
          </Badge>
        </div>
        <ChartContainer config={weekdayConfig} className="h-48 w-full max-w-md">
          <BarChart
            data={seasonality.weekly_profile.map((p) => ({
              ...p,
              label: WEEKDAY_LABELS[p.weekday - 1] ?? `D${p.weekday}`,
            }))}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
            <ChartTooltip content={<ChartTooltipContent hideIndicator formatter={(v) => Number(v).toLocaleString()} />} />
            <Bar dataKey="avg_value" fill={weekdayConfig.avg_value.color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </section>

      {/* Seasonality (yearly) */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("seasonality")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">
          {t("seasonalityDescPrefix")}{" "}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="underline decoration-dotted cursor-help">{t("stlDecomposition")}</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {t("stlTooltip")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {" "}{t("seasonalityDescSuffix")}
        </p>
        <div className="flex items-center gap-4 mb-4 text-xs">
          <Badge variant={seasonality.has_yearly ? "default" : "secondary"} className="text-[10px]">
            {seasonality.has_yearly ? t("detected") : t("notDetected")}
          </Badge>
          {seasonality.yearly_strength != null && seasonality.has_yearly && (
            <span>
              <span className="text-[var(--muted-foreground)]">{t("weeklyStrength")}:</span>{" "}
              <span className="tabular-nums font-medium">{(seasonality.yearly_strength * 100).toFixed(1)}%</span>
            </span>
          )}
          {!seasonality.has_yearly && (
            <span className="text-[var(--muted-foreground)]">{t("seasonalityNotEnoughData")}</span>
          )}
        </div>
        {seasonality.yearly_profile.length > 0 && (
          <ChartContainer config={yearlyConfig} className="h-56 w-full">
            <LineChart
              data={seasonality.yearly_profile}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(w: number) => MONTH_LABELS[Math.min(Math.floor((w - 1) / (52 / 12)), 11)]}
                interval={3}
              />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={56} />
              <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
              <ChartTooltip content={<ChartTooltipContent hideIndicator labelFormatter={(_v, payload) => {
                const w = (payload[0]?.payload as Record<string, unknown>)?.week as number | undefined
                if (w == null) return ""
                const month = MONTH_LABELS[Math.min(Math.floor((w - 1) / (52 / 12)), 11)]
                return `Week ${w} (${month})`
              }} />} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={yearlyConfig.value.color}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </section>

      {/* Weekday Effects by Outlet */}
      {weekday_effects.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <section>
            <h3 className="text-sm font-medium mb-2">{t("weekdayEffects")}</h3>
            <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("weekdayEffectsDesc")}</p>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("accountId")}</TableHead>
                    <TableHead className="text-xs">{t("outlet")}</TableHead>
                    <TableHead className="text-xs text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        {t("effectStrength")}
                        <InfoIcon text={t("fStatisticTooltip")} />
                      </span>
                    </TableHead>
                    {WEEKDAY_LABELS.map((d) => (
                      <TableHead key={d} className="text-xs text-right">{t(d.toLowerCase())}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weekday_effects
                    .slice((wdPage - 1) * ITEMS_PER_PAGE, wdPage * ITEMS_PER_PAGE)
                    .map((row) => (
                      <TableRow
                        key={row.outlet_id}
                        className="cursor-pointer"
                        onClick={() => setSelectedWdOutlet(row)}
                      >
                        <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                        <TableCell className="text-xs">{row.outlet_name}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.effect_strength}</TableCell>
                        {row.weekday_means.map((v, i) => (
                          <TableCell key={i} className="text-xs text-right tabular-nums">{v}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar page={wdPage} setPage={setWdPage} totalItems={weekday_effects.length} />

            {/* Weekday effect outlet modal */}
            <Dialog open={!!selectedWdOutlet} onOpenChange={(open) => { if (!open) setSelectedWdOutlet(null) }}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-base">{selectedWdOutlet?.outlet_name}</DialogTitle>
                  <DialogDescription className="font-mono text-xs">{selectedWdOutlet?.ext_id}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("effectStrength")}</span>
                    <span className="tabular-nums font-medium">{selectedWdOutlet?.effect_strength}</span>
                  </div>
                  {selectedWdOutlet && WEEKDAY_LABELS.map((d, i) => (
                    <div key={d} className="flex items-center justify-between">
                      <span className="text-[var(--muted-foreground)]">{t(d.toLowerCase())}</span>
                      <span className="tabular-nums">{selectedWdOutlet.weekday_means[i]}</span>
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      if (selectedWdOutlet) {
                        router.push(`/outlets?search=${encodeURIComponent(selectedWdOutlet.ext_id)}`)
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("openOutlet")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>
        </TooltipProvider>
      )}

      {/* Divergent Outlets */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("divergentOutlets")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("divergentOutletsDesc")}</p>
        {divergent_outlets.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("noDivergent")}</div>
        ) : (
          <>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("accountId")}</TableHead>
                    <TableHead className="text-xs">{t("outlet")}</TableHead>
                    <TableHead className="text-xs text-right">{t("outletSlope")}</TableHead>
                    <TableHead className="text-xs text-right">{t("aggSlope")}</TableHead>
                    <TableHead className="text-xs text-right">{t("divergence")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {divergent_outlets
                    .slice((divPage - 1) * ITEMS_PER_PAGE, divPage * ITEMS_PER_PAGE)
                    .map((row) => (
                      <TableRow
                        key={row.outlet_id}
                        className="cursor-pointer"
                        onClick={() => setSelectedDivOutlet(row)}
                      >
                        <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                        <TableCell className="text-xs">{row.outlet_name}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.outlet_slope}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.aggregate_slope}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums font-medium">{row.divergence}x</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar page={divPage} setPage={setDivPage} totalItems={divergent_outlets.length} />

            {/* Divergent outlet modal */}
            <Dialog open={!!selectedDivOutlet} onOpenChange={(open) => { if (!open) setSelectedDivOutlet(null) }}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-base">{selectedDivOutlet?.outlet_name}</DialogTitle>
                  <DialogDescription className="font-mono text-xs">{selectedDivOutlet?.ext_id}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("outletSlope")}</span>
                    <span className="tabular-nums font-medium">{selectedDivOutlet?.outlet_slope}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("aggSlope")}</span>
                    <span className="tabular-nums">{selectedDivOutlet?.aggregate_slope}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("divergence")}</span>
                    <span className="tabular-nums font-medium">{selectedDivOutlet?.divergence}x</span>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      if (selectedDivOutlet) {
                        router.push(`/outlets?search=${encodeURIComponent(selectedDivOutlet.ext_id)}`)
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("openOutlet")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </section>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function buildPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function PaginationBar(
  { page, setPage, totalItems }: { page: number; setPage: (p: number) => void; totalItems: number },
) {
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE))
  if (totalPages <= 1) return null
  const safePage = Math.min(page, totalPages)
  const pages = buildPages(safePage, totalPages)

  return (
    <div className="flex justify-center py-2">
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => setPage(Math.max(1, safePage - 1))}
              className={cn("cursor-pointer", safePage === 1 && "pointer-events-none opacity-50")}
            />
          </PaginationItem>
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <PaginationItem key={`e-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  onClick={() => setPage(p)}
                  isActive={p === safePage}
                  className="cursor-pointer"
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              className={cn("cursor-pointer", safePage === totalPages && "pointer-events-none opacity-50")}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
