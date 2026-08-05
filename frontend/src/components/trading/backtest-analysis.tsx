"use client"

// Analytics tab of the strategy workbench: when does this strategy actually
// work? Same cuts and same statistics as Paper Trade's Analyze tab — hour of
// day, 4-hour block, session, weekday, side, exit reason, each with its sample
// size and a Welch t against the rest — but over the trades the BACKTEST on the
// Results tab just produced, not over paper trades. That is the only source a
// strategy has before it has ever been run.
//
// The buckets ride along on the explorer's own analysis request (the explorer
// flips `buckets: true` once this tab has been opened), so there is no second
// backtest and the two tabs can never disagree about the same trades.

import { useTranslations } from "next-intl"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnalysisResults } from "@/components/trading/paper/analysis-tab"
import { cn } from "@/lib/utils"
import type { PaperTradeAnalysis } from "@/lib/api"

export function BacktestAnalysis({
  data,
  isFetching,
  isError,
  useLocal,
  onUseLocalChange,
  tzOffset,
  onRefresh,
}: {
  data: PaperTradeAnalysis | null | undefined
  isFetching: boolean
  isError: boolean
  useLocal: boolean
  onUseLocalChange: (v: boolean) => void
  tzOffset: number
  onRefresh: () => void
}) {
  const t = useTranslations("paperTrade")

  return (
    <div className="space-y-6 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          options={[
            { value: "utc", label: t("analyzeTzUtc") },
            { value: "local", label: t("analyzeTzLocal") },
          ]}
          value={useLocal ? "local" : "utc"}
          onChange={(v) => onUseLocalChange(v === "local")}
        />
        <Button
          variant="ghost" size="sm" className="cursor-pointer ml-auto"
          onClick={onRefresh} disabled={isFetching}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
          {t("analyzeRefresh")}
        </Button>
      </div>

      {isError ? (
        <p className="py-8 text-center text-sm text-red-500">{t("analyzeError")}</p>
      ) : !data ? (
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{t("analyzeRunning")}</p>
      ) : data.n_trades === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{t("analyzeNoTrades")}</p>
      ) : (
        <div className={cn(isFetching && "opacity-60 transition-opacity")}>
          <AnalysisResults data={data} useLocal={useLocal} tzOffset={tzOffset} isBacktest />
        </div>
      )}
    </div>
  )
}

// Same segmented control the paper Analyze tab uses for its scope/timezone
// switches (kept local rather than exported — it is three lines of markup).
function Toggle({
  options, value, onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 text-xs rounded-sm cursor-pointer transition-colors",
            value === o.value
              ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-medium"
              : "text-[var(--muted-foreground)] hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
