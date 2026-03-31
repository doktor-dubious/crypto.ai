"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { Info, ExternalLink } from "lucide-react"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { healthCheckApi } from "@/lib/api"
import { cn } from "@/lib/utils"

const ITEMS_PER_PAGE = 10

interface Props {
  customerId: string
  outletIds: string[]
  active: boolean
}

export function HealthCheckTab({ customerId, outletIds, active }: Props) {
  const t = useTranslations("salesAnalysis")
  const router = useRouter()
  const [deadPage, setDeadPage] = useState(1)
  const [selectedDead, setSelectedDead] = useState<{ ext_id: string; name: string; last_sale_date: string; days_since_last_sale: number } | null>(null)
  const [selectedVolume, setSelectedVolume] = useState<{ ext_id: string; name: string; total_sold: number; pct_of_total: number } | null>(null)
  const [selectedDupOutlet, setSelectedDupOutlet] = useState<{ name: string; ext_id?: string } | null>(null)
  const [volumePage, setVolumePage] = useState(1)
  const [enginePage, setEnginePage] = useState(1)

  const { data, isLoading, error } = useQuery({
    queryKey: ["health-check", customerId, outletIds],
    queryFn: () => healthCheckApi.get(customerId, outletIds),
    enabled: active && !!customerId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-[var(--muted-foreground)]">
        {t("loading")}
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-red-500">
        {error.message}
      </div>
    )
  }
  if (!data) return null

  const { coverage, structural, viability } = data

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex flex-col gap-6 pt-4">
      {/* Overall Status */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-medium">{t("healthStatus")}</h3>
          <StatusBadge status={viability.overall_status} t={t} />
        </div>
      </section>

      {/* Data Coverage */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("healthCoverage")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthCoverageDesc")}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MetricCard
            label={t("healthCoverageRatio")}
            value={`${(coverage.coverage_ratio * 100).toFixed(1)}%`}
            sublabel={t("healthCoverageRatioDesc", { days: coverage.min_history_threshold_days })}
          />
          <MetricCard
            label={t("healthOutletsWithSales")}
            value={`${coverage.outlets_with_sales} / ${coverage.total_outlets}`}
          />
          <MetricCard
            label={t("healthOutletsWithEnough")}
            value={`${coverage.outlets_with_enough_history} / ${coverage.total_outlets}`}
          />
          <MetricCard
            label={t("healthMedianHistory")}
            value={coverage.median_history_days != null
              ? t("healthMedianHistoryDays", { days: coverage.median_history_days })
              : "\u2014"}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MetricCard
            label={t("healthDateRange")}
            value={coverage.date_range.earliest && coverage.date_range.latest
              ? `${coverage.date_range.earliest} \u2013 ${coverage.date_range.latest}`
              : "\u2014"}
          />
          <MetricCard
            label={t("healthDateAlignment")}
            info={t("healthDateAlignmentDesc")}
            value={coverage.date_alignment_std_days != null
              ? t("healthDateAlignmentDays", { days: coverage.date_alignment_std_days })
              : "\u2014"}
            sublabel={coverage.date_alignment_std_days != null
              ? (coverage.date_alignment_std_days < 30
                ? t("healthDateAlignmentGood")
                : t("healthDateAlignmentPoor"))
              : undefined}
            warn={coverage.date_alignment_std_days != null && coverage.date_alignment_std_days >= 30}
          />
          <MetricCard
            label={t("healthDaysSinceLastSale")}
            value={coverage.days_since_last_sale != null
              ? t("healthDaysSinceLastSaleDays", { days: coverage.days_since_last_sale })
              : "\u2014"}
            warn={coverage.days_since_last_sale != null && coverage.days_since_last_sale > 14}
          />
          <MetricCard
            label={t("healthTotalRecords")}
            value={coverage.total_sales_records.toLocaleString()}
          />
        </div>

        {/* Field Availability */}
        <h4 className="text-xs font-medium mb-2 mt-4">{t("healthFieldAvailability")}</h4>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthFieldAvailabilityDesc")}</p>
        <div className="grid grid-cols-3 gap-4">
          <FieldBar label={t("healthDelivered")} pct={coverage.pct_records_with_delivered} />
          <FieldBar label={t("healthScanSold")} pct={coverage.pct_records_with_scan_sold} />
          <FieldBar label={t("healthNetSold")} pct={coverage.pct_records_with_net_sold} />
        </div>
      </section>

      {/* Structural Flags */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("healthStructural")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthStructuralDesc")}</p>

        {/* Dead Outlets */}
        <h4 className="text-xs font-medium mb-2">{t("healthDeadOutlets")}</h4>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthDeadOutletsDesc")}</p>
        {structural.dead_outlets.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("healthNoDeadOutlets")}</div>
        ) : (
          <>
          <div className="border border-[var(--border)] rounded-lg overflow-hidden mb-4">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">{t("accountId")}</TableHead>
                  <TableHead className="text-xs">{t("outlet")}</TableHead>
                  <TableHead className="text-xs text-right">{t("healthLastSale")}</TableHead>
                  <TableHead className="text-xs text-right">{t("healthDaysAgo", { days: "" }).trim()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {structural.dead_outlets
                  .slice((deadPage - 1) * ITEMS_PER_PAGE, deadPage * ITEMS_PER_PAGE)
                  .map((o) => (
                  <TableRow
                    key={o.outlet_id}
                    className="cursor-pointer"
                    onClick={() => setSelectedDead(o)}
                  >
                    <TableCell className="text-xs font-mono">{o.ext_id}</TableCell>
                    <TableCell className="text-xs">{o.name}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{o.last_sale_date}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-red-500">
                      {t("healthDaysAgo", { days: o.days_since_last_sale })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar page={deadPage} setPage={setDeadPage} totalItems={structural.dead_outlets.length} />
          </>
        )}

        {/* Duplicate Detection */}
        <h4 className="text-xs font-medium mb-2 mt-4">{t("healthDuplicates")}</h4>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthDuplicatesDesc")}</p>
        {structural.duplicate_groups.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("healthNoDuplicates")}</div>
        ) : (
          <div className="flex flex-col gap-2 mb-4">
            {structural.duplicate_groups.map((g, i) => (
              <div key={i} className="border border-[var(--border)] rounded-lg p-3">
                <div className="flex flex-wrap gap-2">
                  {g.names.map((name, j) => (
                    <Badge
                      key={j}
                      variant="secondary"
                      className="text-xs cursor-pointer hover:bg-[var(--accent)]"
                      onClick={() => setSelectedDupOutlet({ name, ext_id: undefined })}
                    >
                      {name}
                    </Badge>
                  ))}
                </div>
                {g.addresses.some(Boolean) && (
                  <div className="text-[10px] text-[var(--muted-foreground)] mt-1.5">
                    {g.addresses.filter(Boolean).join(" | ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Volume Distribution */}
        <h4 className="text-xs font-medium mb-2 mt-4">{t("healthVolumeDistribution")}</h4>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthVolumeDistributionDesc")}</p>
        <div className="mb-4">
          <MetricCard
            label={t("healthTop10Pct")}
            value={`${structural.volume_top10_pct}%`}
            warn={structural.volume_top10_pct >= 80}
          />
          {structural.volume_top10_outlets.length > 0 && (<>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden mt-3">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("accountId")}</TableHead>
                    <TableHead className="text-xs">{t("outlet")}</TableHead>
                    <TableHead className="text-xs text-right">{t("healthPctOfTotal")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {structural.volume_top10_outlets
                    .slice((volumePage - 1) * ITEMS_PER_PAGE, volumePage * ITEMS_PER_PAGE)
                    .map((o) => (
                    <TableRow
                      key={o.outlet_id}
                      className="cursor-pointer"
                      onClick={() => setSelectedVolume(o)}
                    >
                      <TableCell className="text-xs font-mono">{o.ext_id}</TableCell>
                      <TableCell className="text-xs">{o.name}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{o.pct_of_total}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar page={volumePage} setPage={setVolumePage} totalItems={structural.volume_top10_outlets.length} />
          </>)}
        </div>

        {/* Delivery Config Coverage */}
        <h4 className="text-xs font-medium mb-2 mt-4">{t("healthDeliveryConfig")}</h4>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthDeliveryConfigDesc")}</p>
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label={t("healthWithConfig")}
            value={`${structural.outlets_with_delivery_config}`}
            sublabel={`${structural.delivery_config_coverage}%`}
          />
          <MetricCard
            label={t("healthWithoutConfig")}
            value={`${structural.outlets_without_delivery_config}`}
            warn={structural.outlets_without_delivery_config > 0}
          />
        </div>
      </section>

      {/* Engine Readiness */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("healthViability")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthViabilityDesc")}</p>
        {viability.engine_readiness.length > 0 && (<>
          <div className="border border-[var(--border)] rounded-lg overflow-hidden mb-4">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">{t("healthEngine")}</TableHead>
                  <TableHead className="text-xs text-right">{t("healthMinHistory")}</TableHead>
                  <TableHead className="text-xs text-right">{t("healthQualifying")}</TableHead>
                  <TableHead className="text-xs text-right">{t("healthPctQualifying")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viability.engine_readiness
                  .slice((enginePage - 1) * ITEMS_PER_PAGE, enginePage * ITEMS_PER_PAGE)
                  .map((e) => (
                  <TableRow key={e.engine}>
                    <TableCell className="text-xs font-mono">{e.engine}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{e.min_history}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {e.qualifying_outlets} / {e.total_outlets}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      <span className={e.pct_qualifying < 50 ? "text-amber-500" : undefined}>
                        {e.pct_qualifying}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar page={enginePage} setPage={setEnginePage} totalItems={viability.engine_readiness.length} />
        </>)}

        {/* Aggregate CV */}
        <h4 className="text-xs font-medium mb-2 mt-4">{t("healthAggregateCV")}</h4>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("healthAggregateCVDesc")}</p>
        {viability.aggregate_cv != null ? (
          <MetricCard
            label={t("healthAggregateCV")}
            value={viability.aggregate_cv.toFixed(4)}
            sublabel={
              viability.aggregate_cv < 0.5 ? t("healthAggregateCVLow")
                : viability.aggregate_cv < 1.5 ? t("healthAggregateCVModerate")
                : t("healthAggregateCVHigh")
            }
            warn={viability.aggregate_cv >= 1.5}
          />
        ) : (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("noData")}</div>
        )}
      </section>

      {/* Dead outlet modal */}
      <Dialog open={!!selectedDead} onOpenChange={(open) => { if (!open) setSelectedDead(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{selectedDead?.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{selectedDead?.ext_id}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">{t("healthLastSale")}</span>
              <span className="tabular-nums">{selectedDead?.last_sale_date}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">{t("healthDaysAgo", { days: "" }).trim()}</span>
              <span className="tabular-nums text-red-500">{selectedDead?.days_since_last_sale}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (selectedDead) router.push(`/outlets?search=${encodeURIComponent(selectedDead.ext_id)}`)
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("openOutlet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Volume outlet modal */}
      <Dialog open={!!selectedVolume} onOpenChange={(open) => { if (!open) setSelectedVolume(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{selectedVolume?.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{selectedVolume?.ext_id}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">{t("healthTotalSold")}</span>
              <span className="tabular-nums font-medium">{selectedVolume?.total_sold.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">{t("healthPctOfTotal")}</span>
              <span className="tabular-nums">{selectedVolume?.pct_of_total}%</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (selectedVolume) router.push(`/outlets?search=${encodeURIComponent(selectedVolume.ext_id)}`)
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("openOutlet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate outlet modal */}
      <Dialog open={!!selectedDupOutlet} onOpenChange={(open) => { if (!open) setSelectedDupOutlet(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{selectedDupOutlet?.name}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (selectedDupOutlet) router.push(`/outlets?search=${encodeURIComponent(selectedDupOutlet.name)}`)
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("openOutlet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const variants: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
    healthy: "default",
    warning: "secondary",
    critical: "destructive",
    no_data: "outline",
  }
  const labels: Record<string, string> = {
    healthy: t("healthStatusHealthy"),
    warning: t("healthStatusWarning"),
    critical: t("healthStatusCritical"),
    no_data: t("healthStatusNoData"),
  }
  return (
    <Badge variant={variants[status] ?? "outline"}>
      {labels[status] ?? status}
    </Badge>
  )
}

function MetricCard({ label, value, sublabel, warn, info }: {
  label: string
  value: string
  sublabel?: string
  warn?: boolean
  info?: string
}) {
  return (
    <div className="border border-[var(--border)] rounded-lg p-3">
      <div className="text-[10px] text-[var(--muted-foreground)] mb-1 inline-flex items-center gap-1">
        {label}
        {info && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-[var(--muted-foreground)] cursor-help shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {info}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className={`text-sm font-medium tabular-nums ${warn ? "text-amber-500" : ""}`}>
        {value}
      </div>
      {sublabel && (
        <div className={`text-[10px] mt-0.5 ${warn ? "text-amber-500" : "text-[var(--muted-foreground)]"}`}>
          {sublabel}
        </div>
      )}
    </div>
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

function FieldBar({ label, pct }: { label: string; pct: number }) {
  const width = Math.min(100, Math.max(0, pct))
  const color = pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="border border-[var(--border)] rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono text-[var(--muted-foreground)]">{label}</span>
        <span className="text-xs tabular-nums font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 bg-[var(--muted)] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
