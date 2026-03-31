"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { ExternalLink, ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
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

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const returnConfig: ChartConfig = {
  avg_return_pct: { label: "Return %", color: "hsl(0 72% 51%)" },
}

const soldOutConfig: ChartConfig = {
  sold_out_pct: { label: "Sold Out %", color: "hsl(38 92% 50%)" },
}

const ITEMS_PER_PAGE = 10

interface HighReturnOutlet {
  outlet_id: string
  ext_id: string
  outlet_name: string
  avg_return_pct: number
  days_with_data: number
}

interface SoldOutOutlet {
  outlet_id: string
  ext_id: string
  outlet_name: string
  sold_out_pct: number
  sold_out_days: number
  total_days: number
}

export function DeliveryTab({ customerId, outletIds, startDate, endDate, active }: Props) {
  const t = useTranslations("salesAnalysis")
  const router = useRouter()
  const [hrPage, setHrPage] = useState(1)
  const [soPage, setSoPage] = useState(1)
  const [fixedPage, setFixedPage] = useState(1)
  const [wdEffPage, setWdEffPage] = useState(1)
  const [selectedOutlet, setSelectedOutlet] = useState<HighReturnOutlet | null>(null)
  const [selectedSoldOut, setSelectedSoldOut] = useState<SoldOutOutlet | null>(null)
  const [selectedFixed, setSelectedFixed] = useState<{ outlet_id: string; ext_id: string; outlet_name: string; cv: number; sold_eq_delivered_pct: number; avg_sold: number } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["analysis-delivery", customerId, outletIds, startDate, endDate],
    queryFn: () => analysisApi.deliveryPerformance({
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
      {/* High Return Outlets */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("highReturn")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("highReturnDesc")}</p>
        {data.high_return.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("noHighReturn")}</div>
        ) : (
          <>
            <ChartContainer config={returnConfig} className="h-48 w-full mb-4">
              <BarChart
                data={data.high_return.slice(0, 20)}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                <XAxis
                  dataKey="outlet_name"
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 12) + "…" : v}
                />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
                <ChartTooltip content={<ChartTooltipContent hideIndicator labelFormatter={(_v, payload) => {
                  const name = (payload[0]?.payload as Record<string, unknown>)?.outlet_name as string | undefined
                  return name && name.length > 30 ? name.slice(0, 28) + "…" : name ?? ""
                }} />} />
                <Bar
                  dataKey="avg_return_pct"
                  fill={returnConfig.avg_return_pct.color}
                  radius={[4, 4, 0, 0]}
                  className="cursor-pointer"
                  onClick={(_d, idx) => {
                    const outlet = data.high_return.slice(0, 20)[idx]
                    if (outlet) setSelectedOutlet(outlet as HighReturnOutlet)
                  }}
                />
              </BarChart>
            </ChartContainer>

            {/* Outlet detail modal */}
            <Dialog open={!!selectedOutlet} onOpenChange={(open) => { if (!open) setSelectedOutlet(null) }}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-base">{selectedOutlet?.outlet_name}</DialogTitle>
                  <DialogDescription className="font-mono text-xs">{selectedOutlet?.ext_id}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("avgReturnPct")}</span>
                    <Badge variant="destructive">{selectedOutlet?.avg_return_pct}%</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("daysWithData")}</span>
                    <span className="tabular-nums">{selectedOutlet?.days_with_data}</span>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      if (selectedOutlet) {
                        router.push(`/outlets?search=${encodeURIComponent(selectedOutlet.ext_id)}`)
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("openOutlet")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("accountId")}</TableHead>
                    <TableHead className="text-xs">{t("outlet")}</TableHead>
                    <TableHead className="text-xs text-right">{t("avgReturnPct")}</TableHead>
                    <TableHead className="text-xs text-right">{t("daysWithData")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.high_return
                    .slice((hrPage - 1) * ITEMS_PER_PAGE, hrPage * ITEMS_PER_PAGE)
                    .map((row) => (
                      <TableRow
                        key={row.outlet_id}
                        className="cursor-pointer"
                        onClick={() => setSelectedOutlet(row as HighReturnOutlet)}
                      >
                        <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                        <TableCell className="text-xs">{row.outlet_name}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums text-red-500">
                          {row.avg_return_pct}%
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.days_with_data}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar page={hrPage} setPage={setHrPage} totalItems={data.high_return.length} />
          </>
        )}
      </section>

      {/* Sold Out Outlets */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("soldOutOutlets")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("soldOutDesc")}</p>
        {data.sold_out.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("noSoldOut")}</div>
        ) : (
          <>
            <ChartContainer config={soldOutConfig} className="h-48 w-full mb-4">
              <BarChart
                data={data.sold_out.slice(0, 20)}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                <XAxis
                  dataKey="outlet_name"
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 12) + "\u2026" : v}
                />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
                <ChartTooltip content={<ChartTooltipContent hideIndicator labelFormatter={(_v, payload) => {
                  const name = (payload[0]?.payload as Record<string, unknown>)?.outlet_name as string | undefined
                  return name && name.length > 30 ? name.slice(0, 28) + "\u2026" : name ?? ""
                }} />} />
                <Bar
                  dataKey="sold_out_pct"
                  fill={soldOutConfig.sold_out_pct.color}
                  radius={[4, 4, 0, 0]}
                  className="cursor-pointer"
                  onClick={(_d, idx) => {
                    const outlet = data.sold_out.slice(0, 20)[idx]
                    if (outlet) setSelectedSoldOut(outlet as SoldOutOutlet)
                  }}
                />
              </BarChart>
            </ChartContainer>

            {/* Sold-out outlet detail modal */}
            <Dialog open={!!selectedSoldOut} onOpenChange={(open) => { if (!open) setSelectedSoldOut(null) }}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-base">{selectedSoldOut?.outlet_name}</DialogTitle>
                  <DialogDescription className="font-mono text-xs">{selectedSoldOut?.ext_id}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("soldOutPct")}</span>
                    <Badge variant="secondary">{selectedSoldOut?.sold_out_pct}%</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("soldOutDays")}</span>
                    <span className="tabular-nums">{selectedSoldOut?.sold_out_days}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("totalDays")}</span>
                    <span className="tabular-nums">{selectedSoldOut?.total_days}</span>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      if (selectedSoldOut) {
                        router.push(`/outlets?search=${encodeURIComponent(selectedSoldOut.ext_id)}`)
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("openOutlet")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("accountId")}</TableHead>
                    <TableHead className="text-xs">{t("outlet")}</TableHead>
                    <TableHead className="text-xs text-right">{t("soldOutPct")}</TableHead>
                    <TableHead className="text-xs text-right">{t("soldOutDays")}</TableHead>
                    <TableHead className="text-xs text-right">{t("totalDays")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sold_out
                    .slice((soPage - 1) * ITEMS_PER_PAGE, soPage * ITEMS_PER_PAGE)
                    .map((row) => (
                      <TableRow
                        key={row.outlet_id}
                        className="cursor-pointer"
                        onClick={() => setSelectedSoldOut(row as SoldOutOutlet)}
                      >
                        <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                        <TableCell className="text-xs">{row.outlet_name}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums text-amber-600">
                          {row.sold_out_pct}%
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.sold_out_days}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.total_days}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar page={soPage} setPage={setSoPage} totalItems={data.sold_out.length} />
          </>
        )}
      </section>

      {/* Fixed Accounts */}
      <section>
        <h3 className="text-sm font-medium mb-2">{t("fixedAccounts")}</h3>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("fixedAccountsDesc")}</p>
        {data.fixed_accounts.length === 0 ? (
          <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">{t("noFixedAccounts")}</div>
        ) : (
          <>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("accountId")}</TableHead>
                    <TableHead className="text-xs">{t("outlet")}</TableHead>
                    <TableHead className="text-xs text-right">{t("cv")}</TableHead>
                    <TableHead className="text-xs text-right">{t("soldEqDelivered")}</TableHead>
                    <TableHead className="text-xs text-right">{t("avgSold")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.fixed_accounts
                    .slice((fixedPage - 1) * ITEMS_PER_PAGE, fixedPage * ITEMS_PER_PAGE)
                    .map((row) => (
                      <TableRow
                        key={row.outlet_id}
                        className="cursor-pointer"
                        onClick={() => setSelectedFixed(row)}
                      >
                        <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                        <TableCell className="text-xs">{row.outlet_name}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.cv}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {row.sold_eq_delivered_pct}%
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{row.avg_sold}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar page={fixedPage} setPage={setFixedPage} totalItems={data.fixed_accounts.length} />

            {/* Fixed account modal */}
            <Dialog open={!!selectedFixed} onOpenChange={(open) => { if (!open) setSelectedFixed(null) }}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-base">{selectedFixed?.outlet_name}</DialogTitle>
                  <DialogDescription className="font-mono text-xs">{selectedFixed?.ext_id}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("cv")}</span>
                    <span className="tabular-nums font-medium">{selectedFixed?.cv}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("soldEqDelivered")}</span>
                    <span className="tabular-nums">{selectedFixed?.sold_eq_delivered_pct}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">{t("avgSold")}</span>
                    <span className="tabular-nums">{selectedFixed?.avg_sold}</span>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      if (selectedFixed) router.push(`/outlets?search=${encodeURIComponent(selectedFixed.ext_id)}`)
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

      {/* Weekday Efficiency Heatmap */}
      {data.weekday_efficiency.length > 0 && (
        <WeekdayHeatmap data={data.weekday_efficiency} t={t} page={wdEffPage} setPage={setWdEffPage} />
      )}
    </div>
  )
}

type WdSortField = "ext_id" | "name" | `ret_${number}` | `so_${number}`

function WeekdayHeatmap(
  { data, t, page, setPage }: {
    data: { outlet_id: string; outlet_name: string; ext_id: string; weekday: number; avg_return_pct: number | null; sold_out_pct: number; day_count: number }[]
    t: (key: string) => string
    page: number
    setPage: (p: number) => void
  },
) {
  const router = useRouter()
  const [sortField, setSortField] = useState<WdSortField>("ext_id")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [selectedWdOutlet, setSelectedWdOutlet] = useState<{ ext_id: string; name: string } | null>(null)

  function handleSort(field: WdSortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
    setPage(1)
  }

  // Group by outlet
  const grouped = useMemo(() => {
    const map = new Map<string, { ext_id: string; name: string; weekdays: Map<number, { ret: number | null; so: number }> }>()
    for (const row of data) {
      if (!map.has(row.outlet_id)) {
        map.set(row.outlet_id, { ext_id: row.ext_id, name: row.outlet_name, weekdays: new Map() })
      }
      map.get(row.outlet_id)!.weekdays.set(row.weekday, { ret: row.avg_return_pct, so: row.sold_out_pct })
    }
    return Array.from(map.entries())
  }, [data])

  // Sort
  const allOutlets = useMemo(() => {
    const sorted = [...grouped]
    const dir = sortDir === "asc" ? 1 : -1
    sorted.sort((a, b) => {
      const ai = a[1], bi = b[1]
      if (sortField === "ext_id") return ai.ext_id.localeCompare(bi.ext_id) * dir
      if (sortField === "name") return ai.name.localeCompare(bi.name) * dir
      const match = sortField.match(/^(ret|so)_(\d)$/)
      if (match) {
        const type = match[1] as "ret" | "so"
        const wd = Number(match[2])
        const av = type === "ret" ? (ai.weekdays.get(wd)?.ret ?? -1) : (ai.weekdays.get(wd)?.so ?? -1)
        const bv = type === "ret" ? (bi.weekdays.get(wd)?.ret ?? -1) : (bi.weekdays.get(wd)?.so ?? -1)
        return (av - bv) * dir
      }
      return 0
    })
    return sorted
  }, [grouped, sortField, sortDir])

  const outlets = allOutlets.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  function SortIcon({ field }: { field: WdSortField }) {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3" />
  }

  return (
    <section>
      <h3 className="text-sm font-medium mb-2">{t("weekdayEfficiency")}</h3>
      <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("weekdayEfficiencyDesc")}</p>
      <div className="border border-[var(--border)] rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className="text-xs cursor-pointer select-none"
                onClick={() => handleSort("ext_id")}
              >
                <span className="inline-flex items-center gap-0.5">
                  {t("accountId")}
                  <SortIcon field="ext_id" />
                </span>
              </TableHead>
              <TableHead
                className="text-xs cursor-pointer select-none"
                onClick={() => handleSort("name")}
              >
                <span className="inline-flex items-center gap-0.5">
                  {t("outlet")}
                  <SortIcon field="name" />
                </span>
              </TableHead>
              {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                <TableHead key={wd} className="text-xs text-center px-1">
                  <span className="inline-flex items-center justify-center gap-0">
                    <button
                      onClick={() => handleSort(`ret_${wd}` as WdSortField)}
                      className="cursor-pointer p-0.5 hover:text-red-500"
                      title={`${t("returnPct")} ${WEEKDAY_LABELS[wd]}`}
                    >
                      <SortIcon field={`ret_${wd}` as WdSortField} />
                    </button>
                    <span className="mx-0.5">{WEEKDAY_LABELS[wd]}</span>
                    <button
                      onClick={() => handleSort(`so_${wd}` as WdSortField)}
                      className="cursor-pointer p-0.5 hover:text-amber-500"
                      title={`${t("soldOutPct")} ${WEEKDAY_LABELS[wd]}`}
                    >
                      <SortIcon field={`so_${wd}` as WdSortField} />
                    </button>
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {outlets.map(([oid, info]) => (
              <TableRow
                key={oid}
                className="cursor-pointer"
                onClick={() => setSelectedWdOutlet({ ext_id: info.ext_id, name: info.name })}
              >
                <TableCell className="text-xs font-mono">{info.ext_id}</TableCell>
                <TableCell className="text-xs">{info.name}</TableCell>
                {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                  const val = info.weekdays.get(wd)
                  if (!val) return <TableCell key={wd} className="text-xs text-center text-[var(--muted-foreground)]">&mdash;</TableCell>
                  const ret = val.ret
                  return (
                    <TableCell key={wd} className="text-xs text-center tabular-nums">
                      {ret != null && (
                        <span className={ret > 25 ? "text-red-500" : undefined}>{ret}%</span>
                      )}
                      {ret != null && <span className="text-[var(--muted-foreground)]"> / </span>}
                      <span className={val.so > 30 ? "text-amber-500" : undefined}>{val.so}%</span>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-[10px] text-[var(--muted-foreground)] mt-1">{t("returnPct")} / {t("soldOutPct")}</p>
      <PaginationBar page={page} setPage={setPage} totalItems={allOutlets.length} />

      {/* Weekday efficiency outlet modal */}
      <Dialog open={!!selectedWdOutlet} onOpenChange={(open) => { if (!open) setSelectedWdOutlet(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{selectedWdOutlet?.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{selectedWdOutlet?.ext_id}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (selectedWdOutlet) router.push(`/outlets?search=${encodeURIComponent(selectedWdOutlet.ext_id)}`)
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("openOutlet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
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
