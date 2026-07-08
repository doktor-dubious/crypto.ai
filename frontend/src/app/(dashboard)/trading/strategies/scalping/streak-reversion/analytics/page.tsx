"use client"

// Trading → Strategies → Scalping → streak-reversion scalping — kline-data analysis, no simulation.
import { useTradingScope } from "@/components/trading/scope-picker"
import { ScalpExplorer } from "@/components/trading/scalp-explorer"

export default function Page() {
  const { scope, picker } = useTradingScope()
  return (
    <div className="px-6 py-6 space-y-4">
      {picker}
      {scope ? (
        <ScalpExplorer scope={scope} strategy="streak" />
      ) : (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Pick a coin, trading pair, timeframe and date range to analyse streak-reversion scalping.
        </p>
      )}
    </div>
  )
}
