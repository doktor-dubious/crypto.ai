"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Info } from "lucide-react"
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
import { analysisApi } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Props {
  customerId: string
  outletIds: string[]
  startDate: string
  endDate: string
  active: boolean
}

const ITEMS_PER_PAGE = 10

export function DataQualityTab({ customerId, outletIds, startDate, endDate, active }: Props) {
  const t = useTranslations("salesAnalysis")

  const { data, isLoading } = useQuery({
    queryKey: ["analysis-data-quality", customerId, outletIds, startDate, endDate],
    queryFn: () => analysisApi.dataQuality({
      customer_id: customerId, outlet_ids: outletIds,
      start_date: startDate, end_date: endDate,
    }),
    enabled: active,
    staleTime: 5 * 60 * 1000,
  })

  // Pagination state per section
  const [missingPage, setMissingPage] = useState(1)
  const [zeroPage, setZeroPage] = useState(1)
  const [discPage, setDiscPage] = useState(1)
  const [shiftPage, setShiftPage] = useState(1)

  if (isLoading) return <Loading t={t} />
  if (!data) return null

  const { summary } = data

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-6 pt-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard
            label={t("summaryMissing")}
            tooltip={t("missingDataDesc")}
            value={summary.total_missing_dates}
            total={summary.total_expected_dates}
            warn={summary.total_missing_dates > 0}
          />
          <SummaryCard
            label={t("summaryZeroSales")}
            tooltip={t("zeroSalesDesc")}
            value={summary.total_zero_sales}
            total={summary.total_sales_records}
            warn={summary.total_zero_sales > 0}
          />
          <SummaryCard
            label={t("summaryDiscrepancies")}
            tooltip={t("fieldDiscrepanciesDesc")}
            value={summary.total_discrepancies}
            total={summary.total_outlets_with_scan_or_net}
            warn={summary.total_discrepancies > 0}
          />
          <SummaryCard
            label={t("summaryLevelShifts")}
            tooltip={t("levelShiftsDesc")}
            value={summary.total_level_shifts}
            total={summary.total_outlets_analyzed}
            warn={summary.total_level_shifts > 0}
          />
          <SummaryCard
            label={t("summaryOutletsWithIssues")}
            tooltip={t("outletsWithIssuesTooltip")}
            value={summary.outlets_with_issues}
            total={summary.total_outlets}
            warn={summary.outlets_with_issues > 0}
          />
        </div>

        {/* Sections */}
        <CollapsibleSection title={t("missingData")} desc={t("missingDataDesc")} count={data.missing_data.length}>
          {data.missing_data.length === 0 ? (
            <EmptyState t={t} />
          ) : (
            <PaginatedTable
              page={missingPage}
              setPage={setMissingPage}
              totalItems={data.missing_data.length}
              header={
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">{t("accountId")}</TableHead>
                  <TableHead className="text-xs">{t("outlet")}</TableHead>
                  <TableHead className="text-xs text-right">{t("count")}</TableHead>
                </TableRow>
              }
            >
              {paginate(data.missing_data, missingPage).map((row) => (
                <TableRow key={row.outlet_id}>
                  <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                  <TableCell className="text-xs">{row.outlet_name}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{row.gap_count}</TableCell>
                </TableRow>
              ))}
            </PaginatedTable>
          )}
        </CollapsibleSection>

        <CollapsibleSection title={t("zeroSales")} desc={t("zeroSalesDesc")} count={data.zero_sales.length}>
          {data.zero_sales.length === 0 ? (
            <EmptyState t={t} />
          ) : (
            <PaginatedTable
              page={zeroPage}
              setPage={setZeroPage}
              totalItems={data.zero_sales.length}
              header={
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">{t("accountId")}</TableHead>
                  <TableHead className="text-xs">{t("outlet")}</TableHead>
                  <TableHead className="text-xs text-right">{t("count")}</TableHead>
                </TableRow>
              }
            >
              {paginate(data.zero_sales, zeroPage).map((row) => (
                <TableRow key={row.outlet_id}>
                  <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                  <TableCell className="text-xs">{row.outlet_name}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{row.count}</TableCell>
                </TableRow>
              ))}
            </PaginatedTable>
          )}
        </CollapsibleSection>

        <CollapsibleSection title={t("fieldDiscrepancies")} desc={t("fieldDiscrepanciesDesc")} count={data.discrepancies.length}>
          {data.discrepancies.length === 0 ? (
            <EmptyState t={t} />
          ) : (
            <PaginatedTable
              page={discPage}
              setPage={setDiscPage}
              totalItems={data.discrepancies.length}
              header={
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">{t("accountId")}</TableHead>
                  <TableHead className="text-xs">{t("outlet")}</TableHead>
                  <TableHead className="text-xs">{t("field")}</TableHead>
                  <TableHead className="text-xs text-right">{t("avgDifference")}</TableHead>
                  <TableHead className="text-xs text-right">{t("occurrences")}</TableHead>
                </TableRow>
              }
            >
              {paginate(data.discrepancies, discPage).map((row, i) => (
                <TableRow key={`${row.outlet_id}-${row.field}-${i}`}>
                  <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                  <TableCell className="text-xs">{row.outlet_name}</TableCell>
                  <TableCell className="text-xs font-mono">{row.field}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{row.avg_difference}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{row.occurrence_count}</TableCell>
                </TableRow>
              ))}
            </PaginatedTable>
          )}
        </CollapsibleSection>

        <CollapsibleSection title={t("levelShifts")} desc={t("levelShiftsDesc")} count={data.level_shifts.length}>
          {data.level_shifts.length === 0 ? (
            <EmptyState t={t} />
          ) : (
            <PaginatedTable
              page={shiftPage}
              setPage={setShiftPage}
              totalItems={data.level_shifts.length}
              header={
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">{t("accountId")}</TableHead>
                  <TableHead className="text-xs">{t("outlet")}</TableHead>
                  <TableHead className="text-xs">{t("shiftDate")}</TableHead>
                  <TableHead className="text-xs text-right">{t("beforeMean")}</TableHead>
                  <TableHead className="text-xs text-right">{t("afterMean")}</TableHead>
                  <TableHead className="text-xs text-right">{t("magnitude")}</TableHead>
                </TableRow>
              }
            >
              {paginate(data.level_shifts, shiftPage).map((row) => (
                <TableRow key={`${row.outlet_id}-${row.shift_date}`}>
                  <TableCell className="text-xs font-mono">{row.ext_id}</TableCell>
                  <TableCell className="text-xs">{row.outlet_name}</TableCell>
                  <TableCell className="text-xs">{row.shift_date}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{row.before_mean}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{row.after_mean}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {row.magnitude_pct > 0 ? "+" : ""}{row.magnitude_pct}%
                  </TableCell>
                </TableRow>
              ))}
            </PaginatedTable>
          )}
        </CollapsibleSection>
      </div>
    </TooltipProvider>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function paginate<T>(items: T[], page: number): T[] {
  return items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
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

// ─── Sub-components ─────────────────────────────────────────────────────────

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

function SummaryCard(
  { label, tooltip, value, total, warn }: { label: string; tooltip: string; value: number; total: number; warn: boolean },
) {
  const pct = total > 0 ? (value / total * 100) : 0
  return (
    <div className="border border-[var(--border)] rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
        <InfoIcon text={tooltip} />
      </div>
      <div className="flex items-center gap-2">
        {warn
          ? <AlertTriangle className="h-4 w-4 text-amber-500" />
          : <CheckCircle className="h-4 w-4 text-emerald-500" />
        }
        <span className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</span>
        {total > 0 && (
          <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
            ({pct < 0.1 && pct > 0 ? "<0.1" : pct.toFixed(1)}%)
          </span>
        )}
      </div>
    </div>
  )
}

function CollapsibleSection(
  { title, desc, count, children }: { title: string; desc: string; count: number; children: React.ReactNode },
) {
  const [open, setOpen] = useState(count > 0)
  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[var(--accent)]/30 cursor-pointer"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-[var(--muted-foreground)]">({count})</span>
        <span className="text-xs text-[var(--muted-foreground)] ml-auto hidden sm:inline">{desc}</span>
      </button>
      {open && <div className="px-1 pb-2">{children}</div>}
    </div>
  )
}

function PaginatedTable(
  { page, setPage, totalItems, header, children }: {
    page: number
    setPage: (p: number) => void
    totalItems: number
    header: React.ReactNode
    children: React.ReactNode
  },
) {
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pages = buildPages(safePage, totalPages)

  return (
    <>
      <Table>
        <TableHeader>{header}</TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
      {totalPages > 1 && (
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
      )}
    </>
  )
}

function Loading({ t }: { t: (key: string) => string }) {
  return (
    <div className="flex items-center justify-center h-64 text-sm text-[var(--muted-foreground)]">
      {t("loading")}
    </div>
  )
}

function EmptyState({ t }: { t: (key: string) => string }) {
  return (
    <div className="flex items-center justify-center py-8 text-xs text-[var(--muted-foreground)]">
      <CheckCircle className="h-4 w-4 mr-2 text-emerald-500" />
      {t("noIssues")}
    </div>
  )
}
