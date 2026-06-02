"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Focus,
  RefreshCw,
  Star,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  customerConfigurationApi,
  elasticityEventsApi,
  outletsApi,
  predictionEnginesApi,
  pricingAnalyticsApi,
  type CustomerElasticitySummary,
  type CustomerPriceRecommendation,
  type CustomerPriceScenario,
  type CustomerPriceVariation,
  type ElasticityConfidence,
  type EventConfidence,
  type EventWithEstimate,
  type OutletElasticity,
  type PriceVariationViability,
  type ProjectionMode,
  type RecommendationStatus,
  type RidgeCapableEngine,
} from "@/lib/api"
import { cn } from "@/lib/utils"

// ─── Constants ────────────────────────────────────────────────────────────────

const AT_RISK_PAGE_SIZE = 10

// Foundation-model engines that fit Ridge on residuals — surfaced on the
// Parameters tab and used by the Coverage card's backfill button.
const RIDGE_ENGINES: RidgeCapableEngine[] = [
  "flowstate",
  "yinglong",
  "toto",
  "moirai2",
  "timesfm",
  "timesfm_finetuned",
  "chronos2",
  "chronos-bolt",
  "sundial",
  "kairos",
  "tirex",
  "gluon-chronos-bolt",
  "gluon-chronos2",
  "gluon-toto",
]

// ─── Formatting helpers ───────────────────────────────────────────────────────

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—"
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—"
  return `${n.toFixed(digits)}%`
}

function fmtDecimalAsPct(n: number, digits = 0): string {
  const sign = n >= 0 ? "+" : ""
  return `${sign}${(n * 100).toFixed(digits)}%`
}

function fmtDecimalAsPctOrDash(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—"
  return fmtDecimalAsPct(n, digits)
}

function fmtElasticity(n: number | null | undefined): string {
  if (n == null) return "—"
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
}

function viabilityVariant(
  v: PriceVariationViability
): "success" | "warning" | "destructive" {
  if (v === "adequate") return "success"
  if (v === "marginal") return "warning"
  return "destructive"
}

function confidenceVariant(
  c: ElasticityConfidence
): "success" | "info" | "warning" | "muted" {
  if (c === "high") return "success"
  if (c === "medium") return "info"
  if (c === "low") return "warning"
  return "muted"
}

// ─── Parameters tab ───────────────────────────────────────────────────────────

const PARAMETERS_SELECT_CLASS =
  "flex h-9 w-full max-w-xs rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer"

const WINDOW_OPTIONS = [30, 60, 90, 180, 365] as const

function ParametersTab({
  windowDays,
  onWindowDaysChange,
  engine,
  onEngineChange,
}: {
  windowDays: number
  onWindowDaysChange: (v: number) => void
  engine: RidgeCapableEngine
  onEngineChange: (v: RidgeCapableEngine) => void
}) {
  const t = useTranslations("pricingAnalytics.parameters")
  const tShared = useTranslations("pricingAnalytics")
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("windowHeading")}</CardTitle>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {t("windowDescription")}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label className="text-xs text-[var(--muted-foreground)]">
            {tShared("windowDays")}
          </Label>
          <select
            value={windowDays}
            onChange={(e) => onWindowDaysChange(Number(e.target.value))}
            className={PARAMETERS_SELECT_CLASS}
          >
            {WINDOW_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("engineHeading")}</CardTitle>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {t("engineDescription")}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label className="text-xs text-[var(--muted-foreground)]">
            {t("engineLabel")}
          </Label>
          <select
            value={engine}
            onChange={(e) => onEngineChange(e.target.value as RidgeCapableEngine)}
            className={`${PARAMETERS_SELECT_CLASS} capitalize`}
          >
            {RIDGE_ENGINES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted-foreground)]">{t("engineHint")}</p>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Viability tab ────────────────────────────────────────────────────────────

type ViabilitySortField =
  | "outlet_name"
  | "n_days_observed"
  | "n_distinct_prices"
  | "price_cv"
  | "within_weekday_cv"
  | "mean_price"
  | "viability"
  | "starred"

const VIABILITY_RANK: Record<PriceVariationViability, number> = {
  adequate: 0,
  marginal: 1,
  insufficient: 2,
}

const VIABILITY_STORAGE_PREFIX = "gorm:pricingViability:"

function loadViabilityJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${VIABILITY_STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveViabilityJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${VIABILITY_STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

function ViabilityTab({
  customerId,
  windowDays,
}: {
  customerId: string
  windowDays: number
}) {
  const t = useTranslations("pricingAnalytics.viability")
  const tShared = useTranslations("pricingAnalytics")
  const [currentPage, setCurrentPage] = useState(1)
  const [sortField, setSortField] = useState<ViabilitySortField>("outlet_name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(loadViabilityJson<string[]>(customerId, "checked", []))
  )
  const [starredIds, setStarredIds] = useState<Set<string>>(
    () => new Set(loadViabilityJson<string[]>(customerId, "starred", []))
  )
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [popupOutletId, setPopupOutletId] = useState<string | null>(null)
  const router = useRouter()

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["pricing", "viability", customerId, windowDays],
    queryFn: () => pricingAnalyticsApi.customerViability(customerId, windowDays),
    enabled: !!customerId,
  })

  const { data: popupOutlet, isLoading: popupLoading } = useQuery({
    queryKey: ["outlet", popupOutletId],
    queryFn: () => outletsApi.get(popupOutletId!),
    enabled: !!popupOutletId,
  })

  useEffect(() => { setCurrentPage(1) }, [customerId, windowDays])

  // Reset transient view state and reload persisted sets when customer changes.
  const prevCidRef = useRef(customerId)
  useEffect(() => {
    if (prevCidRef.current !== customerId) {
      setSelectedIds(new Set(loadViabilityJson<string[]>(customerId, "checked", [])))
      setStarredIds(new Set(loadViabilityJson<string[]>(customerId, "starred", [])))
      setShowOnlySelected(false)
      prevCidRef.current = customerId
    }
  }, [customerId])

  useEffect(() => {
    if (customerId) saveViabilityJson(customerId, "checked", [...selectedIds])
  }, [customerId, selectedIds])
  useEffect(() => {
    if (customerId) saveViabilityJson(customerId, "starred", [...starredIds])
  }, [customerId, starredIds])

  const atRisk = useMemo(
    () => (data ? data.outlets.filter((o) => o.viability !== "adequate") : []),
    [data]
  )

  const filteredAtRisk = useMemo(() => {
    const items = showOnlySelected
      ? atRisk.filter((o) => selectedIds.has(o.outlet_id))
      : atRisk
    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "outlet_name":
          va = (a.outlet_name ?? a.outlet_id).toLowerCase()
          vb = (b.outlet_name ?? b.outlet_id).toLowerCase()
          break
        case "n_days_observed":
          va = a.n_days_observed; vb = b.n_days_observed; break
        case "n_distinct_prices":
          va = a.n_distinct_prices; vb = b.n_distinct_prices; break
        case "price_cv":
          va = a.price_cv ?? -Infinity; vb = b.price_cv ?? -Infinity; break
        case "within_weekday_cv":
          va = a.within_weekday_cv ?? -Infinity; vb = b.within_weekday_cv ?? -Infinity; break
        case "mean_price":
          va = a.mean_price ?? -Infinity; vb = b.mean_price ?? -Infinity; break
        case "viability":
          va = VIABILITY_RANK[a.viability]; vb = VIABILITY_RANK[b.viability]; break
        case "starred":
          va = starredIds.has(a.outlet_id) ? 1 : 0
          vb = starredIds.has(b.outlet_id) ? 1 : 0
          break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [atRisk, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filteredAtRisk.length / AT_RISK_PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pagedAtRisk = filteredAtRisk.slice(
    (safePage - 1) * AT_RISK_PAGE_SIZE,
    safePage * AT_RISK_PAGE_SIZE
  )

  const allPageSelected = pagedAtRisk.length > 0 && pagedAtRisk.every((o) => selectedIds.has(o.outlet_id))
  const somePageSelected = pagedAtRisk.some((o) => selectedIds.has(o.outlet_id))

  function handleSort(field: ViabilitySortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev)
        pagedAtRisk.forEach((o) => n.delete(o.outlet_id))
        return n
      })
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev)
        pagedAtRisk.forEach((o) => n.add(o.outlet_id))
        return n
      })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function SortHeader({
    field,
    label,
    align = "left",
  }: {
    field: ViabilitySortField
    label: string
    align?: "left" | "right"
  }) {
    const active = sortField === field
    return (
      <button
        onClick={() => handleSort(field)}
        className={cn(
          "flex items-center gap-1 font-medium hover:text-foreground transition-colors whitespace-nowrap",
          align === "right" ? "ml-auto" : "text-left"
        )}
      >
        {label}
        {active
          ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  if (isLoading) return <div className="text-sm text-[var(--muted-foreground)]">{tShared("loading")}</div>
  if (error || !data) return <ErrorBox message={tShared("error")} onRetry={() => refetch()} />

  const overall = data.overall_viability

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{t("heading")}</CardTitle>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("subheading")}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted-foreground)]">{t("overall")}:</span>
            <Badge variant={viabilityVariant(overall)} className="text-xs">
              {t(overall)}
            </Badge>
            <span className="text-xs text-[var(--muted-foreground)]">{t(`${overall}Explain`)}</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatCell label={t("adequate")} value={data.n_adequate} total={data.n_outlets} accent="success" />
            <StatCell label={t("marginal")} value={data.n_marginal} total={data.n_outlets} accent="warning" />
            <StatCell label={t("insufficient")} value={data.n_insufficient} total={data.n_outlets} accent="destructive" />
          </div>

          <DeepHistoryBanner data={data} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("outletTable")}</CardTitle>
          <p className="text-xs text-[var(--muted-foreground)]">{t("outletTableHint")}</p>
        </CardHeader>
        <CardContent className="p-0">
          {atRisk.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              {t("emptyAtRisk")}
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 pl-4">
                        <div className="flex items-center gap-0.5">
                          <Checkbox
                            checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                            onCheckedChange={handleHeaderCheckbox}
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors cursor-pointer">
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem
                                onClick={() => setSelectedIds(new Set(atRisk.map((o) => o.outlet_id)))}
                              >
                                {t("selectAll")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setSelectedIds(
                                    new Set(
                                      data.outlets
                                        .filter((o) => o.viability === "adequate")
                                        .map((o) => o.outlet_id)
                                    )
                                  )
                                }
                              >
                                {t("selectAdequate")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setSelectedIds(
                                    new Set(
                                      atRisk
                                        .filter((o) => o.viability === "marginal")
                                        .map((o) => o.outlet_id)
                                    )
                                  )
                                }
                              >
                                {t("selectMarginal")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setSelectedIds(
                                    new Set(
                                      atRisk
                                        .filter((o) => o.viability === "insufficient")
                                        .map((o) => o.outlet_id)
                                    )
                                  )
                                }
                              >
                                {t("selectInsufficient")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  setSelectedIds(
                                    new Set(
                                      atRisk
                                        .filter((o) => starredIds.has(o.outlet_id))
                                        .map((o) => o.outlet_id)
                                    )
                                  )
                                }
                              >
                                {t("starred")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableHead>
                      <TableHead><SortHeader field="outlet_name" label={t("colOutlet")} /></TableHead>
                      <TableHead className="text-right"><div className="flex justify-end"><SortHeader field="n_days_observed" label={t("colDays")} align="right" /></div></TableHead>
                      <TableHead className="text-right"><div className="flex justify-end"><SortHeader field="n_distinct_prices" label={t("colDistinctPrices")} align="right" /></div></TableHead>
                      <TableHead className="text-right"><div className="flex justify-end"><SortHeader field="price_cv" label={t("colPriceCv")} align="right" /></div></TableHead>
                      <TableHead className="text-right"><div className="flex justify-end"><SortHeader field="within_weekday_cv" label={t("colWithinWeekdayCv")} align="right" /></div></TableHead>
                      <TableHead className="text-right"><div className="flex justify-end"><SortHeader field="mean_price" label={t("colMeanPrice")} align="right" /></div></TableHead>
                      <TableHead><SortHeader field="viability" label={t("colViability")} /></TableHead>
                      <TableHead>{t("colReason")}</TableHead>
                      <TableHead className="w-10 text-center">
                        <button
                          onClick={() => handleSort("starred")}
                          className="flex items-center gap-1 font-medium hover:text-foreground transition-colors cursor-pointer"
                        >
                          <Star className={cn("h-4 w-4", sortField === "starred" ? "" : "opacity-40")} />
                          {sortField === "starred" && (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedAtRisk.map((o) => {
                      const id = o.outlet_id
                      const displayName = (o.outlet_name && o.outlet_name.trim()) || id.slice(0, 8)
                      return (
                        <TableRow
                          key={id}
                          onContextMenu={(e) => { e.preventDefault(); handleStar(id) }}
                        >
                          <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(id)}
                              onCheckedChange={(c) =>
                                setSelectedIds((prev) => {
                                  const n = new Set(prev)
                                  c ? n.add(id) : n.delete(id)
                                  return n
                                })
                              }
                            />
                          </TableCell>
                          <TableCell
                            className="font-medium cursor-pointer hover:text-[var(--primary)] transition-colors"
                            onClick={(e) => { e.stopPropagation(); setPopupOutletId(id) }}
                          >
                            {displayName}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{o.n_days_observed}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.n_distinct_prices}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(o.price_cv, 3)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(o.within_weekday_cv, 3)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(o.mean_price)}</TableCell>
                          <TableCell>
                            <Badge variant={viabilityVariant(o.viability)} className="text-xs">
                              {t(o.viability)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-[var(--muted-foreground)] max-w-md">
                            {o.reason ?? ""}
                          </TableCell>
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleStar(id)}
                              className="hover:text-amber-400 transition-colors cursor-pointer"
                              aria-label="Toggle star"
                            >
                              <Star
                                className={cn(
                                  "h-4 w-4",
                                  starredIds.has(id)
                                    ? "fill-amber-400 text-amber-400"
                                    : "text-[var(--muted-foreground)]"
                                )}
                              />
                            </button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="border-t bg-background">
                <div className="flex items-center justify-between px-4 py-1.5">
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {t("showing", {
                      from: filteredAtRisk.length === 0 ? 0 : (safePage - 1) * AT_RISK_PAGE_SIZE + 1,
                      to: Math.min(safePage * AT_RISK_PAGE_SIZE, filteredAtRisk.length),
                      total: filteredAtRisk.length,
                    })}
                  </span>
                  {totalPages > 1 && (
                    <Pagination className="w-auto mx-0">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} />
                        </PaginationItem>
                        {buildPaginationPages(safePage, totalPages).map((p, i) =>
                          p === "ellipsis" ? (
                            <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                          ) : (
                            <PaginationItem key={p}>
                              <PaginationLink isActive={safePage === p} onClick={() => setCurrentPage(p)}>{p}</PaginationLink>
                            </PaginationItem>
                          )
                        )}
                        <PaginationItem>
                          <PaginationNext onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </div>

                {selectedIds.size > 0 && (
                  <div className="flex items-center justify-between px-4 py-2 border-t bg-[var(--muted)]/30">
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {t("selectedCount", { selected: selectedIds.size, total: atRisk.length })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 cursor-pointer"
                      onClick={() => setShowOnlySelected((v) => !v)}
                      title={showOnlySelected ? t("showAll") : t("showOnlySelected")}
                    >
                      <Focus className={cn("h-3.5 w-3.5", showOnlySelected && "text-primary")} />
                      <span className="text-xs">{showOnlySelected ? t("showAll") : t("showOnlySelected")}</span>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!popupOutletId} onOpenChange={(open) => { if (!open) setPopupOutletId(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {popupLoading ? tShared("loading") : (popupOutlet?.name || popupOutlet?.ext_id || "—")}
            </DialogTitle>
            {popupOutlet?.ext_id && (
              <DialogDescription className="font-mono text-xs">{popupOutlet.ext_id}</DialogDescription>
            )}
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[var(--muted-foreground)]">{t("popupOutletName")}</span>
              <span>{popupOutlet?.name?.trim() || "—"}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[var(--muted-foreground)]">{t("popupOutletDescription")}</span>
              <span className="whitespace-pre-wrap">{popupOutlet?.description?.trim() || "—"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              disabled={!popupOutlet?.ext_id}
              onClick={() => {
                if (popupOutlet?.ext_id) {
                  router.push(`/outlets?search=${encodeURIComponent(popupOutlet.ext_id)}`)
                }
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("openOutlet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DeepHistoryBanner({ data }: { data: CustomerPriceVariation }) {
  const t = useTranslations("pricingAnalytics.viability")

  if (!data.deep_last_change_date) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3 text-xs text-[var(--muted-foreground)]">
        <div className="font-medium text-[var(--foreground)]">{t("deepHistoryHeading")}</div>
        <p className="mt-1">{t("deepHistoryNoData")}</p>
      </div>
    )
  }

  const lastChange = new Date(data.deep_last_change_date)
  const daysAgo = Math.max(
    0,
    Math.floor((Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24))
  )
  const outsideWindow = daysAgo > data.window_days
  const formatted = lastChange.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-xs",
        outsideWindow
          ? "border-yellow-500/40 bg-yellow-500/5 text-[var(--foreground)]"
          : "border-[var(--border)] bg-[var(--muted)]/30 text-[var(--muted-foreground)]"
      )}
    >
      <div className="font-medium text-[var(--foreground)]">{t("deepHistoryHeading")}</div>
      <p className="mt-1">
        {t("deepHistorySummary", {
          date: formatted,
          daysAgo: daysAgo.toLocaleString(),
          count: data.deep_n_distinct_prices,
        })}
      </p>
      <p className="mt-1">
        {outsideWindow
          ? t("deepHistoryOutsideWindow", { window: data.window_days })
          : t("deepHistoryWithinWindow", { window: data.window_days })}
      </p>
    </div>
  )
}

// ─── Elasticity tab ───────────────────────────────────────────────────────────

function ElasticityTab({
  customerId,
  windowDays,
  engine,
}: {
  customerId: string
  windowDays: number
  engine: RidgeCapableEngine
}) {
  const t = useTranslations("pricingAnalytics.elasticity")
  const tShared = useTranslations("pricingAnalytics")
  const [filter, setFilter] = useState<"all" | "with" | "without">("with")

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["pricing", "elasticity", customerId, windowDays],
    queryFn: () => pricingAnalyticsApi.customerElasticity(customerId, windowDays),
    enabled: !!customerId,
  })

  const rows = useMemo(() => {
    if (!data) return []
    const sorted = [...data.outlets].sort((a, b) => {
      // With elasticity first, then by |elasticity| desc
      const aHas = a.elasticity != null
      const bHas = b.elasticity != null
      if (aHas !== bHas) return aHas ? -1 : 1
      return Math.abs(b.elasticity ?? 0) - Math.abs(a.elasticity ?? 0)
    })
    if (filter === "with") return sorted.filter((o) => o.elasticity != null)
    if (filter === "without") return sorted.filter((o) => o.elasticity == null)
    return sorted
  }, [data, filter])

  if (isLoading) return <div className="text-sm text-[var(--muted-foreground)]">{tShared("loading")}</div>
  if (error || !data) return <ErrorBox message={tShared("error")} onRetry={() => refetch()} />

  return (
    <div className="space-y-4">
      <EventElasticityCard customerId={customerId} engine={engine} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{t("heading")}</CardTitle>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("subheading")}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <StatCell
              label={t("median")}
              value={fmtElasticity(data.median_elasticity)}
            />
            <StatCell
              label={t("p10p90")}
              value={`${fmtElasticity(data.p10_elasticity)} / ${fmtElasticity(data.p90_elasticity)}`}
            />
            <StatCell
              label={t("coverage")}
              value={`${data.n_outlets_with_elasticity} / ${data.n_outlets}`}
            />
          </div>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            {t("coverageExplain", {
              covered: data.n_outlets_with_elasticity,
              total: data.n_outlets,
            })}
          </p>
        </CardContent>
      </Card>

      <ElasticityCoverageCard customerId={customerId} windowDays={windowDays} engine={engine} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{t("outletTable")}</CardTitle>
            <div className="flex gap-1">
              {(["all", "with", "without"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}
                  className="h-7 px-2 text-xs"
                >
                  {t(f === "all" ? "filterAll" : f === "with" ? "filterWithElasticity" : "filterWithoutElasticity")}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              {t("noRows")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colOutlet")}</TableHead>
                    <TableHead className="text-right">{t("colElasticity")}</TableHead>
                    <TableHead className="text-right">{t("colBeta")}</TableHead>
                    <TableHead className="text-right">{t("colMeanPrice")}</TableHead>
                    <TableHead className="text-right">{t("colMeanDemand")}</TableHead>
                    <TableHead className="text-right">{t("colPriceCv")}</TableHead>
                    <TableHead className="text-right">{t("colWithinWeekdayCv")}</TableHead>
                    <TableHead>{t("colConfidence")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 300).map((o) => (
                    <ElasticityRow key={o.outlet_id} outlet={o} />
                  ))}
                </TableBody>
              </Table>
              {rows.length > 300 && (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  Showing first 300 of {rows.length} outlets.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ElasticityRow({ outlet }: { outlet: OutletElasticity }) {
  const t = useTranslations("pricingAnalytics.elasticity")
  const confidenceLabel: Record<ElasticityConfidence, string> = {
    high: t("confidenceHigh"),
    medium: t("confidenceMedium"),
    low: t("confidenceLow"),
    insufficient_data: t("confidenceInsufficient"),
  }
  return (
    <TableRow>
      <TableCell className="font-medium">{outlet.outlet_name ?? outlet.outlet_id.slice(0, 8)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtElasticity(outlet.elasticity)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtElasticity(outlet.beta_price)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtNum(outlet.mean_price)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtNum(outlet.mean_demand)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtNum(outlet.price_cv, 3)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtNum(outlet.within_weekday_cv, 3)}</TableCell>
      <TableCell>
        <Badge variant={confidenceVariant(outlet.confidence)} className="text-xs">
          {confidenceLabel[outlet.confidence]}
        </Badge>
      </TableCell>
    </TableRow>
  )
}

// ─── Coverage card (Track 1: backfill) ────────────────────────────────────────

function ElasticityCoverageCard({
  customerId,
  windowDays,
  engine,
}: {
  customerId: string
  windowDays: number
  engine: RidgeCapableEngine
}) {
  const t = useTranslations("pricingAnalytics.elasticity")
  const queryClient = useQueryClient()
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["pricing", "coverage", customerId, windowDays],
    queryFn: () => pricingAnalyticsApi.customerCoverage(customerId, windowDays),
    enabled: !!customerId,
  })

  const backfill = useMutation({
    mutationFn: () =>
      pricingAnalyticsApi.customerBackfill(customerId, {
        engine,
        window_days: windowDays,
      }),
    onSuccess: (resp) => {
      setIsError(false)
      if (resp.task_id == null) {
        setResultMessage(t("backfillNothingToDo"))
      } else {
        setResultMessage(
          t("backfillSuccess", {
            count: resp.n_outlets_dispatched,
            engine: resp.engine,
          })
        )
      }
      queryClient.invalidateQueries({ queryKey: ["pricing", "coverage", customerId] })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    },
    onError: (e: unknown) => {
      setIsError(true)
      const msg = e instanceof Error ? e.message : ""
      setResultMessage(`${t("backfillError")} ${msg}`.trim())
    },
  })

  if (!data) return null

  const canBackfill = data.n_missing_viable > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{t("coverageBreakdownHeading")}</CardTitle>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("coverageBreakdownSubheading")}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <CoverageCell
            label={t("coverageWithLog")}
            value={data.n_with_log}
            total={data.n_outlets}
            hint={t("coverageWithLogHint")}
            accent="success"
          />
          <CoverageCell
            label={t("coverageWithLegacy")}
            value={data.n_with_legacy}
            total={data.n_outlets}
            hint={t("coverageWithLegacyHint")}
          />
          <CoverageCell
            label={t("coverageMissingViable")}
            value={data.n_missing_viable}
            total={data.n_outlets}
            hint={t("coverageMissingViableHint")}
            accent="warning"
          />
          <CoverageCell
            label={t("coverageMissingNotViable")}
            value={data.n_missing_not_viable}
            total={data.n_outlets}
            hint={t("coverageMissingNotViableHint")}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={!canBackfill || backfill.isPending}
            onClick={() => backfill.mutate()}
          >
            {backfill.isPending
              ? t("backfillRunning")
              : `${t("backfillButton")}${
                  canBackfill ? ` (${data.n_missing_viable})` : ""
                }`}
          </Button>
          <span className="text-xs text-[var(--muted-foreground)]">
            {t("backfillEngineLabel")}{" "}
            <span className="font-medium text-[var(--foreground)] capitalize">{engine}</span>
            {" — "}{t("backfillEngineFromParameters")}
          </span>
        </div>

        {resultMessage && (
          <div
            className={cn(
              "rounded-lg border p-3 text-xs",
              isError
                ? "border-[var(--destructive)]/40 bg-[var(--destructive)]/5 text-[var(--destructive)]"
                : "border-[var(--border)] bg-[var(--muted)]/30 text-[var(--foreground)]"
            )}
          >
            {resultMessage}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CoverageCell({
  label,
  value,
  total,
  hint,
  accent,
}: {
  label: string
  value: number
  total: number
  hint: string
  accent?: "success" | "warning"
}) {
  const accentClass =
    accent === "success"
      ? "text-green-600 dark:text-green-400"
      : accent === "warning"
        ? "text-yellow-700 dark:text-yellow-400"
        : "text-[var(--foreground)]"
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", accentClass)}>
        {value}
        <span className="ml-1 text-sm font-normal text-[var(--muted-foreground)]">
          / {total}
        </span>
      </div>
      <div className="mt-1 text-xs text-[var(--muted-foreground)] tabular-nums">
        {pct.toFixed(1)}%
      </div>
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">{hint}</p>
    </div>
  )
}

// ─── Event-based elasticity card ─────────────────────────────────────────────

const POST_DAYS_OPTIONS = [14, 30, 60, 90] as const

function eventConfidenceVariant(
  c: EventConfidence,
): "success" | "info" | "warning" | "muted" {
  if (c === "high") return "success"
  if (c === "medium") return "info"
  if (c === "low") return "warning"
  return "muted"
}

const WEEKDAY_NAMES_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function EventElasticityCard({
  customerId,
  engine,
}: {
  customerId: string
  engine: RidgeCapableEngine
}) {
  const t = useTranslations("pricingAnalytics.events")
  const queryClient = useQueryClient()
  const [postDays, setPostDays] = useState<number>(30)
  const [showAll, setShowAll] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const summaryQuery = useQuery({
    queryKey: ["elasticity-events", "summary", customerId, engine, postDays],
    queryFn: () =>
      elasticityEventsApi.customerSummary(customerId, engine, postDays),
    enabled: !!customerId,
  })

  const build = useMutation({
    mutationFn: () =>
      elasticityEventsApi.build(customerId, {
        engine,
        post_days: postDays,
      }),
    onSuccess: (resp) => {
      setIsError(false)
      setResultMessage(resp.message)
      queryClient.invalidateQueries({
        queryKey: ["elasticity-events", "summary", customerId],
      })
    },
    onError: (e: unknown) => {
      setIsError(true)
      const msg = e instanceof Error ? e.message : ""
      setResultMessage(`${t("buildError")} ${msg}`.trim())
    },
  })

  const data = summaryQuery.data

  // Flatten events from all outlets, sorted by date desc.
  const allEvents: EventWithEstimate[] = useMemo(() => {
    if (!data) return []
    const flat: EventWithEstimate[] = []
    for (const ot of data.outlets) flat.push(...ot.events)
    return flat.sort((a, b) =>
      a.event.change_date < b.event.change_date ? 1 : -1,
    )
  }, [data])

  const visibleEvents = showAll ? allEvents : allEvents.slice(0, 50)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t("heading")}</CardTitle>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("subheading")}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => summaryQuery.refetch()}
            disabled={summaryQuery.isFetching}
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                summaryQuery.isFetching && "animate-spin",
              )}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-[var(--muted-foreground)]">
            {t("postDaysLabel")}
          </Label>
          <div className="flex gap-1">
            {POST_DAYS_OPTIONS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={postDays === d ? "default" : "outline"}
                onClick={() => setPostDays(d)}
                className="h-7 px-2 text-xs"
              >
                {d}d
              </Button>
            ))}
          </div>
        </div>

        {data ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCell
                label={t("medianEpsilon")}
                value={fmtElasticity(data.median_epsilon)}
              />
              <StatCell
                label={t("p10p90")}
                value={`${fmtElasticity(data.p10_epsilon)} / ${fmtElasticity(data.p90_epsilon)}`}
              />
              <StatCell
                label={t("eventsWithEstimate")}
                value={`${data.n_events_with_estimate} / ${data.n_events_total}`}
              />
              <StatCell
                label={t("driftLabel")}
                value={
                  data.drift_slope == null
                    ? "—"
                    : `${data.drift_slope > 0 ? "+" : ""}${data.drift_slope.toFixed(3)}/yr`
                }
              />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t("explain", {
                engine: engine,
                postDays,
                detected: data.n_events_total,
              })}
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            {summaryQuery.isLoading ? t("loading") : t("noData")}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={build.isPending}
            onClick={() => build.mutate()}
          >
            {build.isPending ? t("buildRunning") : t("buildButton")}
          </Button>
          <span className="text-xs text-[var(--muted-foreground)]">
            {t("buildHint", { engine, postDays })}
          </span>
        </div>

        {resultMessage && (
          <div
            className={cn(
              "rounded-lg border p-3 text-xs",
              isError
                ? "border-[var(--destructive)]/40 bg-[var(--destructive)]/5 text-[var(--destructive)]"
                : "border-[var(--border)] bg-[var(--muted)]/30 text-[var(--foreground)]",
            )}
          >
            {resultMessage}
          </div>
        )}

        {data && allEvents.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colDate")}</TableHead>
                  <TableHead>{t("colWeekday")}</TableHead>
                  <TableHead>{t("colOutlet")}</TableHead>
                  <TableHead className="text-right">{t("colPriceChange")}</TableHead>
                  <TableHead className="text-right">{t("colPostDays")}</TableHead>
                  <TableHead className="text-right">{t("colEpsilon")}</TableHead>
                  <TableHead>{t("colConfidence")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEvents.map((row) => (
                  <EventRow
                    key={row.event.id}
                    row={row}
                    t={t}
                  />
                ))}
              </TableBody>
            </Table>
            {allEvents.length > visibleEvents.length && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => setShowAll(true)}
              >
                {t("showAll", {
                  hidden: allEvents.length - visibleEvents.length,
                })}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EventRow({
  row,
  t,
}: {
  row: EventWithEstimate
  t: ReturnType<typeof useTranslations<"pricingAnalytics.events">>
}) {
  const e = row.event
  const est = row.estimate
  const conf: EventConfidence = est?.confidence ?? "insufficient"
  const confLabel: Record<EventConfidence, string> = {
    high: t("confidenceHigh"),
    medium: t("confidenceMedium"),
    low: t("confidenceLow"),
    insufficient: t("confidenceInsufficient"),
  }
  return (
    <TableRow>
      <TableCell className="tabular-nums text-xs">{e.change_date}</TableCell>
      <TableCell className="text-xs">{WEEKDAY_NAMES_SHORT[e.weekday]}</TableCell>
      <TableCell className="font-medium">
        {e.outlet_name ?? e.outlet_id.slice(0, 8)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {e.price_before.toFixed(2)} → {e.price_after.toFixed(2)}{" "}
        <span className="text-xs text-[var(--muted-foreground)]">
          ({e.pct_change >= 0 ? "+" : ""}
          {(e.pct_change * 100).toFixed(1)}%)
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {est ? est.n_post_days : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {est && est.epsilon != null ? fmtElasticity(est.epsilon) : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={eventConfidenceVariant(conf)} className="text-xs">
          {confLabel[conf]}
        </Badge>
      </TableCell>
    </TableRow>
  )
}

// ─── Scenarios tab ────────────────────────────────────────────────────────────

const ADJUSTMENT_OPTIONS = [-0.2, -0.15, -0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1, 0.15, 0.2]
const DEFAULT_ADJUSTMENTS = [-0.1, -0.05, 0, 0.05, 0.1]

function recommendationStatusKey(status: RecommendationStatus): {
  label: string
  explain: string
  variant: "success" | "warning" | "muted" | "destructive"
} {
  switch (status) {
    case "recommended":
      return { label: "statusRecommended", explain: "", variant: "success" }
    case "boundary_high":
      return {
        label: "statusBoundaryHigh",
        explain: "statusBoundaryHighExplain",
        variant: "warning",
      }
    case "boundary_low":
      return {
        label: "statusBoundaryLow",
        explain: "statusBoundaryLowExplain",
        variant: "warning",
      }
    case "no_change":
      return {
        label: "statusNoChange",
        explain: "statusNoChangeExplain",
        variant: "muted",
      }
    case "insufficient_data":
    default:
      return {
        label: "statusInsufficient",
        explain: "statusInsufficientExplain",
        variant: "muted",
      }
  }
}

function RecommendationCallout({
  customerId,
  windowDays,
  appliedPct,
  onApply,
}: {
  customerId: string
  windowDays: number
  appliedPct: number | null
  onApply: (pct: number) => void
}) {
  const t = useTranslations("pricingAnalytics.recommendation")
  const tScenarios = useTranslations("pricingAnalytics.scenarios")

  const { data, isLoading, error } = useQuery({
    queryKey: ["pricing", "recommendation", customerId, windowDays],
    queryFn: () =>
      pricingAnalyticsApi.customerRecommendation(customerId, windowDays, false),
    enabled: !!customerId,
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-[var(--muted-foreground)]">
          {t("loading")}
        </CardContent>
      </Card>
    )
  }
  if (error || !data) {
    return null
  }

  const meta = recommendationStatusKey(data.status)
  const recommendedPct = data.recommended_adjustment_pct
  const canApply =
    recommendedPct != null &&
    (data.status === "recommended" ||
      data.status === "boundary_high" ||
      data.status === "boundary_low")
  const isApplied = appliedPct != null && recommendedPct != null && appliedPct === recommendedPct
  const upliftAccent: "success" | "destructive" | undefined =
    data.profit_uplift_pct != null
      ? data.profit_uplift_pct > 0
        ? "success"
        : data.profit_uplift_pct < 0
          ? "destructive"
          : undefined
      : undefined

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{t("heading")}</CardTitle>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("subheading")}
            </p>
          </div>
          <Badge variant={meta.variant} className="text-xs whitespace-nowrap">
            {t(meta.label)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {recommendedPct != null ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCell
                label={t("suggestedAdjustment")}
                value={fmtDecimalAsPct(recommendedPct, 1)}
              />
              <StatCell
                label={t("projectedProfit")}
                value={fmtNum(data.projected_daily_profit)}
              />
              <StatCell
                label={t("uplift")}
                value={fmtPct(data.profit_uplift_pct, 1)}
                accent={upliftAccent}
              />
              <StatCell
                label={t("safeRange")}
                value={`${fmtDecimalAsPctOrDash(data.safe_range_min_adjustment)} … ${fmtDecimalAsPctOrDash(data.safe_range_max_adjustment)}`}
              />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t("safeRangeHint")}
            </p>
            {meta.explain && (
              <div className="flex gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)]">
                  {t(meta.explain)}
                </span>
              </div>
            )}
            {data.reason && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {data.reason}
              </p>
            )}
            {canApply && (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant={isApplied ? "outline" : "default"}
                  disabled={isApplied}
                  onClick={() => onApply(recommendedPct)}
                >
                  {t("applyToScenarios")}
                </Button>
                {isApplied && (
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {t("appliedHint")}
                  </span>
                )}
              </div>
            )}
            {data.n_outlets_excluded > 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {tScenarios("excludedNotice", {
                  excluded: data.n_outlets_excluded,
                  total: data.n_outlets,
                })}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--foreground)]">
              {t(meta.explain)}
            </p>
            {data.reason && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {data.reason}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ScenariosTab({
  customerId,
  windowDays,
}: {
  customerId: string
  windowDays: number
}) {
  const t = useTranslations("pricingAnalytics.scenarios")
  const tShared = useTranslations("pricingAnalytics")
  const [selected, setSelected] = useState<Set<number>>(new Set(DEFAULT_ADJUSTMENTS))
  const [projection, setProjection] = useState<ProjectionMode>("constant_elasticity")
  const [appliedRecommendation, setAppliedRecommendation] = useState<number | null>(null)

  const adjustments = useMemo(
    () => [...selected].sort((a, b) => a - b),
    [selected]
  )

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["pricing", "scenario", customerId, windowDays, projection, adjustments.join(",")],
    queryFn: () =>
      pricingAnalyticsApi.customerScenario(customerId, adjustments, windowDays, false, projection),
    enabled: !!customerId && adjustments.length > 0,
  })

  function toggle(pct: number) {
    const next = new Set(selected)
    if (next.has(pct)) next.delete(pct)
    else next.add(pct)
    setSelected(next)
  }

  function handleApplyRecommendation(pct: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.add(pct)
      return next
    })
    setAppliedRecommendation(pct)
  }

  return (
    <div className="space-y-4">
      <RecommendationCallout
        customerId={customerId}
        windowDays={windowDays}
        appliedPct={appliedRecommendation}
        onApply={handleApplyRecommendation}
      />
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{t("heading")}</CardTitle>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("subheading")}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs text-[var(--muted-foreground)]">{t("projection")}</Label>
            <div className="mt-1 flex gap-1">
              <Button
                size="sm"
                variant={projection === "constant_elasticity" ? "default" : "outline"}
                onClick={() => setProjection("constant_elasticity")}
                className="h-7 px-2 text-xs"
              >
                {t("projectionConstant")}
              </Button>
              <Button
                size="sm"
                variant={projection === "linear" ? "default" : "outline"}
                onClick={() => setProjection("linear")}
                className="h-7 px-2 text-xs"
              >
                {t("projectionLinear")}
              </Button>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {projection === "constant_elasticity" ? t("projectionConstantHint") : t("projectionLinearHint")}
            </p>
          </div>
          <div>
            <Label className="text-xs text-[var(--muted-foreground)]">{t("adjustments")}</Label>
            <p className="mb-2 text-xs text-[var(--muted-foreground)]">{t("adjustmentsHint")}</p>
            <div className="flex flex-wrap gap-2">
              {ADJUSTMENT_OPTIONS.map((pct) => {
                const isSelected = selected.has(pct)
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => toggle(pct)}
                    className={cn(
                      "h-8 rounded-full border px-3 text-xs font-medium transition-colors tabular-nums",
                      isSelected
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)]"
                    )}
                  >
                    {fmtDecimalAsPct(pct)}
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && <div className="text-sm text-[var(--muted-foreground)]">{tShared("loading")}</div>}
      {error && <ErrorBox message={tShared("error")} onRetry={() => refetch()} />}
      {data && adjustments.length > 0 && <ScenarioResults data={data} />}
    </div>
  )
}

function ScenarioResults({ data }: { data: CustomerPriceScenario }) {
  const t = useTranslations("pricingAnalytics.scenarios")

  // Find the profit-maximising scenario, if any
  const bestIdx = useMemo(() => {
    let best = -Infinity
    let idx = -1
    data.scenarios.forEach((s, i) => {
      if (s.profit_delta_pct != null && s.profit_delta_pct > best) {
        best = s.profit_delta_pct
        idx = i
      }
    })
    return idx
  }, [data])

  const hasProfit = data.baseline_daily_profit != null

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("baseline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <StatCell label={t("baselineDemand")} value={fmtNum(data.baseline_daily_demand)} />
            <StatCell label={t("baselineRevenue")} value={fmtNum(data.baseline_daily_revenue)} />
            <StatCell
              label={t("baselineProfit")}
              value={hasProfit ? fmtNum(data.baseline_daily_profit) : "—"}
            />
          </div>
          {data.n_outlets_excluded > 0 && (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">
              {t("excludedNotice", {
                excluded: data.n_outlets_excluded,
                total: data.n_outlets,
              })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("tableHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colAdjustment")}</TableHead>
                <TableHead className="text-right">{t("colDemand")}</TableHead>
                <TableHead className="text-right">{t("colRevenue")}</TableHead>
                <TableHead className="text-right">{t("colProfit")}</TableHead>
                <TableHead className="text-right">{t("colDemandDelta")}</TableHead>
                <TableHead className="text-right">{t("colRevenueDelta")}</TableHead>
                <TableHead className="text-right">{t("colProfitDelta")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.scenarios.map((s, i) => (
                <TableRow key={s.adjustment_pct} className={i === bestIdx ? "bg-green-500/5" : ""}>
                  <TableCell className="font-medium tabular-nums">
                    {fmtDecimalAsPct(s.adjustment_pct)}
                    {i === bestIdx && (
                      <Badge variant="success" className="ml-2 text-xs">
                        {t("optimalLabel")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(s.scenario_daily_demand)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(s.scenario_daily_revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(s.scenario_daily_profit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(s.demand_delta_pct)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(s.revenue_delta_pct)}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      s.profit_delta_pct != null && s.profit_delta_pct > 0 && "text-green-600 dark:text-green-400",
                      s.profit_delta_pct != null && s.profit_delta_pct < 0 && "text-red-600 dark:text-red-400"
                    )}
                  >
                    {fmtPct(s.profit_delta_pct)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {hasProfit && <ProfitBarChart scenarios={data.scenarios} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("caveatHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-xs text-[var(--muted-foreground)]">
            <li className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {data.projection === "constant_elasticity"
                  ? t("caveatProjectionConstant")
                  : t("caveatProjectionLinear")}
              </span>
            </li>
            <li className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("caveatCoverage")}</span>
            </li>
            <li className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("caveatProfit")}</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </>
  )
}

function ProfitBarChart({
  scenarios,
}: {
  scenarios: CustomerPriceScenario["scenarios"]
}) {
  const t = useTranslations("pricingAnalytics.scenarios")
  const withProfit = scenarios.filter((s) => s.profit_delta_pct != null)
  if (withProfit.length === 0) return null

  const maxAbs = Math.max(...withProfit.map((s) => Math.abs(s.profit_delta_pct!)))
  const scale = maxAbs > 0 ? 1 / maxAbs : 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("profitChartHeading")}</CardTitle>
        <p className="text-xs text-[var(--muted-foreground)]">{t("profitChartHint")}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {scenarios.map((s) => {
            const d = s.profit_delta_pct
            if (d == null) {
              return (
                <div key={s.adjustment_pct} className="flex items-center gap-3">
                  <div className="w-14 text-right text-xs tabular-nums">{fmtDecimalAsPct(s.adjustment_pct)}</div>
                  <div className="flex-1 text-xs text-[var(--muted-foreground)]">—</div>
                </div>
              )
            }
            const width = Math.abs(d) * scale * 50 // max 50% of track
            const isGain = d >= 0
            return (
              <div key={s.adjustment_pct} className="flex items-center gap-3">
                <div className="w-14 text-right text-xs tabular-nums">{fmtDecimalAsPct(s.adjustment_pct)}</div>
                <div className="relative flex-1 h-6 bg-[var(--muted)]/30 rounded overflow-hidden">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border)]" />
                  <div
                    className={cn(
                      "absolute inset-y-0.5 rounded",
                      isGain
                        ? "left-1/2 bg-green-500/60"
                        : "right-1/2 bg-red-500/60"
                    )}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <div
                  className={cn(
                    "w-16 text-right text-xs tabular-nums",
                    isGain ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  )}
                >
                  {fmtPct(d)}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  total,
  accent,
}: {
  label: string
  value: number | string
  total?: number
  accent?: "success" | "warning" | "destructive"
}) {
  const accentClass =
    accent === "success"
      ? "text-green-600 dark:text-green-400"
      : accent === "warning"
        ? "text-yellow-700 dark:text-yellow-400"
        : accent === "destructive"
          ? "text-red-600 dark:text-red-400"
          : "text-[var(--foreground)]"

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", accentClass)}>
        {value}
        {total != null && (
          <span className="ml-1 text-sm font-normal text-[var(--muted-foreground)]">
            / {total}
          </span>
        )}
      </div>
    </div>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--destructive)]">{message}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// Per-customer persistence of Parameters-tab choices. Window persists
// regardless of what the customer's Configuration page lists; engine falls
// back to the customer's configured Prediction Engine when nothing is
// stored yet (and that engine is Ridge-capable).
const PARAM_STORAGE_PREFIX = "gorm:pricingParams:"

function paramKey(customerId: string, field: "windowDays" | "engine"): string {
  return `${PARAM_STORAGE_PREFIX}${customerId}:${field}`
}

function loadStoredWindow(customerId: string): number | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(paramKey(customerId, "windowDays"))
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && WINDOW_OPTIONS.includes(n as (typeof WINDOW_OPTIONS)[number])
    ? n
    : null
}

function loadStoredEngine(customerId: string): RidgeCapableEngine | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(paramKey(customerId, "engine"))
  return raw && (RIDGE_ENGINES as readonly string[]).includes(raw)
    ? (raw as RidgeCapableEngine)
    : null
}

export default function PricingAnalyticsPage() {
  const t = useTranslations("pricingAnalytics")
  const { activeCustomer } = useCustomer()
  const customerId = activeCustomer?.id ?? null

  const [windowDays, setWindowDaysState] = useState<number>(
    () => (customerId ? loadStoredWindow(customerId) : null) ?? 90
  )
  const [engine, setEngineState] = useState<RidgeCapableEngine>(
    () => (customerId ? loadStoredEngine(customerId) : null) ?? "flowstate"
  )
  const [tab, setTab] = useState("parameters")
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // Customer's default Prediction Engine (Configuration → Core).
  // Used as the engine fallback when nothing is persisted for this customer.
  const { data: customerConfig } = useQuery({
    queryKey: ["customer-configuration", customerId],
    queryFn: () => customerConfigurationApi.get(customerId!),
    enabled: !!customerId,
    staleTime: 60 * 1000,
  })
  const { data: predictionEngines = [] } = useQuery({
    queryKey: ["prediction-engines"],
    queryFn: () => predictionEnginesApi.list(),
    staleTime: 5 * 60 * 1000,
  })
  const customerDefaultEngine: RidgeCapableEngine | null = useMemo(() => {
    const id = customerConfig?.prediction_engine_id
    if (!id) return null
    const slug = predictionEngines.find((e) => e.id === id)?.slug
    if (slug && (RIDGE_ENGINES as readonly string[]).includes(slug)) {
      return slug as RidgeCapableEngine
    }
    return null
  }, [customerConfig?.prediction_engine_id, predictionEngines])

  // When the active customer changes, restore the stored choices for that
  // customer (or fall back to defaults). Only triggers on actual customer
  // change, not on initial mount, so the lazy initial state above isn't
  // overwritten before we know the customer.
  const prevCustomerIdRef = useRef<string | null>(customerId)
  useEffect(() => {
    if (prevCustomerIdRef.current === customerId) return
    prevCustomerIdRef.current = customerId
    if (!customerId) return
    const storedWindow = loadStoredWindow(customerId)
    setWindowDaysState(storedWindow ?? 90)
    const storedEngine = loadStoredEngine(customerId)
    if (storedEngine) setEngineState(storedEngine)
    else if (customerDefaultEngine) setEngineState(customerDefaultEngine)
    else setEngineState("flowstate")
  }, [customerId, customerDefaultEngine])

  // Apply customer-default engine on first arrival once config has loaded
  // and there's no stored choice yet for this customer.
  useEffect(() => {
    if (!customerId || !customerDefaultEngine) return
    if (loadStoredEngine(customerId) !== null) return
    setEngineState(customerDefaultEngine)
  }, [customerId, customerDefaultEngine])

  // Persist user choices.
  const setWindowDays = (v: number) => {
    setWindowDaysState(v)
    if (customerId) localStorage.setItem(paramKey(customerId, "windowDays"), String(v))
  }
  const setEngine = (v: RidgeCapableEngine) => {
    setEngineState(v)
    if (customerId) localStorage.setItem(paramKey(customerId, "engine"), v)
  }

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [tab])

  if (!activeCustomer) {
    return (
      <div className="p-6 text-sm text-[var(--muted-foreground)]">{t("noCustomer")}</div>
    )
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{t("pageSubtitle")}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="relative w-full">
          <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex justify-start">
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="parameters">{t("tabs.parameters")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="viability">{t("tabs.viability")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="elasticity">{t("tabs.elasticity")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="scenarios">{t("tabs.scenarios")}</TabsTrigger>
          </TabsList>
          <div
            className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        </div>
        <TabsContent value="parameters" className="mt-4">
          <ParametersTab
            windowDays={windowDays}
            onWindowDaysChange={setWindowDays}
            engine={engine}
            onEngineChange={setEngine}
          />
        </TabsContent>
        <TabsContent value="viability" className="mt-4">
          <ViabilityTab customerId={activeCustomer.id} windowDays={windowDays} />
        </TabsContent>
        <TabsContent value="elasticity" className="mt-4">
          <ElasticityTab customerId={activeCustomer.id} windowDays={windowDays} engine={engine} />
        </TabsContent>
        <TabsContent value="scenarios" className="mt-4">
          <ScenariosTab customerId={activeCustomer.id} windowDays={windowDays} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
