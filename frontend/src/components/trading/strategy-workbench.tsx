"use client"

// The shell every Trading → Strategies → New page runs inside.
//
// Four tabs, in the order you actually work through them:
//   Basics      — coin / trading pair / timeframe: what a strategy is PINNED to
//   Parameters  — date range + the strategy's signal knobs
//   Results     — full-range / first-half / second-half summary + charts
//   Analytics   — hour-of-day / weekday cuts of the same backtest
//
// The two buttons in the header turn whatever is on screen into a saved
// strategy. A STRATEGY is pinned to the Basics scope and can only ever trade
// that market; an ABSTRACT STRATEGY saves the parameters alone and is given a
// market when a paper run is started. Both land on Trading → Strategies → List.
//
// The explorer stays mounted across tab switches (it hides its inactive
// regions), so switching tabs never resets a knob or refires the backtest.

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Globe, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ViewSwitcher } from "@/components/ui/view-switcher"
import { CreateStrategyDialog } from "@/components/trading/strategies/create-strategy-dialog"
import { OptimizeTab } from "@/components/trading/optimize/optimize-tab"
import { strategyLabel } from "@/components/trading/strategy-meta"
import { useTradingScope, type TradingScopeOptions } from "@/components/trading/scope-picker"
import { paperTradeApi, strategyTemplatesApi, type StrategyTemplate, type SwingScope } from "@/lib/api"

export type WorkbenchTab = "basics" | "parameters" | "results" | "analytics" | "optimize"

const TAB_KEY = "crypt:strategyWorkbench:tab"

// Window used when a strategy has never traded — nothing to scope to.
const DEFAULT_DAYS = 21
const DAY_MS = 86_400_000

/** The backtest window for a strategy opened from its row: exactly the period it
 *  traded, else the last 21 days.
 *
 *  Deliberately NOT padded. A short span is fine here — the analysis pulls its
 *  ~300 trailing warmup bars from history BEFORE the start date (the kline query
 *  is bounded only at the top), so the picked range is the window that gets
 *  scored, not the window that has to hold the warmup. Padding it would quietly
 *  score trades the strategy never had the chance to take, which is the exact
 *  mismatch scoping to the traded period is meant to remove.
 */
export function analyticsRangeFor(
  range: { first_entry: string | null; last_exit: string | null } | undefined,
): { from: Date; to: Date } {
  const to = range?.last_exit ? new Date(range.last_exit) : new Date()
  const from = range?.first_entry
    ? new Date(range.first_entry)
    : new Date(to.getTime() - DEFAULT_DAYS * DAY_MS)
  return { from, to }
}

export function StrategyWorkbench(props: StrategyWorkbenchProps) {
  // useSearchParams (the ?load= handover) needs a Suspense boundary in the app
  // router; every analytics page renders this component directly.
  return (
    <Suspense fallback={null}>
      <Workbench {...props} />
    </Suspense>
  )
}

interface StrategyWorkbenchProps {
  // Strategy slug the created strategy is saved under (swings | range | …).
  strategy: string
  // Adds the Optimize tab. Only the streak explorer supports grid search so far;
  // the runner is streak-specific and would silently mis-score anything else.
  optimizable?: boolean
  scopeOptions?: TradingScopeOptions
  // Shown on Results/Analytics before a full scope has been picked.
  emptyHint: string
  // Render the explorer for this strategy. It must hide the regions that don't
  // belong to `tab` rather than unmounting them.
  children: (args: {
    scope: SwingScope
    tab: WorkbenchTab
    onParams: (params: Record<string, unknown>) => void
    loadParams: { token: string; params: Record<string, unknown> } | null
  }) => React.ReactNode
}

function Workbench({
  strategy,
  scopeOptions,
  emptyHint,
  optimizable = false,
  children,
}: {
  // Strategy slug the created strategy is saved under (swings | range | …).
  strategy: string
  optimizable?: boolean
  scopeOptions?: TradingScopeOptions
  // Shown on Results/Analytics before a full scope has been picked.
  emptyHint: string
  // Render the explorer for this strategy. It must hide the regions that don't
  // belong to `tab` rather than unmounting them.
  children: (args: {
    scope: SwingScope
    tab: WorkbenchTab
    onParams: (params: Record<string, unknown>) => void
    // A saved strategy's parameters to load onto the explorer, or null. The
    // token changes only when a NEW load is requested, so the explorer can
    // apply it exactly once and never fight the user's subsequent edits.
    loadParams: { token: string; params: Record<string, unknown> } | null
  }) => React.ReactNode
}) {
  const t = useTranslations("strategies")
  const router = useRouter()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<WorkbenchTab>("basics")
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as WorkbenchTab | null
      if (saved) setTab(saved)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab) } catch { /* ignore */ }
  }, [tab])

  const { scope, group, selectedCoin, applyScope, applyDateRange, basicsFields, dateField } = useTradingScope(scopeOptions)

  // ── "Open in Analytics": reopen a saved strategy on this page, pre-loaded ──
  // The strategy supplies the market (Basics) and the knobs (Parameters); the
  // date range is not stored on a strategy, so whatever the picker already has
  // stands. Abstract strategies carry no market — only their knobs load.
  const searchParams = useSearchParams()
  const loadId = searchParams.get("load")
  const { data: loaded } = useQuery({
    queryKey: ["strategyTemplates", "load", loadId],
    queryFn: () => strategyTemplatesApi.get(loadId!),
    enabled: !!loadId,
  })
  // Scope the backtest to when the strategy actually traded — the only window
  // where its backtest and its live record are comparable.
  const { data: tradedRange, isPending: rangePending } = useQuery({
    queryKey: ["tradeRange", loadId],
    queryFn: () => paperTradeApi.tradeRange(loadId!),
    enabled: !!loadId,
  })
  // Consume the request once: applying the scope re-renders, and without this
  // guard the strategy would keep stamping itself back over any edit made after.
  const loadedRef = useRef<string | null>(null)
  const [loadParams, setLoadParams] =
    useState<{ token: string; params: Record<string, unknown> } | null>(null)
  useEffect(() => {
    // Wait for the traded range too — applying the scope first and the dates a
    // beat later would fire a throwaway backtest on the wrong window.
    if (!loaded || rangePending || loadedRef.current === loaded.id) return
    loadedRef.current = loaded.id
    if (loaded.scope) applyScope(loaded.scope)
    const { from, to } = analyticsRangeFor(tradedRange)
    applyDateRange(from, to)
    setLoadParams({ token: loaded.id, params: loaded.params ?? {} })
    // Land on Parameters: the knobs are what was just restored, and Basics is
    // either already correct or (for an abstract strategy) deliberately empty.
    setTab("parameters")
    toast.success(t("loaded", { name: loaded.name }))
    // Drop ?load= so a refresh doesn't re-apply over later edits.
    router.replace(window.location.pathname)
  }, [loaded, rangePending, tradedRange, applyScope, applyDateRange, router, t])

  // The explorer's current knobs, republished on every change. Held in state (not
  // a ref) so the Create buttons enable as soon as the explorer has reported in.
  const [params, setParams] = useState<Record<string, unknown> | null>(null)

  // Which kind of strategy the open dialog will create; null = closed.
  const [creating, setCreating] = useState<"concrete" | "abstract" | null>(null)

  const createMutation = useMutation({
    // With a coin group selected, a concrete save stamps out one strategy per
    // member — same params, pair and timeframe, only the coin differs. An
    // abstract strategy has no coin to fan over, so a group is irrelevant to it.
    mutationFn: async (fields: { name: string; description: string; notes: string }) => {
      if (!params) throw new Error("no params")
      const base = {
        strategy,
        params,
        description: fields.description.trim() || null,
        notes: fields.notes.trim() || null,
      }
      if (creating === "abstract") {
        const tpl = await strategyTemplatesApi.create({
          ...base, name: fields.name.trim(), scope: null, is_abstract: true,
        })
        return { created: [tpl], group: null as string | null }
      }
      if (!scope) throw new Error("no scope")
      if (group && group.coins.length > 0) {
        const created: StrategyTemplate[] = []
        for (const m of group.coins) {
          created.push(await strategyTemplatesApi.create({
            ...base,
            name: `${fields.name.trim()} · ${m.symbol}`,
            scope: { coin_id: m.id, quote_asset: scope.quote_asset, interval: scope.interval },
            is_abstract: false,
          }))
        }
        return { created, group: group.name }
      }
      const tpl = await strategyTemplatesApi.create({
        ...base,
        name: fields.name.trim(),
        scope: { coin_id: scope.coin_id, quote_asset: scope.quote_asset, interval: scope.interval },
        is_abstract: false,
      })
      return { created: [tpl], group: null as string | null }
    },
    onSuccess: ({ created, group: groupName }) => {
      queryClient.invalidateQueries({ queryKey: ["strategyTemplates"] })
      setCreating(null)
      const first = created[0]
      toast.success(
        groupName
          ? t("createdGroup", { count: created.length, group: groupName })
          : t("created", { name: first.name }),
        {
          action: {
            label: t("createdOpen"),
            onClick: () => router.push(`/trading/strategies?selected=${first.id}`),
          },
        },
      )
    },
    onError: () => toast.error(t("createError")),
  })

  // Suggested strategy name: the strategy family plus the market it was tuned
  // on, which is what distinguishes one saved strategy from the next.
  const defaultName = useMemo(() => {
    const label = strategyLabel(strategy)
    if (creating === "abstract" || !scope) return label
    if (group) return `${label} · ${group.name}`
    return `${label} · ${selectedCoin?.symbol ?? ""} ${scope.interval}`.trim()
  }, [strategy, creating, scope, group, selectedCoin])

  const canCreateConcrete = !!scope && !!params
  const canCreateAbstract = !!params

  return (
    <div className="px-6 py-6 space-y-4">
      {/* Tabs + create actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ViewSwitcher
          options={[
            { id: "basics", label: t("tabBasics") },
            { id: "parameters", label: t("tabParameters") },
            { id: "results", label: t("tabResults") },
            { id: "analytics", label: t("tabAnalytics") },
            ...(optimizable ? [{ id: "optimize", label: t("tabOptimize") }] : []),
          ]}
          value={tab}
          onChange={(v) => setTab(v as WorkbenchTab)}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 cursor-pointer"
            disabled={!canCreateConcrete}
            title={canCreateConcrete ? t("createStrategyHint") : t("createNeedsScope")}
            onClick={() => setCreating("concrete")}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />{t("createStrategy")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 cursor-pointer"
            disabled={!canCreateAbstract}
            title={t("createAbstractHint")}
            onClick={() => setCreating("abstract")}
          >
            <Globe className="h-3.5 w-3.5 mr-1.5" />{t("createAbstract")}
          </Button>
        </div>
      </div>

      {/* ── Basics ── */}
      <div className={tab === "basics" ? undefined : "hidden"}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border p-4">
          {basicsFields}
        </div>
        <p className="mt-2 text-xs text-muted-foreground max-w-3xl">{t("basicsHint")}</p>
      </div>

      {/* ── Results: the date range leads this tab. It is not a property of the
             strategy — nothing on Basics or Parameters is saved from it — it
             just says which stretch of history the numbers below cover, so it
             belongs with those numbers rather than with the knobs. ── */}
      <div className={tab === "results" ? undefined : "hidden"}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border p-4">
          {dateField}
        </div>
      </div>

      {/* The explorer owns Parameters' knobs, Results and Analytics. It stays
          mounted on every tab (including Basics) so its state and its in-flight
          analysis survive tab switches. */}
      {scope ? (
        children({ scope, tab, onParams: setParams, loadParams })
      ) : (
        <p className={tab === "basics" ? "hidden" : "text-sm text-muted-foreground py-10 text-center"}>
          {emptyHint}
        </p>
      )}

      {optimizable && (
        <div className={tab === "optimize" ? undefined : "hidden"}>
          <OptimizeTab
            strategy={strategy}
            scope={scope}
            params={params}
            onImplement={(marketOverride, variationParams) => {
              applyScope(marketOverride)
              // Same one-shot channel "Open in Analytics" uses, so a variation
              // lands on the knobs exactly as a saved strategy would.
              setLoadParams({ token: `variation:${Date.now()}`, params: variationParams })
              setTab("parameters")
              toast.success(t("variationApplied"))
            }}
          />
        </div>
      )}

      <CreateStrategyDialog
        open={creating !== null}
        abstract={creating === "abstract"}
        defaultName={defaultName}
        groupCount={creating === "concrete" ? group?.coins.length ?? 0 : 0}
        scopeSummary={
          creating === "abstract" || !scope
            ? null
            : `${selectedCoin?.symbol ?? "—"}${scope.quote_asset} · ${scope.interval}`
        }
        saving={createMutation.isPending}
        onCancel={() => setCreating(null)}
        onSubmit={(fields) => createMutation.mutate(fields)}
      />
    </div>
  )
}
