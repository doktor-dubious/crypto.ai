"use client"

import { useState, useMemo } from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Search, X, Plus, ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  predictionsApi,
  type CompletedPredictionResponse,
  type PredictionComparisonItem,
} from "@/lib/api"
import { cn } from "@/lib/utils"

// ─── Constants ────────────────────────────────────────────────────────────────

const PICKER_PAGE_SIZE = 10
type SortField = "strategy_name" | "date" | "created_at"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—"
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—"
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PredictionAnalyticsPage() {
  const { activeCustomer } = useCustomer()
  const t = useTranslations("predictions.analytics")

  // Picker state
  const [search, setSearch] = useState("")
  const [pickerPage, setPickerPage] = useState(1)
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Selected prediction IDs (ordered)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Fetch completed predictions (success only)
  const customerId = activeCustomer?.id ?? ""
  const { data: predictionsData } = useQuery({
    queryKey: ["predictions", "completed", customerId],
    queryFn: () => predictionsApi.list(customerId, { limit: 500 }),
    enabled: !!customerId,
  })

  const successPredictions = useMemo(() => {
    if (!predictionsData) return []
    return predictionsData.items.filter((p) => p.status === "success")
  }, [predictionsData])

  // Filter + sort for picker
  const filteredPredictions = useMemo(() => {
    let list = successPredictions
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((p) =>
        (p.strategy_name ?? "").toLowerCase().includes(q) ||
        (p.date ?? "").includes(q) ||
        (p.engine ?? "").toLowerCase().includes(q)
      )
    }
    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sortField === "strategy_name") cmp = (a.strategy_name ?? "").localeCompare(b.strategy_name ?? "")
      else if (sortField === "date") cmp = (a.date ?? "").localeCompare(b.date ?? "")
      else cmp = a.created_at.localeCompare(b.created_at)
      return sortDir === "asc" ? cmp : -cmp
    })
    return list
  }, [successPredictions, search, sortField, sortDir])

  const totalPickerPages = Math.max(1, Math.ceil(filteredPredictions.length / PICKER_PAGE_SIZE))
  const pagedPredictions = filteredPredictions.slice(
    (pickerPage - 1) * PICKER_PAGE_SIZE,
    pickerPage * PICKER_PAGE_SIZE,
  )

  // Comparison query
  const { data: comparisonData, isPending: comparing } = useQuery({
    queryKey: ["predictions", "compare", customerId, selectedIds],
    queryFn: () => predictionsApi.compare(customerId, selectedIds),
    enabled: !!customerId && selectedIds.length >= 2,
  })

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 ml-1" />
      : <ChevronDown className="h-3 w-3 ml-1" />
  }

  const addPrediction = (id: string) => {
    if (!selectedIds.includes(id)) setSelectedIds((prev) => [...prev, id])
  }

  const removePrediction = (id: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }

  // Build selected prediction name map for badges
  const nameMap = useMemo(() => {
    const m = new Map<string, { name: string; date: string | null }>()
    for (const p of successPredictions) {
      m.set(p.id, { name: p.strategy_name ?? p.id.slice(0, 8), date: p.date })
    }
    return m
  }, [successPredictions])

  if (!activeCustomer) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--muted-foreground)]">
        Select a customer first
      </div>
    )
  }

  const baseline = comparisonData?.items?.[0]

  return (
    <div className="flex flex-col gap-6 p-4 h-full overflow-y-auto">
      {/* ─── Selected predictions (badges) ─── */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">
            {t("selected", { count: selectedIds.length })}
          </span>
          {selectedIds.map((id) => {
            const info = nameMap.get(id)
            return (
              <Badge key={id} variant="secondary" className="gap-1 pr-1">
                <span className="text-xs">
                  {info?.name ?? id.slice(0, 8)}
                  {info?.date ? ` (${formatDate(info.date)})` : ""}
                </span>
                <button
                  onClick={() => removePrediction(id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-[var(--muted)] cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-6"
            onClick={() => setSelectedIds([])}
          >
            {t("clearAll")}
          </Button>
        </div>
      )}

      {/* ─── Comparison table ─── */}
      {selectedIds.length >= 2 && (
        <div className="border border-[var(--border)] rounded-lg overflow-hidden">
          {comparing ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">
              {t("comparing")}
            </div>
          ) : comparisonData?.items && comparisonData.items.length >= 2 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                    <th className="text-left font-medium text-[var(--muted-foreground)] py-2.5 px-4 min-w-[160px]">{t("colName")}</th>
                    <th className="text-right font-medium text-[var(--muted-foreground)] py-2.5 px-4 min-w-[100px]">{t("colDraw")}</th>
                    <th className="text-right font-medium text-[var(--muted-foreground)] py-2.5 px-4 min-w-[130px]">{t("colExpectedDemand")}</th>
                    <th className="text-right font-medium text-[var(--muted-foreground)] py-2.5 px-4 min-w-[120px]">{t("colExpectedSale")}</th>
                    <th className="text-right font-medium text-[var(--muted-foreground)] py-2.5 px-4 min-w-[130px]">{t("colExpectedReturn")}</th>
                    <th className="text-right font-medium text-[var(--muted-foreground)] py-2.5 px-4 min-w-[150px]">{t("colSoldOutPct")}</th>
                    <th className="text-right font-medium text-[var(--muted-foreground)] py-2.5 px-4 min-w-[130px]">{t("colExpectedProfit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.items.map((item, idx) => (
                    <ComparisonRow
                      key={item.id}
                      item={item}
                      baseline={idx === 0 ? null : baseline!}
                      isFirst={idx === 0}
                      t={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      {/* ─── Hint when < 2 selected ─── */}
      {selectedIds.length < 2 && (
        <div className="border border-dashed border-[var(--border)] rounded-lg p-8 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">{t("selectPredictions")}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">{t("selectHint")}</p>
        </div>
      )}

      {/* ─── Prediction picker ─── */}
      <div className="flex flex-col gap-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPickerPage(1) }}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <div className="border border-[var(--border)] rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10"></TableHead>
                <TableHead>
                  <button onClick={() => toggleSort("strategy_name")} className="inline-flex items-center cursor-pointer">
                    {t("colName")} <SortIcon field="strategy_name" />
                  </button>
                </TableHead>
                <TableHead>
                  <button onClick={() => toggleSort("date")} className="inline-flex items-center cursor-pointer">
                    {t("colDate")} <SortIcon field="date" />
                  </button>
                </TableHead>
                <TableHead>Engine</TableHead>
                <TableHead className="text-right">Outlets</TableHead>
                <TableHead>
                  <button onClick={() => toggleSort("created_at")} className="inline-flex items-center cursor-pointer">
                    Run Date <SortIcon field="created_at" />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedPredictions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-[var(--muted-foreground)] py-8">
                    {t("noResults")}
                  </TableCell>
                </TableRow>
              ) : (
                pagedPredictions.map((p) => {
                  const isSelected = selectedIds.includes(p.id)
                  return (
                    <TableRow
                      key={p.id}
                      className={cn(
                        "cursor-pointer",
                        isSelected && "bg-[var(--muted)]/50",
                      )}
                      onClick={() => isSelected ? removePrediction(p.id) : addPrediction(p.id)}
                    >
                      <TableCell className="w-10">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation()
                            isSelected ? removePrediction(p.id) : addPrediction(p.id)
                          }}
                        >
                          {isSelected ? (
                            <X className="h-3.5 w-3.5 text-[var(--destructive)]" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{p.strategy_name ?? "—"}</TableCell>
                      <TableCell>{p.date ? formatDate(p.date) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-normal">
                          {p.engine ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{p.outlet_count}</TableCell>
                      <TableCell>{formatDate(p.created_at)}</TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPickerPages > 1 && (
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>
              {t("showing", {
                from: (pickerPage - 1) * PICKER_PAGE_SIZE + 1,
                to: Math.min(pickerPage * PICKER_PAGE_SIZE, filteredPredictions.length),
                total: filteredPredictions.length,
              })}
            </span>
            <Pagination className="w-auto mx-0">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPickerPage((p) => Math.max(1, p - 1))}
                    className={cn(pickerPage === 1 && "pointer-events-none opacity-50", "cursor-pointer")}
                  />
                </PaginationItem>
                {buildPaginationPages(pickerPage, totalPickerPages).map((pg, i) =>
                  pg === "ellipsis" ? (
                    <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                  ) : (
                    <PaginationItem key={pg}>
                      <PaginationLink
                        isActive={pg === pickerPage}
                        onClick={() => setPickerPage(pg)}
                        className="cursor-pointer"
                      >
                        {pg}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPickerPage((p) => Math.min(totalPickerPages, p + 1))}
                    className={cn(pickerPage === totalPickerPages && "pointer-events-none opacity-50", "cursor-pointer")}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Comparison Row ───────────────────────────────────────────────────────────

function ComparisonRow({
  item,
  baseline,
  isFirst,
  t,
}: {
  item: PredictionComparisonItem
  baseline: PredictionComparisonItem | null
  isFirst: boolean
  t: ReturnType<typeof useTranslations>
}) {
  const fields = ["draw", "expected_demand", "expected_sale", "expected_return", "sold_out_pct", "expected_profit"] as const

  return (
    <>
      {/* Main values row */}
      <tr className={cn("border-b border-[var(--border)]", isFirst && "bg-[var(--muted)]/20")}>
        <td className="py-2.5 px-4 font-medium">
          {item.name}
          {item.date && (
            <span className="text-xs text-[var(--muted-foreground)] ml-2">
              {formatDate(item.date)}
            </span>
          )}
        </td>
        {fields.map((f) => (
          <td key={f} className="py-2.5 px-4 text-right tabular-nums">
            {f === "sold_out_pct" ? fmtPct(item[f]) : fmtNum(item[f])}
          </td>
        ))}
      </tr>

      {/* Delta row (only for non-first rows) */}
      {!isFirst && baseline && (
        <tr className="border-b border-[var(--border)]">
          <td className="py-1 px-4 text-xs text-[var(--muted-foreground)]">{t("deltaRow")}</td>
          {fields.map((f) => {
            const val = item[f]
            const base = baseline[f]
            if (val == null || base == null) {
              return <td key={f} className="py-1 px-4 text-right text-xs">—</td>
            }
            const delta = val - base
            const isNegative = delta < 0
            // For return: negative delta = good (less waste), for profit: positive = good
            // For sold out %: higher = worse. Use simple coloring: red for worse outcomes
            const isWorse = f === "expected_profit"
              ? delta < 0
              : f === "expected_return"
                ? delta > 0
                : f === "sold_out_pct"
                  ? delta > 0
                  : false

            return (
              <td
                key={f}
                className={cn(
                  "py-1 px-4 text-right text-xs tabular-nums",
                  isWorse
                    ? "text-red-500"
                    : delta !== 0
                      ? "text-[var(--muted-foreground)]"
                      : "text-[var(--muted-foreground)]",
                )}
              >
                {delta === 0 ? "—" : (f === "sold_out_pct" ? fmtPct(delta) : fmtNum(delta))}
              </td>
            )
          })}
        </tr>
      )}
    </>
  )
}
