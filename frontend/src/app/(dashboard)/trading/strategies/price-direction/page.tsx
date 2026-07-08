// Trading → Strategies → Price Direction — placeholder, not yet implemented.
export default function Page() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-2 px-6 text-center">
      <p className="text-lg font-semibold">Price Direction</p>
      <p className="text-sm text-muted-foreground max-w-md">Directional trading strategies built on model price forecasts — next-bar and horizon-N direction calls, thresholded by confidence. The Backtest tab on completed simulations covers this today; a dedicated explorer will live here.</p>
      <p className="text-xs text-muted-foreground/60 mt-2">Not built yet.</p>
    </div>
  )
}
