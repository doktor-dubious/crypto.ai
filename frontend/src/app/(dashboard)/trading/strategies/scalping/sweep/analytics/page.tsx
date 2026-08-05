"use client"

// Trading → Strategies → New → Scalping → Sweep — kline-data analysis, no
// simulation. The workbench shell owns the four tabs and the Create Strategy
// buttons; the explorer renders the region belonging to the active tab.
import { StrategyWorkbench } from "@/components/trading/strategy-workbench"
import { ScalpExplorer } from "@/components/trading/scalp-explorer"

export default function Page() {
  return (
    <StrategyWorkbench
      strategy="sweep"
      optimizable
      emptyHint="Pick a coin, trading pair and timeframe on Basics, then a date range on Results, to analyse failed-breakout (sweep) scalping."
    >
      {({ scope, tab, onParams, loadParams }) => (
        <ScalpExplorer scope={scope} strategy="sweep" activeTab={tab} onParams={onParams} loadParams={loadParams} />
      )}
    </StrategyWorkbench>
  )
}
