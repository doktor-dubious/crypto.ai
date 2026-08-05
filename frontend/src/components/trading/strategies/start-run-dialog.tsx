"use client"

// "Execute this strategy" — picks the target venue, names the run, sets its stake.
//
// Three targets, in ascending order of consequence: Paper Trade (simulated
// fills, no exchange), Binance Test Net (real order flow, fake money) and
// Binance Live (real orders, real money). The venue is frozen onto the run at
// start, so the engine keeps stepping it there for life. A venue with no
// credentials configured is offered as disabled rather than hidden — "you
// haven't set this up" and "this doesn't exist" are different answers.
//
// A concrete strategy already carries the market it is pinned to, so that part
// is read-only. An ABSTRACT strategy carries none, so coin / trading pair /
// timeframe are asked for here and frozen onto the run; the same strategy can
// therefore be run on several markets at once, each as its own named run.

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { AlertTriangle, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { CoinSelect } from "@/components/trading/coin-select"
import { cn } from "@/lib/utils"
import {
  coinsApi, coinGroupsApi, klinesApi, liveTradeApi,
  type CoinResponse, type StrategyTemplate, type StrategyTemplateScope,
} from "@/lib/api"

// Where a run executes. Ordered by consequence — the UI relies on this order.
export type RunTarget = "paper" | "testnet" | "live"

const SELECT_CLASS = "h-9 w-full px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"

const INTERVAL_UNIT_MIN: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080, M: 43200 }
function intervalMinutes(s: string): number {
  const m = /^(\d+)\s*([mhdwM])$/.exec(s.trim())
  return m ? parseInt(m[1], 10) * (INTERVAL_UNIT_MIN[m[2]] ?? 1) : Number.MAX_SAFE_INTEGER
}

/**
 * "Streak Reversion, Deep (2026.08.05 #2)" — the strategy's name, today's date,
 * and this run's ordinal among the runs of that strategy started today. `#1` is
 * the first of the day; a run started tomorrow restarts at `#1`.
 */
export function defaultRunName(strategyName: string, sameDayRuns: number): string {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join(".")
  return `${strategyName} (${stamp} #${sameDayRuns + 1})`
}

export function StartRunDialog({
  template,
  coinById,
  // Runs of this strategy already started today — decides the "#N" suffix.
  sameDayRuns,
  investment,
  onInvestmentChange,
  starting,
  onCancel,
  onStart,
}: {
  template: StrategyTemplate | null
  coinById: Map<string, CoinResponse>
  sameDayRuns: number
  investment: number
  onInvestmentChange: (v: number) => void
  starting: boolean
  onCancel: () => void
  onStart: (args: {
    name: string
    investment: number
    scope: StrategyTemplateScope | null
    target: RunTarget
  }) => void
}) {
  const t = useTranslations("strategies")
  const abstract = !!template?.is_abstract

  // Paper is the default: it is the step this pipeline says comes first, and
  // the only target that cannot cost anything.
  const [target, setTarget] = useState<RunTarget>("paper")
  const { data: venues } = useQuery({
    queryKey: ["liveVenues"],
    queryFn: () => liveTradeApi.venues(),
    staleTime: 5 * 60_000,
  })
  const venueReady = (v: RunTarget) =>
    v === "paper" ? true : v === "testnet" ? !!venues?.testnet : !!venues?.live

  const [name, setName] = useState("")
  const [coinId, setCoinId] = useState<string | null>(null)
  const [quoteAsset, setQuoteAsset] = useState<string | null>(null)
  const [interval, setInterval] = useState<string | null>(null)

  // Re-seed on every open: the suggested name depends on the strategy and on how
  // many runs it already has today, both of which move between opens.
  // Re-seed on every open. The target resets to Paper too: carrying "Binance
  // Live" over from a previous dialog is exactly the kind of stickiness that
  // spends money by accident.
  useEffect(() => {
    if (!template) return
    setName(defaultRunName(template.name, sameDayRuns))
    setTarget("paper")
    setCoinId(null)
    setQuoteAsset(null)
    setInterval(null)
  }, [template, sameDayRuns])

  // Market pickers, abstract strategies only.
  const { data: coins = [] } = useQuery({
    queryKey: ["coins"],
    queryFn: () => coinsApi.list({ limit: 1000 }),
    enabled: abstract,
  })
  const { data: groups = [] } = useQuery({
    queryKey: ["coin-groups"],
    queryFn: () => coinGroupsApi.list(),
    enabled: abstract,
  })
  const { data: favGroup } = useQuery({
    queryKey: ["coinGroups", "favorites"],
    queryFn: () => coinGroupsApi.favorites(),
    enabled: abstract,
  })
  const favoriteIds = useMemo(() => new Set(favGroup?.member_coin_ids ?? []), [favGroup])
  const { data: pairsResp } = useQuery({
    queryKey: ["simFormPairs", coinId],
    queryFn: () => klinesApi.getTradingPairs(coinId!),
    enabled: abstract && !!coinId,
  })
  const { data: tfResp } = useQuery({
    queryKey: ["simFormTfs", coinId, quoteAsset],
    queryFn: () => klinesApi.getTimeframes(coinId!, quoteAsset!),
    enabled: abstract && !!coinId && !!quoteAsset,
  })
  const timeframes = [...(tfResp?.timeframes ?? [])].sort((a, b) => intervalMinutes(a) - intervalMinutes(b))
  const selectedCoin = coins.find((c) => c.id === coinId)

  // The market this run will trade: picked here for an abstract strategy, or
  // inherited from a concrete one's pinned scope.
  const savedScope = template?.scope ?? null
  const savedSymbol = savedScope?.coin_id ? coinById.get(savedScope.coin_id)?.symbol ?? "—" : "—"
  const scopeReady = abstract ? !!(coinId && quoteAsset && interval) : !!savedScope?.coin_id

  const amountOk = Number.isFinite(investment) && investment > 0
  const canStart =
    !!template && !!name.trim() && amountOk && scopeReady && venueReady(target) && !starting

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4" />{t("startTitle")}
          </DialogTitle>
          <DialogDescription>
            {abstract ? t("startAbstractDescription") : t("startDescription", { name: template?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <Field label={t("startTarget")}>
            <div className="grid gap-1.5">
              {(["paper", "testnet", "live"] as RunTarget[]).map((v) => {
                const ready = venueReady(v)
                const active = target === v
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={!ready}
                    onClick={() => setTarget(v)}
                    title={ready ? undefined : t("startTargetNotConfigured")}
                    className={cn(
                      "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
                      ready ? "cursor-pointer" : "opacity-50 cursor-not-allowed",
                      active && v === "live"
                        ? "border-red-500/60 bg-red-500/5"
                        : active
                          ? "border-[var(--primary)] bg-[var(--accent)]/40"
                          : "hover:bg-[var(--muted)]/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2",
                        active
                          ? v === "live" ? "border-red-500 bg-red-500" : "border-[var(--primary)] bg-[var(--primary)]"
                          : "border-[var(--muted-foreground)]",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {t(`startTarget_${v}` as Parameters<typeof t>[0])}
                        {v === "live" && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                      </span>
                      <span className="block text-xs text-[var(--muted-foreground)]">
                        {ready
                          ? t(`startTargetHint_${v}` as Parameters<typeof t>[0])
                          : t("startTargetNotConfigured")}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={t("startRunName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>

          <Field label={t("startInvestment")}>
            <div className="relative">
              <Input
                type="number"
                min={1}
                step={1}
                value={Number.isFinite(investment) ? investment : ""}
                onChange={(e) => onInvestmentChange(e.target.valueAsNumber)}
                className="pr-14"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">USDT</span>
            </div>
          </Field>

          {abstract ? (
            <>
              <Field label={t("startCoin")}>
                <CoinSelect
                  coins={coins}
                  favoriteIds={favoriteIds}
                  value={coinId}
                  onChange={(id) => { setCoinId(id || null); setQuoteAsset(null); setInterval(null) }}
                  groups={groups}
                  selectedGroupId={null}
                  // One run trades one market — a group would have to fan out into
                  // several runs, which this dialog doesn't do.
                  onSelectGroup={() => {}}
                />
              </Field>
              <Field label={t("startPair")}>
                <select
                  value={quoteAsset ?? ""}
                  onChange={(e) => { setQuoteAsset(e.target.value || null); setInterval(null) }}
                  disabled={!coinId}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("selectPlaceholder")}</option>
                  {(pairsResp?.pairs ?? []).map((p) => (
                    <option key={p} value={p}>{`${selectedCoin?.symbol ?? ""}${p}`}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("startTimeframe")}>
                <select
                  value={interval ?? ""}
                  onChange={(e) => setInterval(e.target.value || null)}
                  disabled={!quoteAsset}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("selectPlaceholder")}</option>
                  {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <div className="rounded-md border px-3 py-2 text-xs space-y-1">
              <p className="text-[var(--muted-foreground)]">{t("startPinnedMarket")}</p>
              <p className="font-medium tabular-nums">
                {savedSymbol}{savedScope?.quote_asset ?? ""} · {savedScope?.interval ?? "—"}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={starting}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant={target === "live" ? "destructive" : "default"}
            disabled={!canStart}
            onClick={() => onStart({
              name,
              investment,
              scope: abstract ? { coin_id: coinId!, quote_asset: quoteAsset!, interval: interval! } : null,
              target,
            })}
          >
            {starting
              ? t("starting")
              : target === "live" ? t("startConfirmLive") : t("startConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[var(--muted-foreground)]">{label}</label>
      {children}
    </div>
  )
}
