"use client"

// Paper Trade page — the RUN MONITOR. Two views: Active (every running run,
// with P/L, uptime and stop) and Sweep (the rotating strategy×coin searches).
//
// It does not own the list of strategies: that lives on Trading → Strategies →
// List, which is also where a paper run is started. Clicking through from a card
// or a leaderboard row deep-links there with the right run pinned.

import { useMemo, useState, useEffect, type Dispatch, type SetStateAction } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { ViewSwitcher } from "@/components/ui/view-switcher"
import { strategyLabel } from "@/components/trading/strategy-meta"
import { ActiveStrategies, type GroupByMode } from "@/components/trading/paper/active-strategies"
import { SweepLeaderboard } from "@/components/trading/paper/sweep-leaderboard"
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

// A multi-select dropdown over one filter dimension. All options start checked;
// unchecking removes that key from the display. Shows a "checked/total" count.
function FilterDropdown({
  label, options, excluded, onToggle, onAll, allLabel, noneLabel,
}: {
  label: string
  options: { key: string; label: string }[]
  excluded: Set<string>
  onToggle: (key: string) => void
  onAll: (check: boolean) => void
  allLabel: string
  noneLabel: string
}) {
  const selected = options.filter((o) => !excluded.has(o.key)).length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 cursor-pointer" disabled={options.length === 0}>
          <span>{label}</span>
          <span className="text-[var(--muted-foreground)] tabular-nums">{selected}/{options.length}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1 text-xs">
          <button className="text-primary hover:underline cursor-pointer" onClick={() => onAll(true)}>{allLabel}</button>
          <button className="text-[var(--muted-foreground)] hover:underline cursor-pointer" onClick={() => onAll(false)}>{noneLabel}</button>
        </div>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.key}
            checked={!excluded.has(o.key)}
            onCheckedChange={() => onToggle(o.key)}
            onSelect={(e) => e.preventDefault()}
            className="cursor-pointer"
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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

  const coinById = useMemo(() => new Map(coins.map((c) => [c.id, c])), [coins])

  // Active-tab display filters — three multi-selects over the coin groups / coins
  // / strategies that currently have running trades. We persist the UNCHECKED
  // (excluded) keys, so options default to checked and new runs appear by default.
  const [exclGroups, setExclGroups] = useState<Set<string>>(() => new Set(loadJson<string[]>("exclGroups", [])))
  const [exclCoins, setExclCoins] = useState<Set<string>>(() => new Set(loadJson<string[]>("exclCoins", [])))
  const [exclStrategies, setExclStrategies] = useState<Set<string>>(() => new Set(loadJson<string[]>("exclStrategies", [])))
  useEffect(() => { saveJson("exclGroups", [...exclGroups]) }, [exclGroups])
  useEffect(() => { saveJson("exclCoins", [...exclCoins]) }, [exclCoins])
  useEffect(() => { saveJson("exclStrategies", [...exclStrategies]) }, [exclStrategies])

  // Coin → its group (first group by name; used by the coin-groups grouping and
  // the active-tab group filter so both agree on a coin's single group).
  const coinToGroup = useMemo(() => {
    const sorted = [...coinGroups].sort((a, b) => a.name.localeCompare(b.name))
    const m = new Map<string, { id: string; name: string }>()
    for (const g of sorted) for (const cid of g.member_coin_ids) if (!m.has(cid)) m.set(cid, { id: g.id, name: g.name })
    return m
  }, [coinGroups])
  const groupKeyOfRun = (r: PaperTradeRun) => (r.scope?.coin_id ? coinToGroup.get(r.scope.coin_id)?.id : undefined) ?? "ungrouped"

  // Filter options — only the coin groups / coins / strategies that currently
  // have running trades, sorted by label.
  const filterOptions = useMemo(() => {
    const groups = new Map<string, string>()
    const coinsM = new Map<string, string>()
    const strategies = new Map<string, string>()
    for (const r of activeRuns) {
      const gk = groupKeyOfRun(r)
      groups.set(gk, gk === "ungrouped" ? t("ungrouped") : coinToGroup.get(r.scope!.coin_id!)?.name ?? gk)
      const cid = r.scope?.coin_id ?? "none"
      coinsM.set(cid, (r.scope?.coin_id ? coinById.get(r.scope.coin_id)?.symbol : null) ?? "—")
      strategies.set(r.strategy, strategyLabel(r.strategy))
    }
    const toSorted = (m: Map<string, string>) =>
      [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label))
    return { groups: toSorted(groups), coins: toSorted(coinsM), strategies: toSorted(strategies) }
  }, [activeRuns, coinById, coinToGroup, t]) // eslint-disable-line react-hooks/exhaustive-deps

  // Runs left after the three exclusion filters — fed to the Active view.
  const visibleRuns = useMemo(
    () => activeRuns.filter((r) =>
      !exclGroups.has(groupKeyOfRun(r))
      && !exclCoins.has(r.scope?.coin_id ?? "none")
      && !exclStrategies.has(r.strategy),
    ),
    [activeRuns, coinToGroup, exclGroups, exclCoins, exclStrategies], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Toggle one key in an exclusion set; check/uncheck every option in a dimension.
  const toggleExcl = (setter: Dispatch<SetStateAction<Set<string>>>) => (key: string) =>
    setter((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const setAllExcl = (setter: Dispatch<SetStateAction<Set<string>>>, options: { key: string }[]) => (check: boolean) =>
    setter((prev) => { const n = new Set(prev); options.forEach((o) => (check ? n.delete(o.key) : n.add(o.key))); return n })

  // Top-level view: "active" | "sweep" — a segmented switcher (same control as
  // the configuration page's Gorm/Customer toggle).
  const [topTab, setTopTab] = useState<string>(() => {
    const saved = loadJson<string>("topTab", "active")
    // "strategies" was a third tab before that table moved to its own page.
    return saved === "sweep" ? "sweep" : "active"
  })
  useEffect(() => { saveJson("topTab", topTab) }, [topTab])

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

  // Open a run's strategy on the Strategies page, with that specific run pinned
  // in the detail pane's Trades tab — a sweep row stands for one template×coin
  // combination, so the pane must not land on whichever run has the most trades.
  function openStrategy(templateId: string, runId?: string) {
    router.push(`/trading/strategies?selected=${templateId}${runId ? `&run=${runId}` : ""}`)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <ViewSwitcher
            options={[
              { id: "active", label: t("tabActive") },
              { id: "sweep", label: t("tabSweep") },
            ]}
            value={topTab}
            onChange={setTopTab}
          />
          {topTab === "active" && (
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
          )}
        </div>

        {/* ── Active ── */}
        {topTab === "active" && (
          <div className="mt-6 space-y-2">
            {activeRuns.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">{t("filterBy")}</span>
                <FilterDropdown
                  label={t("groupByCoinGroups")} options={filterOptions.groups} excluded={exclGroups}
                  onToggle={toggleExcl(setExclGroups)} onAll={setAllExcl(setExclGroups, filterOptions.groups)}
                  allLabel={t("filterAll")} noneLabel={t("filterNone")}
                />
                <FilterDropdown
                  label={t("groupByCoins")} options={filterOptions.coins} excluded={exclCoins}
                  onToggle={toggleExcl(setExclCoins)} onAll={setAllExcl(setExclCoins, filterOptions.coins)}
                  allLabel={t("filterAll")} noneLabel={t("filterNone")}
                />
                <FilterDropdown
                  label={t("groupByStrategies")} options={filterOptions.strategies} excluded={exclStrategies}
                  onToggle={toggleExcl(setExclStrategies)} onAll={setAllExcl(setExclStrategies, filterOptions.strategies)}
                  allLabel={t("filterAll")} noneLabel={t("filterNone")}
                />
              </div>
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
              onOpenTemplate={(run) => openStrategy(run.template_id, run.id)}
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
        )}

        {/* ── Sweep ── */}
        {topTab === "sweep" && <SweepLeaderboard onOpenTemplate={openStrategy} />}
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
