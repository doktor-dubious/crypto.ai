"use client"

// Trading → Strategies → New → Trend Swings: the swing/crest explorer.
// Pure kline analysis — pick a scope on Basics and explore; no simulation
// needed. A completed simulation can optionally be selected to power the
// model-confirmation entry filter, which is the one genuinely model-dependent
// feature and the reason this page adds a field to the shared scope picker.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { parseISO } from "date-fns"
import { Lock } from "lucide-react"
import { StrategyWorkbench } from "@/components/trading/strategy-workbench"
import { SwingsExplorer } from "@/components/trading/swings-explorer"
import { klineSimulationsApi } from "@/lib/api"

const SELECT_CLASS = "h-9 w-full px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"

export default function TrendSwingsPage() {
  const [confirmSimId, setConfirmSimId] = useState<string | null>(null)
  // The scope lives inside the workbench's picker; the confirmation list has to
  // be narrowed to it, so the explorer reports it back up here.
  const [scopeKey, setScopeKey] = useState<{ coin: string; quote: string; interval: string } | null>(null)

  const { data: simsResp } = useQuery({
    queryKey: ["klineSimulations", "swingConfirm"],
    queryFn: () => klineSimulationsApi.list({ limit: 500 }),
  })

  // Completed simulations matching the scope — candidates for the
  // model-confirmation filter (the one genuinely model-dependent feature).
  const confirmCandidates = useMemo(
    () => (simsResp?.items ?? []).filter((s) =>
      s.coin_id === scopeKey?.coin && s.quote_asset === scopeKey?.quote && s.interval === scopeKey?.interval
      && (s.status === "success" || s.status === "stopped"),
    ),
    [simsResp, scopeKey],
  )
  // Drop a selection that no longer matches the scope.
  useEffect(() => {
    if (confirmSimId && !confirmCandidates.some((s) => s.id === confirmSimId)) setConfirmSimId(null)
  }, [confirmSimId, confirmCandidates])
  const confirmSim = confirmCandidates.find((s) => s.id === confirmSimId) ?? null

  // Range-lock: model confirmation is only matched where the sim actually stored
  // a P(up) forecast — i.e. inside the sim's own date range. Outside it the
  // backend can't veto (no forecast → trade passes unconfirmed), so a wider
  // analysis window silently becomes a HYBRID backtest (part gated, part not)
  // reported as one number. Pin the range to the sim's coverage while one is
  // selected, and lock the calendar so it can't drift back out.
  const lockedRange = useMemo(
    () => (confirmSim
      ? {
          from: parseISO(confirmSim.start_date),
          to: parseISO(confirmSim.end_date),
          reason: "Locked to the confirmation simulation's coverage so every analysed bar is model-confirmed. Clear Model confirmation to change the range.",
        }
      : null),
    [confirmSim],
  )

  const extraField = (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-xs font-medium text-muted-foreground"
        title="Optional: a completed simulation of this exact scope whose stored P(up) forecasts power the model-confirmation entry filter. Selecting one locks the analysis range to the sim's coverage so the backtest stays fully gated."
      >
        Model confirmation
      </label>
      <select
        value={confirmSimId ?? ""}
        onChange={(e) => setConfirmSimId(e.target.value || null)}
        disabled={confirmCandidates.length === 0}
        className={SELECT_CLASS}
      >
        <option value="">{confirmCandidates.length === 0 ? "No matching sims" : "None"}</option>
        {confirmCandidates.map((s) => (
          <option key={s.id} value={s.id}>{s.name || `${s.models.join(",")} ${s.start_date}→${s.end_date}`}</option>
        ))}
      </select>
      {confirmSim && (
        <p className="flex items-start gap-1 text-[10px] text-muted-foreground leading-tight">
          <Lock className="h-2.5 w-2.5 mt-0.5 shrink-0" />
          <span>Date range locked to {confirmSim.start_date} → {confirmSim.end_date}; widening it would mix gated and ungated bars into one misleading number.</span>
        </p>
      )}
    </div>
  )

  return (
    <StrategyWorkbench
      strategy="swings"
      optimizable
      scopeOptions={{ storageKey: "crypt:trendSwingsScope", lockedRange, extraField }}
      emptyHint="Pick a coin, trading pair and timeframe on Basics, then a date range on Results, to explore swing signals — no simulation required."
    >
      {({ scope, tab, onParams, loadParams }) => (
        <>
          <ScopeReporter scope={scope} onChange={setScopeKey} />
          <SwingsExplorer
            scope={scope}
            confirmSimId={confirmSimId}
            confirmSimName={confirmSim?.name ?? null}
            activeTab={tab}
            onParams={onParams}
            loadParams={loadParams}
          />
        </>
      )}
    </StrategyWorkbench>
  )
}

// Reports the picked coin / pair / timeframe back up so the model-confirmation
// list can be narrowed to it. Renders nothing — it exists only because the scope
// is produced one level below where this page needs to read it.
function ScopeReporter({
  scope, onChange,
}: {
  scope: { coin_id: string; quote_asset: string; interval: string }
  onChange: (k: { coin: string; quote: string; interval: string }) => void
}) {
  const { coin_id, quote_asset, interval } = scope
  const set = useCallback(onChange, [onChange])
  useEffect(() => {
    set({ coin: coin_id, quote: quote_asset, interval })
  }, [set, coin_id, quote_asset, interval])
  return null
}
