"use client"

// Trading → Strategies → Scalping → momentum / breakout scalping — kline-data analysis, no simulation.
import { useTradingScope } from "@/components/trading/scope-picker"
import { ScalpExplorer } from "@/components/trading/scalp-explorer"

export default function Page() {
  const { scope, picker } = useTradingScope()
  return (
    <div className="px-6 py-6 space-y-4">
      {picker}
      {scope ? (
        <ScalpExplorer scope={scope} strategy="momentum" />
      ) : (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Pick a coin, trading pair, timeframe and date range to analyse momentum / breakout scalping.
        </p>
      )}
    </div>
  )
}
