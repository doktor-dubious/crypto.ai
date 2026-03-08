"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { RotateCcw, Zap, Search, X, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useCustomer } from "@/components/providers/customer-provider"
import { predictionStrategiesApi, padsApi, predictionsApi } from "@/lib/api"
import {
  PredictionCalendar,
  type StrategyAssignment,
  type PadInfo,
  ASSIGNMENT_COLORS,
} from "@/components/predictions/prediction-calendar"
import { cn } from "@/lib/utils"

export default function NewPredictionPage() {
  const t = useTranslations("predictions.new")
  const router = useRouter()
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()

  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [assignments, setAssignments] = useState<StrategyAssignment[]>([])
  const [strategySearch, setStrategySearch] = useState("")

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const { data: strategies = [] } = useQuery({
    queryKey: ["prediction-strategies", activeCustomer?.id],
    queryFn: () => predictionStrategiesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
    // endpoint may not exist yet — silently return empty
    retry: false,
  })

  const { data: pads = [] } = useQuery({
    queryKey: ["pads", activeCustomer?.id],
    queryFn: () => padsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  // ─── Derived ───────────────────────────────────────────────────────────────

  const padInfos: PadInfo[] = useMemo(
    () =>
      pads.map((p) => ({
        id: p.id,
        name: p.name,
        dates: p.dates.map((d) => d.date),
      })),
    [pads]
  )

  const filteredStrategies = useMemo(() => {
    if (!strategySearch.trim()) return strategies
    const q = strategySearch.toLowerCase()
    return strategies.filter((s) => s.name.toLowerCase().includes(q))
  }, [strategies, strategySearch])

  // Color index assignment: each new strategy assignment gets the next color
  const nextColorIdx = assignments.length % ASSIGNMENT_COLORS.length

  // ─── Actions ───────────────────────────────────────────────────────────────

  function handleApplyStrategy(strategyId: string, strategyName: string) {
    if (selectedDates.size === 0) return
    const dates = [...selectedDates]
    setAssignments((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        dates,
        strategyId,
        strategyName,
        colorIdx: nextColorIdx,
      },
    ])
    setSelectedDates(new Set())
  }

  function handleRemoveAssignment(id: string) {
    setAssignments((prev) => prev.filter((a) => a.id !== id))
  }

  function handleClear() {
    setSelectedDates(new Set())
    setAssignments([])
  }

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!activeCustomer) throw new Error("No customer selected")
      for (const assignment of assignments) {
        const dates = [...assignment.dates].sort()
        await predictionsApi.createAsync({
          customer_id: activeCustomer.id,
          prediction_from: dates[0],
          prediction_to: dates[dates.length - 1],
          prediction_strategy_id: assignment.strategyId,
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      router.push("/")
    },
  })

  const canGenerate = assignments.length > 0 && !generateMutation.isPending

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full gap-0 -m-6 overflow-hidden">
      {/* ── Left: Calendar ── */}
      <div className="flex flex-col flex-1 min-w-0 border-r overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 bg-background">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {selectedDates.size > 0
                ? `${selectedDates.size} ${selectedDates.size === 1 ? t("assignedDates") : t("assignedDatesPlural")} selected`
                : "Click, shift-click, or drag to select dates"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleClear} className="h-7 text-xs gap-1.5">
              <RotateCcw className="h-3 w-3" />
              {t("clearButton")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={!canGenerate}
              className="h-7 text-xs gap-1.5"
            >
              <Zap className="h-3 w-3" />
              {generateMutation.isPending ? t("generating") : t("generateButton")}
            </Button>
          </div>
        </div>

        {/* Calendar */}
        <div className="flex-1 overflow-hidden">
          <PredictionCalendar
            pads={padInfos}
            assignments={assignments}
            selectedDates={selectedDates}
            onSelectedDatesChange={setSelectedDates}
          />
        </div>
      </div>

      {/* ── Right: Strategy panel ── */}
      <div className="w-72 shrink-0 flex flex-col overflow-hidden bg-background">
        {/* Strategy list */}
        <div className="flex flex-col overflow-hidden border-b flex-1">
          <div className="px-3 py-2.5 border-b shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("strategiesTitle")}
            </p>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t("strategiesSearch")}
                value={strategySearch}
                onChange={(e) => setStrategySearch(e.target.value)}
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredStrategies.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-muted-foreground">{t("noStrategies")}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">{t("noStrategiesHint")}</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredStrategies.map((strategy) => (
                  <div
                    key={strategy.id}
                    className="flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{strategy.name}</p>
                      {strategy.description && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {strategy.description}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={selectedDates.size > 0 ? "default" : "ghost"}
                      disabled={selectedDates.size === 0}
                      onClick={() => handleApplyStrategy(strategy.id, strategy.name)}
                      className="h-6 text-[10px] px-2 ml-2 shrink-0"
                    >
                      {t("applyButton")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Assignments */}
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: "40%" }}>
          <div className="px-3 py-2 border-b shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("assignmentsTitle")}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {assignments.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {t("noAssignments")}
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {assignments.map((a) => {
                  const color = ASSIGNMENT_COLORS[a.colorIdx % ASSIGNMENT_COLORS.length].bar
                  return (
                    <div key={a.id} className="flex items-center gap-2 px-3 py-2">
                      <div
                        className="h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{a.strategyName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {a.dates.length} {a.dates.length === 1 ? t("assignedDates") : t("assignedDatesPlural")}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveAssignment(a.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        aria-label={t("removeAssignment")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
