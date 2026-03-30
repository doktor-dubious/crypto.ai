"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { Badge } from "@/components/ui/badge"
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart"
import { BarChart, Bar, CartesianGrid, XAxis, YAxis } from "recharts"
import { analysisApi } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Props {
  customerId: string
  outletIds: string[]
  startDate: string
  endDate: string
  active: boolean
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const profileConfig: ChartConfig = {
  value: { label: "Weight", color: "hsl(217 91% 60%)" },
}

const cvConfig: ChartConfig = {
  cv: { label: "CV", color: "hsl(38 92% 50%)" },
}

const ITEMS_PER_PAGE = 10

export function SegmentationTab({ customerId, outletIds, startDate, endDate, active }: Props) {
  const t = useTranslations("salesAnalysis")
  const [predPage, setPredPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ["analysis-segmentation", customerId, outletIds, startDate, endDate],
    queryFn: () => analysisApi.segmentation({
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
    <div className="flex flex-col gap-6 pt-4">
      {/* Seasonal Clusters */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("seasonalClusters")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("seasonalClustersDesc")}</p>
        {data.seasonal_clusters.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("noClusters")}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.seasonal_clusters.map((cluster) => (
              <div key={cluster.cluster_id} className="border border-[var(--border)] rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium">{t("cluster")} {cluster.cluster_id + 1}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {cluster.outlet_ids.length} {t("outlets")}
                  </Badge>
                </div>
                <ChartContainer config={profileConfig} className="h-32 w-full mb-2">
                  <BarChart
                    data={cluster.cluster_profile.map((v, i) => ({
                      day: WEEKDAY_LABELS[i],
                      value: parseFloat((v * 100).toFixed(1)),
                    }))}
                    margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                  >
                    <XAxis dataKey="day" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={32} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="value" fill={profileConfig.value.color} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
                <div className="text-[10px] text-[var(--muted-foreground)] max-h-16 overflow-y-auto">
                  {cluster.outlet_names.slice(0, 10).join(", ")}
                  {cluster.outlet_names.length > 10 && ` +${cluster.outlet_names.length - 10} more`}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Predictability */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("predictability")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("predictabilityDesc")}</p>

        {/* Summary counts */}
        <div className="flex items-center gap-4 mb-3 text-xs">
          {(["easy", "moderate", "hard"] as const).map((d) => {
            const count = data.predictability.filter((p) => p.difficulty === d).length
            return (
              <div key={d} className="flex items-center gap-1.5">
                <Badge
                  variant={d === "easy" ? "default" : d === "moderate" ? "secondary" : "destructive"}
                  className="text-[10px]"
                >
                  {t(d)}
                </Badge>
                <span className="tabular-nums">{count}</span>
              </div>
            )
          })}
        </div>

        {/* CV Distribution chart */}
        {data.predictability.length > 0 && (
          <ChartContainer config={cvConfig} className="h-48 w-full mb-4">
            <BarChart
              data={data.predictability.slice(0, 40).map((p) => ({
                name: p.ext_id,
                cv: p.cv,
                fill: p.difficulty === "easy"
                  ? "hsl(142 76% 36%)"
                  : p.difficulty === "moderate" ? "hsl(38 92% 50%)" : "hsl(0 72% 51%)",
              }))}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 8 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="cv" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}

        {data.predictability.length > 0 && (
          <>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("accountId")}</TableHead>
                    <TableHead className="text-xs">{t("outlet")}</TableHead>
                    <TableHead className="text-xs text-right">{t("cv")}</TableHead>
                    <TableHead className="text-xs">{t("difficulty")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.predictability
                    .slice((predPage - 1) * ITEMS_PER_PAGE, predPage * ITEMS_PER_PAGE)
                    .map((row) => (
                      <TableRow key={row.outlet_id}>
                        <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                        <TableCell className="text-xs">{row.outlet_name}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.cv}</TableCell>
                        <TableCell className="text-xs">
                          <Badge
                            variant={row.difficulty === "hard" ? "destructive" : row.difficulty === "moderate" ? "secondary" : "default"}
                            className="text-[10px]"
                          >
                            {t(row.difficulty)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar page={predPage} setPage={setPredPage} totalItems={data.predictability.length} />
          </>
        )}
      </section>

      {/* Correlation Clusters */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("correlationClusters")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("correlationClustersDesc")}</p>
        {data.correlation_clusters.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("noCorrelation")}</div>
        ) : (
          <div className="space-y-3">
            {data.correlation_clusters.map((cluster) => (
              <div key={cluster.cluster_id} className="border border-[var(--border)] rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-medium">{t("cluster")} {cluster.cluster_id}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {cluster.outlet_ids.length} {t("outlets")}
                  </Badge>
                  <span className="text-xs text-[var(--muted-foreground)] ml-auto">
                    {t("avgCorrelation")}: <span className="tabular-nums font-medium">{cluster.avg_correlation}</span>
                  </span>
                </div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {cluster.outlet_names.slice(0, 15).join(", ")}
                  {cluster.outlet_names.length > 15 && ` +${cluster.outlet_names.length - 15} more`}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
