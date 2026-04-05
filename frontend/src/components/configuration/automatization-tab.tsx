"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  Info, Star, Trash2, ArrowUpDown, ChevronDown, ChevronUp, RotateCcw, Globe, Focus,
} from "lucide-react"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import {
  optimizationApi,
  predictionEnginesApi,
  type OptimizationRunResponse,
  type OptimizationCombinationResult,
  type OptimizationDiagnostics,
  type ApplySettingsRequest,
  type PredictionEngineResponse,
} from "@/lib/api"

const ITEMS_PER_PAGE = 10

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusBadgeVariant(status: string) {
  switch (status) {
    case "completed":
      return "success" as const
    case "running":
    case "started":
      return "info" as const
    case "failed":
    case "failure":
      return "destructive" as const
    case "cancelled":
      return "warning" as const
    default:
      return "muted" as const
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "completed":
      return "Completed"
    case "running":
    case "started":
      return "Running"
    case "failed":
    case "failure":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    case "pending":
      return "Pending"
    default:
      return status
  }
}

function formatSettingValue(
  key: string,
  value: unknown,
): string {
  switch (key) {
    case "variation_adjustment":
      return `VA: ${value ? "On" : "Off"}`
    case "eo_methodology":
      return `EO Method: ${Number(value) === 1 ? "Interpolate" : "Snap"}`
    case "eo_extrapolation": {
      const map: Record<number, string> = { 1: "E99", 2: "E95", 3: "E90", 4: "Dampened" }
      return `EO Extrap: ${map[Number(value)] ?? String(value)}`
    }
    case "covariate_handling": {
      const chMap: Record<string, string> = { none: "None", native: "Native", external: "External" }
      return `Covariates: ${chMap[String(value)] ?? String(value)}`
    }
    case "weekday_profile_correction":
      return `WPC: ${value ? "On" : "Off"}`
    case "variation_history_days":
      return `History: ${value} days`
    case "weekday_profile_correction_strength":
      return `Strength: ${Number(value).toFixed(2)}`
    case "weekday_profile_correction_threshold":
      return `Threshold: ${Number(value).toFixed(2)}`
    default:
      return `${key}: ${String(value)}`
  }
}

function describeCombination(
  combo: Record<string, unknown>,
  run: OptimizationRunResponse,
): string {
  const parts: string[] = []
  if (run.optimize_variation_adjustment && "variation_adjustment" in combo) {
    parts.push(formatSettingValue("variation_adjustment", combo.variation_adjustment))
  }
  if (run.optimize_eo_methodology && "eo_methodology" in combo) {
    parts.push(formatSettingValue("eo_methodology", combo.eo_methodology))
  }
  if (run.optimize_eo_extrapolation && "eo_extrapolation" in combo) {
    parts.push(formatSettingValue("eo_extrapolation", combo.eo_extrapolation))
  }
  if (run.optimize_covariate_handling && "covariate_handling" in combo) {
    parts.push(formatSettingValue("covariate_handling", combo.covariate_handling))
  }
  if (run.optimize_weekday_profile_correction && "weekday_profile_correction" in combo) {
    parts.push(formatSettingValue("weekday_profile_correction", combo.weekday_profile_correction))
  }
  // Range settings — always show if present in combo
  for (const key of ["variation_history_days", "weekday_profile_correction_strength", "weekday_profile_correction_threshold"] as const) {
    if (key in combo) parts.push(formatSettingValue(key, combo[key]))
  }
  return parts.join(", ")
}

function comboToApplyRequest(combo: Record<string, unknown>): ApplySettingsRequest {
  const req: ApplySettingsRequest = {}
  if ("variation_adjustment" in combo) req.variation_adjustment = combo.variation_adjustment as boolean
  if ("eo_methodology" in combo) req.eo_methodology = combo.eo_methodology as number
  if ("eo_extrapolation" in combo) req.eo_extrapolation = combo.eo_extrapolation as number
  if ("covariate_handling" in combo) req.covariate_handling = combo.covariate_handling as string
  if ("weekday_profile_correction" in combo) req.weekday_profile_correction = combo.weekday_profile_correction as boolean
  if ("variation_history_days" in combo) req.variation_history_days = combo.variation_history_days as number
  if ("weekday_profile_correction_strength" in combo) req.weekday_profile_correction_strength = combo.weekday_profile_correction_strength as number
  if ("weekday_profile_correction_threshold" in combo) req.weekday_profile_correction_threshold = combo.weekday_profile_correction_threshold as number
  return req
}

function generateConclusion(run: OptimizationRunResponse, results: OptimizationCombinationResult[]): string {
  if (results.length === 0 || !run.best_combination) return ""

  const bestDesc = describeCombination(run.best_combination, run)
  const bestScore = run.best_score?.toFixed(2) ?? "N/A"
  const worst = results[results.length - 1]
  const diff = run.best_score != null && worst.score != null ? (run.best_score - worst.score) : 0
  const pct = worst.score != null && worst.score !== 0 ? Math.abs(diff / worst.score * 100).toFixed(1) : "N/A"

  const parts: string[] = [
    `The optimal configuration is ${bestDesc} with a profit score of ${bestScore}.`,
    `This outperforms the worst combination by ${diff.toFixed(2)} points (${pct}%).`,
  ]

  if (run.optimize_variation_adjustment && results.length >= 2) {
    const vaOn = results.find((r) => r.combination.variation_adjustment === true)
    const vaOff = results.find((r) => r.combination.variation_adjustment === false)
    if (vaOn && vaOff && vaOn.score != null && vaOff.score != null) {
      parts.push(
        vaOn.score >= vaOff.score
          ? "Variation Adjustment improves results."
          : "Variation Adjustment does not improve results."
      )
    }
  }

  if (run.optimize_eo_methodology && results.length >= 2) {
    const interp = results.find((r) => Number(r.combination.eo_methodology) === 1)
    const snap = results.find((r) => Number(r.combination.eo_methodology) === 2)
    if (interp && snap && interp.score != null && snap.score != null) {
      parts.push(
        interp.score >= snap.score
          ? "Interpolate methodology performs better."
          : "Snap methodology performs better."
      )
    }
  }

  return parts.join(" ")
}

function isStoppedStatus(status: string): boolean {
  return status === "failed" || status === "failure" || status === "cancelled"
}

// ─── Diagnostics Panel ──────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
// Backend uses numeric keys "0"-"6" (0=Mon..6=Sun)
const WEEKDAY_NUMERIC = ["0", "1", "2", "3", "4", "5", "6"] as const

function DiagnosticsPanel({
  diagnostics,
  t,
}: {
  diagnostics: OptimizationDiagnostics
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  // Handle both old key (g_by_tau_range) and new key (g3_g4_by_tau)
  // Handle both old key (g_by_tau_range) and new key (g3_g4_by_tau)
  const g3_g4_by_tau = diagnostics.g3_g4_by_tau ?? (diagnostics as unknown as Record<string, unknown>)["g_by_tau_range"] as OptimizationDiagnostics["g3_g4_by_tau"] ?? null
  const { quantile_calibration, g3_by_weekday, va_comparison } = diagnostics

  const g3Rate = (g3: number, g4: number) => {
    const total = g3 + g4
    return total === 0 ? 0 : (g3 / total) * 100
  }

  return (
    <div className="space-y-4">
      <h5 className="text-sm font-semibold">{t("diagnosticsTitle")}</h5>

      {/* Diagnostic 1: Interpolation vs Extrapolation */}
      {g3_g4_by_tau && (
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 mb-2">
            <h6 className="text-xs font-semibold">Diagnostic 1 — Interpolation vs Extrapolation</h6>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                If a significant proportion of G3 (waste) vs G4 (potential extra sales) comes from the extrapolation range, the extrapolation formula may be too aggressive — ordering more than the distribution supports.
              </TooltipContent>
            </Tooltip>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 pr-2 font-medium">Range</th>
                <th className="text-right py-1 px-1 font-medium">G1</th>
                <th className="text-right py-1 px-1 font-medium">G2</th>
                <th className="text-right py-1 px-1 font-medium">G3</th>
                <th className="text-right py-1 px-1 font-medium">G4</th>
                <th className="text-right py-1 pl-1 font-medium">{t("diagnosticG3Rate")}</th>
              </tr>
            </thead>
            <tbody>
              {(["interpolation", "extrapolation"] as const).map((range) => {
                const d = g3_g4_by_tau[range]
                const rate = g3Rate(d.g3, d.g4)
                return (
                  <tr key={range} className="border-b last:border-b-0">
                    <td className="py-1 pr-2">
                      {range === "interpolation"
                        ? t("diagnosticInterpolation")
                        : t("diagnosticExtrapolation")}
                    </td>
                    <td className="text-right py-1 px-1 font-mono">{d.g1}</td>
                    <td className="text-right py-1 px-1 font-mono">{d.g2}</td>
                    <td className="text-right py-1 px-1 font-mono">{d.g3}</td>
                    <td className="text-right py-1 px-1 font-mono">{d.g4}</td>
                    <td className="text-right py-1 pl-1 font-mono">{rate.toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(() => {
            const interpRate = g3Rate(g3_g4_by_tau.interpolation.g3, g3_g4_by_tau.interpolation.g4)
            const extrapRate = g3Rate(g3_g4_by_tau.extrapolation.g3, g3_g4_by_tau.extrapolation.g4)
            if (extrapRate > interpRate + 10) {
              return (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                  Extrapolation contributes disproportionately to G3 — consider a more conservative extrapolation mode.
                </p>
              )
            }
            return null
          })()}
        </div>
      )}

      {/* Diagnostic 2: Quantile Calibration */}
      {quantile_calibration && (
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 mb-2">
            <h6 className="text-xs font-semibold">Diagnostic 2 — Quantile Calibration</h6>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                Checks what fraction of actual sales fell below Q90. If significantly more than 90%, quantiles are too wide (over-ordering). If significantly less than 90%, quantiles are too narrow (under-ordering).
              </TooltipContent>
            </Tooltip>
          </div>
          {(() => {
            const pctRaw = quantile_calibration.pct_below_q90
            const pct = pctRaw <= 1 ? pctRaw * 100 : pctRaw
            const deviation = Math.abs(pct - 90)
            const color =
              deviation <= 3
                ? "text-green-600 dark:text-green-400"
                : deviation <= 7
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-red-600 dark:text-red-400"
            const bgColor =
              deviation <= 3
                ? "bg-green-100 dark:bg-green-900/30"
                : deviation <= 7
                  ? "bg-yellow-100 dark:bg-yellow-900/30"
                  : "bg-red-100 dark:bg-red-900/30"
            return (
              <div className="space-y-2">
                <div className={`rounded px-2 py-1.5 ${bgColor}`}>
                  <p className={`text-xs font-medium ${color}`}>
                    {t("diagnosticQuantileDesc", { pct: pct.toFixed(1) })}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {quantile_calibration.assessment}
                </p>
              </div>
            )
          })()}
        </div>
      )}

      {/* Diagnostic 3: G3 by Weekday */}
      {g3_by_weekday && (
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 mb-2">
            <h6 className="text-xs font-semibold">Diagnostic 3 — G3 by Weekday</h6>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                If G3 (waste) clusters on specific weekdays, either the weekday correction or the CV estimation for those days is the culprit.
              </TooltipContent>
            </Tooltip>
          </div>
          {(() => {
            const entries = WEEKDAY_NUMERIC
              .map((numKey, i) => ({
                key: WEEKDAY_LABELS[i],
                data: g3_by_weekday.weekdays[numKey] ?? g3_by_weekday.weekdays[WEEKDAY_LABELS[i]] ?? null,
              }))
              .filter((e) => e.data !== null && e.data.total > 0)

            const avgRate =
              entries.length > 0
                ? entries.reduce((sum, e) => sum + e.data!.g3_rate, 0) / entries.length
                : 0

            const hasCluster = entries.some((e) => e.data!.g3_rate > avgRate + 10)

            return (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-2 font-medium">Day</th>
                      <th className="text-right py-1 px-1 font-medium">G3 Count</th>
                      <th className="text-right py-1 px-1 font-medium">Total</th>
                      <th className="text-right py-1 pl-1 font-medium">{t("diagnosticG3Rate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(({ key, data }) => {
                      const isHigh = data!.g3_rate > avgRate + 10
                      return (
                        <tr
                          key={key}
                          className={`border-b last:border-b-0 ${isHigh ? "bg-red-50 dark:bg-red-900/20" : ""}`}
                        >
                          <td className="py-1 pr-2">
                            {t(`diagnostic${key.charAt(0).toUpperCase() + key.slice(1)}` as Parameters<typeof t>[0])}
                          </td>
                          <td className="text-right py-1 px-1 font-mono">{data!.g3_count}</td>
                          <td className="text-right py-1 px-1 font-mono">{data!.total}</td>
                          <td className={`text-right py-1 pl-1 font-mono ${isHigh ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                            {(data!.g3_rate <= 1 ? data!.g3_rate * 100 : data!.g3_rate).toFixed(1)}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {hasCluster && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                    G3 rates are clustered on specific weekdays — consider weekday-specific tuning.
                  </p>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* Diagnostic 4: VA Comparison */}
      {va_comparison && (
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 mb-2">
            <h6 className="text-xs font-semibold">Diagnostic 4 — Variation Adjustment Impact</h6>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                If disabling Variation Adjustment reduces G3 (waste) without proportionally increasing G2 (lost sales), the CV-based adjustment is too aggressive.
              </TooltipContent>
            </Tooltip>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 pr-2 font-medium">Metric</th>
                <th className="text-right py-1 px-1 font-medium">{t("diagnosticWithVa")}</th>
                <th className="text-right py-1 px-1 font-medium">{t("diagnosticWithoutVa")}</th>
                <th className="text-right py-1 pl-1 font-medium">{t("diagnosticDelta")}</th>
              </tr>
            </thead>
            <tbody>
              {(["g1", "g2", "g3", "g4", "score"] as const).map((metric) => {
                const withVal = va_comparison.with_va[metric]
                const withoutVal = va_comparison.without_va[metric]
                const delta = withVal - withoutVal
                return (
                  <tr key={metric} className="border-b last:border-b-0">
                    <td className="py-1 pr-2 font-medium">{metric.toUpperCase()}</td>
                    <td className="text-right py-1 px-1 font-mono">
                      {withVal.toFixed(2)}
                    </td>
                    <td className="text-right py-1 px-1 font-mono">
                      {withoutVal.toFixed(2)}
                    </td>
                    <td
                      className={`text-right py-1 pl-1 font-mono ${
                        delta > 0
                          ? "text-green-600 dark:text-green-400"
                          : delta < 0
                            ? "text-red-600 dark:text-red-400"
                            : ""
                      }`}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta.toFixed(2)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground mt-2">
            {va_comparison.assessment}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Sort helpers ───────────────────────────────────────────────────────────

type MasterSortField = "name" | "prediction_engine" | "total_combinations" | "simulation_days" | "created_at" | "status" | "starred"
type SortDir = "asc" | "desc"

function SortableHead({
  field,
  current,
  dir,
  onSort,
  children,
  className,
}: {
  field: MasterSortField
  current: MasterSortField
  dir: SortDir
  onSort: (f: MasterSortField) => void
  children: React.ReactNode
  className?: string
}) {
  const active = field === current
  return (
    <TableHead
      className={`cursor-pointer select-none ${className ?? ""}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active ? (
          dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
      </span>
    </TableHead>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

interface AutomatizationTabProps {
  onOpenOptimize?: () => void
}

export function AutomatizationTab({ onOpenOptimize }: AutomatizationTabProps = {}) {
  const t = useTranslations("configuration")
  const router = useRouter()
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState("details")
  const detailTabsRef = useRef<HTMLDivElement>(null)
  const [detailIndicator, setDetailIndicator] = useState({ left: 0, width: 0 })

  // Master table state
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [showOnlyChecked, setShowOnlyChecked] = useState(false)
  const [sortField, setSortField] = useState<MasterSortField>("created_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("")
  const [currentPage, setCurrentPage] = useState(1)

  const customerId = activeCustomer?.id ?? ""

  // Fetch list of optimization runs
  const { data: runs = [] } = useQuery({
    queryKey: ["optimizationRuns", customerId],
    queryFn: () => optimizationApi.list(customerId),
    enabled: !!customerId,
    refetchInterval: (query) => {
      const data = query.state.data as OptimizationRunResponse[] | undefined
      if (data?.some((r) => r.status === "running" || r.status === "started" || r.status === "pending")) {
        return 10_000
      }
      return false
    },
  })

  // Fetch prediction engines for name lookup
  const { data: engines = [] } = useQuery({
    queryKey: ["predictionEngines"],
    queryFn: () => predictionEnginesApi.list(),
    staleTime: 60_000,
  })

  const engineMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of engines) map.set(e.id, e.name)
    return map
  }, [engines])

  // Fetch selected run details
  const { data: selectedRun } = useQuery({
    queryKey: ["optimizationRun", selectedRunId],
    queryFn: () => optimizationApi.get(selectedRunId!),
    enabled: !!selectedRunId,
    refetchInterval: (query) => {
      const data = query.state.data as OptimizationRunResponse | undefined
      if (data && (data.status === "running" || data.status === "started" || data.status === "pending")) {
        return 5_000
      }
      return false
    },
  })

  // Apply mutation
  const applyMutation = useMutation({
    mutationFn: ({ runId, data }: { runId: string; data: ApplySettingsRequest }) =>
      optimizationApi.apply(runId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customerConfiguration", customerId] })
      toast.success(t("automatizationApplied"))
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to apply settings")
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (runId: string) => optimizationApi.delete(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["optimizationRuns", customerId] })
    },
  })

  // Resume mutation
  const resumeMutation = useMutation({
    mutationFn: ({ runId, worker }: { runId: string; worker?: string }) =>
      optimizationApi.resume(runId, worker),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["optimizationRuns", customerId] })
      queryClient.invalidateQueries({ queryKey: ["optimizationRun", selectedRunId] })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      toast.success(t("automatizationResumeSuccess"))
    },
    onError: () => toast.error(t("automatizationResumeError")),
  })

  // ── Detail tab indicator ────────────────────────────────────────────────
  useEffect(() => {
    if (!detailTabsRef.current) return
    const el = detailTabsRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setDetailIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [detailTab, selectedRunId])

  // ── Sorting & filtering ─────────────────────────────────────────────────

  function handleSort(field: MasterSortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir(field === "created_at" ? "desc" : "asc")
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const displayRuns = useMemo(() => {
    let items = showOnlyChecked
      ? runs.filter((r) => checkedIds.has(r.id))
      : runs

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name":
          va = a.name ?? ""; vb = b.name ?? ""; break
        case "prediction_engine":
          va = a.engine_name ?? (a.prediction_engine_id ? engineMap.get(a.prediction_engine_id) ?? "" : ""); vb = b.engine_name ?? (b.prediction_engine_id ? engineMap.get(b.prediction_engine_id) ?? "" : ""); break
        case "total_combinations":
          va = a.total_combinations; vb = b.total_combinations; break
        case "simulation_days": {
          const daysOf = (r: typeof a) => r.simulation_from && r.simulation_to
            ? Math.round((new Date(r.simulation_to).getTime() - new Date(r.simulation_from).getTime()) / 86400000) + 1
            : r.simulation_days
          va = daysOf(a); vb = daysOf(b); break
        }
        case "created_at":
          va = a.created_at; vb = b.created_at; break
        case "status":
          va = a.status; vb = b.status; break
        case "starred":
          va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1
      if (va > vb) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [runs, sortField, sortDir, showOnlyChecked, checkedIds, starredIds, engineMap])

  // ── Pagination ──────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(displayRuns.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = displayRuns.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // Reset page when data changes significantly
  useEffect(() => {
    setCurrentPage(1)
  }, [customerId, showOnlyChecked])

  function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const pages: (number | "ellipsis")[] = [1]
    if (current > 3) pages.push("ellipsis")
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
    if (current < total - 2) pages.push("ellipsis")
    if (total > 1) pages.push(total)
    return pages
  }

  // ── Checkbox header state ───────────────────────────────────────────────

  const allChecked = displayRuns.length > 0 && displayRuns.every((r) => checkedIds.has(r.id))
  const someChecked = displayRuns.some((r) => checkedIds.has(r.id))
  const headerChecked: boolean | "indeterminate" = allChecked ? true : someChecked ? "indeterminate" : false

  function handleHeaderCheck(checked: boolean) {
    if (checked) {
      setCheckedIds(new Set(displayRuns.map((r) => r.id)))
    } else {
      setCheckedIds(new Set())
    }
  }

  // ── Delete logic ────────────────────────────────────────────────────────

  async function handleDeleteSelected() {
    const ids = [...checkedIds]
    try {
      await Promise.all(ids.map((id) => deleteMutation.mutateAsync(id)))
      setCheckedIds(new Set())
      setShowOnlyChecked(false)
      if (selectedRunId && ids.includes(selectedRunId)) {
        setSelectedRunId(null)
      }
      toast.success(t("automatizationDeleted"))
    } catch {
      toast.error(t("automatizationDeleteError"))
    }
    setDeleteDialogOpen(false)
    setDeleteUnderstood(false)
    setDeleteConfirmInput("")
  }

  const sortedResults = selectedRun?.results
    ? [...selectedRun.results].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    : []

  const bestScore = sortedResults.length > 0 ? sortedResults[0].score : null

  return (
    <div className="space-y-6">
      {/* History table */}
      <div>
        <h4 className="text-sm font-semibold mb-2">{t("automatizationHistoryTitle")}</h4>

        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("automatizationNoRuns")}</p>
        ) : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <div className="flex items-center gap-1">
                    <Checkbox
                      checked={headerChecked}
                      onCheckedChange={handleHeaderCheck}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-0.5 rounded hover:bg-muted cursor-pointer">
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setCheckedIds(new Set(displayRuns.map((r) => r.id)))}>
                          {t("automatizationSelectAll")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCheckedIds(new Set(displayRuns.filter((r) => starredIds.has(r.id)).map((r) => r.id)))}>
                          {t("automatizationSelectStarred")}
                        </DropdownMenuItem>
                        {(() => {
                          const engineNames = [...new Set(displayRuns
                            .map((r) => r.engine_name ?? (r.prediction_engine_id ? engineMap.get(r.prediction_engine_id) : null))
                            .filter((n): n is string => !!n)
                          )].sort()
                          if (engineNames.length === 0) return null
                          return <>
                            <DropdownMenuSeparator />
                            {engineNames.map((name) => (
                              <DropdownMenuItem key={name} onClick={() => setCheckedIds(new Set(
                                displayRuns.filter((r) => (r.engine_name ?? (r.prediction_engine_id ? engineMap.get(r.prediction_engine_id) : null)) === name).map((r) => r.id)
                              ))}>
                                {t("automatizationSelectEngine", { engine: name })}
                              </DropdownMenuItem>
                            ))}
                          </>
                        })()}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <SortableHead field="name" current={sortField} dir={sortDir} onSort={handleSort}>
                  {t("automatizationColumnName")}
                </SortableHead>
                <SortableHead field="prediction_engine" current={sortField} dir={sortDir} onSort={handleSort}>
                  {t("automatizationColumnEngine")}
                </SortableHead>
                <SortableHead field="total_combinations" current={sortField} dir={sortDir} onSort={handleSort}>
                  {t("automatizationColumnCombinations")}
                </SortableHead>
                <SortableHead field="simulation_days" current={sortField} dir={sortDir} onSort={handleSort}>
                  {t("automatizationColumnPeriod")}
                </SortableHead>
                <SortableHead field="created_at" current={sortField} dir={sortDir} onSort={handleSort}>
                  {t("automatizationColumnDate")}
                </SortableHead>
                <SortableHead field="status" current={sortField} dir={sortDir} onSort={handleSort}>
                  {t("automatizationColumnStatus")}
                </SortableHead>
                <SortableHead field="starred" current={sortField} dir={sortDir} onSort={handleSort} className="w-10">
                  <Star className="h-3.5 w-3.5" />
                </SortableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((run) => (
                <TableRow
                  key={run.id}
                  className={`cursor-pointer ${selectedRunId === run.id ? "bg-muted/70" : ""}`}
                  onClick={() => setSelectedRunId(selectedRunId === run.id ? null : run.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    handleStar(run.id)
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={checkedIds.has(run.id)}
                      onCheckedChange={(checked) => {
                        setCheckedIds((prev) => {
                          const n = new Set(prev)
                          checked ? n.add(run.id) : n.delete(run.id)
                          return n
                        })
                      }}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{run.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {run.engine_name ?? (run.prediction_engine_id ? engineMap.get(run.prediction_engine_id) ?? "—" : "—")}
                  </TableCell>
                  <TableCell>
                    {t("automatizationCombinations", { count: run.total_combinations })}
                  </TableCell>
                  <TableCell>
                    {run.simulation_from && run.simulation_to
                      ? t("automatizationDays", {
                          count: Math.round(
                            (new Date(run.simulation_to).getTime() - new Date(run.simulation_from).getTime()) / 86400000
                          ) + 1,
                        })
                      : t("automatizationDays", { count: run.simulation_days })}
                  </TableCell>
                  <TableCell>
                    {new Date(run.created_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(run.status)}>
                      {statusLabel(run.status)}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <button
                      className="cursor-pointer p-0.5 rounded hover:bg-muted"
                      onClick={() => handleStar(run.id)}
                    >
                      <Star
                        className={`h-4 w-4 ${
                          starredIds.has(run.id)
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground"
                        }`}
                      />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {displayRuns.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-2 border-t">
              <span className="text-xs text-muted-foreground">
                {t("automatizationShowing", {
                  from: (safePage - 1) * ITEMS_PER_PAGE + 1,
                  to: Math.min(safePage * ITEMS_PER_PAGE, displayRuns.length),
                  total: displayRuns.length,
                })}
              </span>
              <Pagination className="w-auto mx-0">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                    />
                  </PaginationItem>
                  {buildPaginationPages(safePage, totalPages).map((p, i) =>
                    p === "ellipsis" ? (
                      <PaginationItem key={`e${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
                        <PaginationLink
                          isActive={safePage === p}
                          onClick={() => setCurrentPage(p)}
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    )
                  )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
          {checkedIds.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-[var(--muted)]/30">
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("automatizationSelectedCount", { selected: checkedIds.size, total: displayRuns.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1.5 px-2 cursor-pointer"
                  onClick={() => setShowOnlyChecked((v) => !v)}
                  title={showOnlyChecked ? "Show all" : "Show only selected"}
                >
                  <Focus className={cn("h-3.5 w-3.5", showOnlyChecked && "text-primary")} />
                  {showOnlyChecked && <span className="text-xs">{t("automatizationShowAll")}</span>}
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                  onClick={() => setDeleteDialogOpen(true)}
                  title={t("automatizationDeleteSelected")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {/* Detail pane */}
      {selectedRun && (
        <div className="border-t pt-4">
          {/* Progress for running/stopped runs */}
          {(selectedRun.status === "running" || selectedRun.status === "started" || isStoppedStatus(selectedRun.status)) &&
            selectedRun.total_combinations > 0 && (
            <div className="rounded-md border p-3 bg-muted/30 mb-4">
              <p className="text-sm text-muted-foreground">
                {t("automatizationProgress", {
                  completed: selectedRun.completed_combinations,
                  total: selectedRun.total_combinations,
                })}
              </p>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round((selectedRun.completed_combinations / selectedRun.total_combinations) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Resume button for stopped runs */}
          {isStoppedStatus(selectedRun.status) && (
            <div className="rounded-md border border-[var(--border)] p-4 flex items-center justify-between gap-4 mb-4">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{t("automatizationResumeButton")}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{t("automatizationResumeDescription")}</p>
              </div>
              <ButtonGroup className="shrink-0">
                <Button
                  size="sm"
                  className="cursor-pointer"
                  disabled={resumeMutation.isPending}
                  onClick={() => resumeMutation.mutate({ runId: selectedRun.id })}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {t("automatizationResumeButton")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      className="cursor-pointer px-1.5"
                      disabled={resumeMutation.isPending}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => resumeMutation.mutate({ runId: selectedRun.id })}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t("automatizationResumeSameWorker")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => resumeMutation.mutate({ runId: selectedRun.id, worker: "" })}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      {t("automatizationResumeAnyWorker")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            </div>
          )}

          <Tabs value={detailTab} onValueChange={setDetailTab}>
            <div className="relative w-full">
              <TabsList ref={detailTabsRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="details">{t("automatizationTabDetails")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="results">{t("automatizationTabResults")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="diagnostics">{t("automatizationTabDiagnostics")}</TabsTrigger>
              </TabsList>
              <div
                className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                style={{ left: detailIndicator.left, width: detailIndicator.width }}
              />
            </div>

            {/* ─ Details tab ─ */}
            <TabsContent value="details" className="space-y-4 mt-4">
              {/* ID */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">ID</label>
                <div className="flex items-center gap-2">
                  <Input value={selectedRun.id} readOnly className="h-8 text-xs font-mono bg-muted/30 max-w-sm" />
                  <AnimateIcon animateOnHover className="cursor-pointer">
                    <CopyIcon
                      size={14}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedRun.id)
                        toast.success(t("automatizationCopied"))
                      }}
                    />
                  </AnimateIcon>
                </div>
              </div>

              {/* Name */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">{t("automatizationDetailName")}</label>
                <span className="text-sm">{selectedRun.name}</span>
              </div>

              {/* Combinations */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">{t("automatizationDetailCombinations")}</label>
                <span className="text-sm tabular-nums">{selectedRun.completed_combinations} / {selectedRun.total_combinations}</span>
              </div>

              {/* Period */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">{t("automatizationDetailPeriod")}</label>
                <span className="text-sm tabular-nums">
                  {selectedRun.simulation_from && selectedRun.simulation_to
                    ? `${selectedRun.simulation_from} — ${selectedRun.simulation_to} (${Math.round(
                        (new Date(selectedRun.simulation_to).getTime() - new Date(selectedRun.simulation_from).getTime()) / 86400000
                      ) + 1} ${t("automatizationDetailDays")})`
                    : `${selectedRun.simulation_days} ${t("automatizationDetailDays")}`}
                </span>
              </div>

              {/* Date */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">{t("automatizationDetailDate")}</label>
                <span className="text-sm">{new Date(selectedRun.created_at).toLocaleString()}</span>
              </div>
            </TabsContent>

            {/* ─ Results tab ─ */}
            <TabsContent value="results" className="space-y-4 mt-4">
              {/* Best configuration summary */}
              {selectedRun.best_combination && (
                <div className="rounded-md border p-3 bg-muted/30">
                  <p className="text-sm font-medium">
                    {t("automatizationBestConfig")}:{" "}
                    <span className="text-foreground">
                      {describeCombination(selectedRun.best_combination, selectedRun)}
                    </span>
                  </p>
                  {selectedRun.best_score != null && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {t("automatizationProfitScore")}: {selectedRun.best_score.toFixed(2)}
                    </p>
                  )}
                </div>
              )}

              {/* Results table */}
              {sortedResults.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">{t("automatizationRank")}</TableHead>
                      <TableHead>{t("automatizationSettings")}</TableHead>
                      <TableHead className="text-right">{t("automatizationProfitScore")}</TableHead>
                      <TableHead className="text-right">{t("automatizationQuantity")}</TableHead>
                      <TableHead className="text-right">{t("automatizationSold")}</TableHead>
                      <TableHead className="text-right">{t("automatizationReturned")}</TableHead>
                      <TableHead className="text-right">{t("automatizationSoldOutPct")}</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedResults.map((result, idx) => {
                      const rank = idx + 1
                      const best = sortedResults[0]
                      const m = result.metrics
                      const bm = best.metrics
                      const dProfit = result.score != null && best.score != null ? result.score - best.score : null
                      const dQuantity = m?.d_total_delivered != null && bm?.d_total_delivered != null ? m.d_total_delivered - bm.d_total_delivered : null
                      const dSold = m?.d_total_sold != null && bm?.d_total_sold != null ? m.d_total_sold - bm.d_total_sold : null
                      const dReturned = m?.d_total_returned != null && bm?.d_total_returned != null ? m.d_total_returned - bm.d_total_returned : null
                      const dSoldOut = m?.sold_out_pct != null && bm?.sold_out_pct != null
                        ? m.sold_out_pct - bm.sold_out_pct
                        : null
                      const fmtDelta = (v: number, decimals = 0) => {
                        const s = decimals > 0
                          ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
                          : v.toLocaleString()
                        return v > 0 ? `+${s}` : s
                      }
                      const deltaClass = (v: number | null) =>
                        v != null && v < 0 ? "text-[10px] text-red-500" : "text-[10px] text-muted-foreground"
                      const failed = result.score == null
                      return (
                        <TableRow key={result.simulation_id ?? `combo-${idx}`} className="group">
                          <TableCell className="font-medium align-top">
                            {failed ? (
                              <Badge variant="destructive" className="text-xs">
                                {t("automatizationFailed")}
                              </Badge>
                            ) : rank === 1 ? (
                              <Badge variant="success" className="text-xs">
                                {t("automatizationBest")}
                              </Badge>
                            ) : rank}
                          </TableCell>
                          <TableCell className="text-xs align-top">
                            {describeCombination(result.combination, selectedRun)}
                            {failed && result.error && (
                              <div className="text-[10px] text-destructive mt-0.5">{result.error}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono align-top">
                            {result.score != null ? result.score.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "–"}
                            {rank > 1 && dProfit != null && (
                              <div className={deltaClass(dProfit)}>{fmtDelta(dProfit, 2)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono align-top">
                            {m?.d_total_delivered != null ? m.d_total_delivered.toLocaleString() : "–"}
                            {rank > 1 && dQuantity != null && (
                              <div className="text-[10px] text-muted-foreground">{fmtDelta(dQuantity)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono align-top">
                            {m?.d_total_sold != null ? m.d_total_sold.toLocaleString() : "–"}
                            {rank > 1 && dSold != null && (
                              <div className={deltaClass(dSold)}>{fmtDelta(dSold)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono align-top">
                            {m?.d_total_returned != null ? m.d_total_returned.toLocaleString() : "–"}
                            {rank > 1 && dReturned != null && (
                              <div className="text-[10px] text-muted-foreground">{fmtDelta(dReturned)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono align-top">
                            {m?.sold_out_pct != null
                              ? `${m.sold_out_pct.toFixed(1)}%`
                              : "\u2014"}
                            {rank > 1 && dSoldOut != null && (
                              <div className="text-[10px] text-muted-foreground">{fmtDelta(dSoldOut, 1)}%</div>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <Button
                              variant="outline"
                              size="sm"
                              className="cursor-pointer h-7 text-xs"
                              disabled={failed || applyMutation.isPending}
                              onClick={(e) => {
                                e.stopPropagation()
                                applyMutation.mutate({
                                  runId: selectedRun.id,
                                  data: comboToApplyRequest(result.combination),
                                })
                              }}
                            >
                              {t("automatizationApply")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}

              {/* Conclusion */}
              {sortedResults.length > 0 && selectedRun.best_combination && (
                <div className="rounded-md border p-3 bg-muted/20">
                  <h5 className="text-xs font-semibold text-muted-foreground mb-1">
                    {t("automatizationConclusion")}
                  </h5>
                  <p className="text-sm">
                    {generateConclusion(selectedRun, sortedResults)}
                  </p>
                </div>
              )}
            </TabsContent>

            {/* ─ Diagnostics tab ─ */}
            <TabsContent value="diagnostics" className="mt-4">
              {selectedRun.diagnostics ? (
                <DiagnosticsPanel diagnostics={selectedRun.diagnostics} t={t} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("automatizationNoDiagnostics")}</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) { setDeleteUnderstood(false); setDeleteConfirmInput("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("automatizationDeleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("automatizationDeleteConfirmDescription", { count: checkedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("automatizationDeleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">
                {t("automatizationDeleteConfirmLabel")}
              </label>
              <Input
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder="delete"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              className="cursor-pointer"
              onClick={() => { setDeleteDialogOpen(false); setDeleteUnderstood(false); setDeleteConfirmInput("") }}
            >
              {t("automatizationCancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="cursor-pointer"
              disabled={!deleteUnderstood || deleteConfirmInput.toLowerCase() !== "delete" || deleteMutation.isPending}
              onClick={handleDeleteSelected}
            >
              {t("automatizationDeleteSelected")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
