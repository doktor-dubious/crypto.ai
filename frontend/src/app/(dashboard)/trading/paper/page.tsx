"use client"

// Paper Trade page — the RUN MONITOR. Two views: Active (every running run,
// with P/L, uptime and stop) and Sweep (the rotating strategy×coin searches).
//
// It does not own the list of strategies: that lives on Trading → Strategies →
// List, which is also where a paper run is started. Clicking through from a card
// or a leaderboard row deep-links there with the right run pinned.

import { useMemo, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { ViewSwitcher } from "@/components/ui/view-switcher"
import { ActiveStrategies, type GroupByMode } from "@/components/trading/paper/active-strategies"
import { RunFilterBar, useRunFilters } from "@/components/trading/run-filters"
import {
  paperTradeApi, coinsApi, coinGroupsApi, type PaperTradeRun,
} from "@/lib/api"

const STORAGE_PREFIX = "gorm:paperTrade:"

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value)) } catch { /* ignore */ }
}

export default function PaperTradePage() {
  const t = useTranslations("paperTrade")
  const queryClient = useQueryClient()
  const router = useRouter()

  // ── Data ──
  const { data: coins = [] } = useQuery({
    queryKey: ["coins"],
    queryFn: () => coinsApi.list({ limit: 1000 }),
  })
  const { data: activeRuns = [] } = useQuery({
    queryKey: ["paperRuns", "active"],
    queryFn: () => paperTradeApi.listRuns(true),
    refetchInterval: 5000,
  })
  const { data: coinGroups = [] } = useQuery({
    queryKey: ["coin-groups"],
    queryFn: () => coinGroupsApi.list(),
  })
  // Coins failing the tick guard (one tick > ~0.1% of price → paper P/L is
  // rounding noise). Changes on a ~daily timescale, so poll lazily.
  const { data: tickLimited } = useQuery({
    queryKey: ["paperTickLimited"],
    queryFn: paperTradeApi.tickLimited,
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  })
  const tickLimitedSet = useMemo(
    () => new Set((tickLimited?.coins ?? []).map((c) => c.id)),
    [tickLimited],
  )

  const coinById = useMemo(() => new Map(coins.map((c) => [c.id, c])), [coins])

  // Active-tab display filters — three multi-selects over the coin groups /
  // coins / strategies that currently have running trades, shared with the
  // live page (see components/trading/run-filters.tsx).
  const runFilters = useRunFilters({
    runs: activeRuns,
    coinGroups,
    coinById,
    storagePrefix: STORAGE_PREFIX,
    ungroupedLabel: t("ungrouped"),
  })
  // Hide runs on tick-limited coins — on by default: their P/L is not real.
  const [hideTickLimited, setHideTickLimited] = useState<boolean>(() => loadJson<boolean>("hideTickLimited", true))
  useEffect(() => { saveJson("hideTickLimited", hideTickLimited) }, [hideTickLimited])

  // The tick guard is its own filter with its own count: it hides runs whose
  // P/L is quantization noise, which must not blend into "hidden by filters".
  const visibleRuns = useMemo(
    () => (hideTickLimited
      ? runFilters.filtered.filter((r) => !tickLimitedSet.has(r.scope?.coin_id ?? ""))
      : runFilters.filtered),
    [runFilters.filtered, hideTickLimited, tickLimitedSet],
  )
  const tickHiddenCount = runFilters.filtered.length - visibleRuns.length

  // Active is the only view now — the Sweep tab is retired from this page (its
  // leaderboard component and API are left in place should it come back), so
  // there is nothing left to switch between.

  // Active-tab controls: "Active Up" promotes open/most-recently-traded to the
  // top; "Group by" collapses runs into aggregate cards. Both persist.
  const [activeUp, setActiveUp] = useState<boolean>(() => loadJson<boolean>("activeUp", false))
  useEffect(() => { saveJson("activeUp", activeUp) }, [activeUp])
  const [groupBy, setGroupBy] = useState<GroupByMode>(() => loadJson<GroupByMode>("groupBy", "none"))
  useEffect(() => { saveJson("groupBy", groupBy) }, [groupBy])
  // Confirm dialogs: one run, or every run in an aggregate card.
  const [stopRun, setStopRun] = useState<PaperTradeRun | null>(null)
  const [stopMany, setStopMany] = useState<{ runs: PaperTradeRun[]; label: string } | null>(null)

  // ── Mutations ──
  const stopMutation = useMutation({
    mutationFn: (runId: string) => paperTradeApi.stop(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paperRuns"] })
      toast.success(t("stopped"))
    },
    onError: () => toast.error(t("actionError")),
  })

  // Where a run's strategy lives on the Strategies page, with that specific run
  // pinned in the detail pane's Trades tab — a card stands for one template×coin
  // combination, so the pane must not land on whichever run has the most trades.
  // Returned as a URL rather than navigated to, so the card can render a real
  // link and be opened in a new tab.
  const strategyHref = (templateId: string, runId?: string) =>
    `/trading/strategies?selected=${templateId}${runId ? `&run=${runId}` : ""}`

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap ml-auto">
            <Button
              variant={activeUp ? "default" : "outline"}
              size="sm"
              className="h-8 cursor-pointer"
              onClick={() => setActiveUp((v) => !v)}
              title={t("activeUpTooltip")}
            >
              {t("activeUp")}
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted-foreground)] shrink-0">{t("groupBy")}</span>
              <ViewSwitcher
                options={[
                  { id: "none", label: t("groupByNone") },
                  { id: "groups", label: t("groupByCoinGroups") },
                  { id: "coins", label: t("groupByCoins") },
                  { id: "strategies", label: t("groupByStrategies") },
                ]}
                value={groupBy}
                onChange={(v) => setGroupBy(v as GroupByMode)}
              />
            </div>
          </div>
        </div>

        {/* ── Active ── */}
        <div className="mt-6 space-y-2">
            {activeRuns.length > 0 && (
              <RunFilterBar
                filters={runFilters}
                labels={{
                  hiddenByFilters: (n) => t("hiddenByFilters", { n }),
                  showAll: t("showAll"),
                  filterBy: t("filterBy"),
                  groups: t("groupByCoinGroups"),
                  coins: t("groupByCoins"),
                  strategies: t("groupByStrategies"),
                  all: t("filterAll"),
                  none: t("filterNone"),
                }}
              >
                <Button
                  variant={hideTickLimited ? "default" : "outline"}
                  size="sm"
                  className="h-8 cursor-pointer"
                  onClick={() => setHideTickLimited((v) => !v)}
                  title={t("hideTickLimitedTooltip", { pct: tickLimited?.tick_pct_limit ?? 0.1 })}
                >
                  {t("hideTickLimited")}
                  {hideTickLimited && tickHiddenCount > 0 && (
                    <span className="tabular-nums">({tickHiddenCount})</span>
                  )}
                </Button>
              </RunFilterBar>
            )}
            <div className="flex justify-end">
              <span className="text-xs text-[var(--muted-foreground)]">{t("pnlPending")}</span>
            </div>
            <ActiveStrategies
              runs={visibleRuns}
              coinById={coinById}
              coinGroups={coinGroups}
              groupBy={groupBy}
              activeUp={activeUp}
              onStopRun={(run) => setStopRun(run)}
              onStopMany={(runs, label) => setStopMany({ runs, label })}
              onGoLive={(run) => {
                // Hand this template to the live page, which reads the key on mount
                // and opens its start confirm (testnet).
                try { localStorage.setItem("gorm:liveTrade:pendingStart", run.template_id) } catch { /* ignore */ }
                router.push("/trading/live")
              }}
              href={(run) => strategyHref(run.template_id, run.id)}
              stopping={stopMutation.isPending}
              emptyLabel={activeRuns.length > 0 ? t("activeFilteredEmpty") : t("activeEmpty")}
              labels={{
                profitLoss: t("profitLoss"), thisRun: t("thisRun"), stop: t("stop"),
                trades: t("trades"), open: t("open"), uptime: t("uptime"),
                runsSuffix: t("runsSuffix"), mixed: t("mixed"), ungrouped: t("ungrouped"),
                goLive: t("goLive"),
              }}
            />
        </div>
      </div>

      {/* ── Stop one run ── */}
      <Dialog open={!!stopRun} onOpenChange={(o) => !o && setStopRun(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("stopConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("stopConfirmBody", { name: stopRun?.name ?? stopRun?.template_name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setStopRun(null)}>{t("cancel")}</Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { if (stopRun) stopMutation.mutate(stopRun.id); setStopRun(null) }}
            >
              {t("confirmStop")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Stop all runs in an aggregate card ── */}
      <Dialog open={!!stopMany} onOpenChange={(o) => !o && setStopMany(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("stopManyTitle")}</DialogTitle>
            <DialogDescription>{t("stopManyBody", { count: stopMany?.runs.length ?? 0, label: stopMany?.label ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setStopMany(null)}>{t("cancel")}</Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                stopMany?.runs.forEach((r) => stopMutation.mutate(r.id))
                setStopMany(null)
              }}
            >
              {t("confirmStopMany", { count: stopMany?.runs.length ?? 0 })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
