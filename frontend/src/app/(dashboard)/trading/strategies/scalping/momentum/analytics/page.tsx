"use client"

// Trading → Strategies → New → Scalping → Momentum — kline-data analysis, no
// simulation. The workbench shell owns the four tabs and the Create Strategy
// buttons; the explorer renders the region belonging to the active tab.
import { StrategyWorkbench } from "@/components/trading/strategy-workbench"
import { ScalpExplorer } from "@/components/trading/scalp-explorer"

export default function Page() {
  return (
    <StrategyWorkbench
      strategy="momentum"
      optimizable
      emptyHint="Pick a coin, trading pair and timeframe on Basics, then a date range on Results, to analyse momentum / breakout scalping."
    >
      {({ scope, tab, onParams, loadParams }) => (
        <ScalpExplorer scope={scope} strategy="momentum" activeTab={tab} onParams={onParams} loadParams={loadParams} />
      )}
    </StrategyWorkbench>
  )
}
