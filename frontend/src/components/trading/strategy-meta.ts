// Human-readable label + one-line description for each strategy slug stored on a
// template. Used by the Paper Trade page (table + detail pane).

export interface StrategyMeta {
  label: string
  description: string
  // The analysis workbench this strategy's parameters were tuned on. "Open in
  // Analytics" sends a saved strategy back to it, pre-loaded.
  analyticsPath: string
}

export const STRATEGY_META: Record<string, StrategyMeta> = {
  swings: {
    label: "Trend Swings",
    description: "Rides confirmed multi-bar swings off a volume/participation signal composite.",
    analyticsPath: "/trading/strategies/trend-swings/analytics",
  },
  range: {
    label: "Range Scalping",
    description: "Fades stretched moves back toward the range mean in calm regimes.",
    analyticsPath: "/trading/strategies/scalping/range/analytics",
  },
  momentum: {
    label: "Momentum Scalping",
    description: "Enters in the direction of short-term momentum bursts.",
    analyticsPath: "/trading/strategies/scalping/momentum/analytics",
  },
  indicator: {
    label: "Indicator Scalping",
    description: "Trades a classic indicator (EMA / RSI / …) crossover or threshold.",
    analyticsPath: "/trading/strategies/scalping/indicator/analytics",
  },
  streak: {
    label: "Streak Reversion",
    description: "Fades extended up/down streaks — mean reversion after N bars one way.",
    analyticsPath: "/trading/strategies/scalping/streak-reversion/analytics",
  },
  sweep: {
    label: "Liquidity Sweep",
    description: "Enters after a stop-run wick sweeps a level and reclaims it.",
    analyticsPath: "/trading/strategies/scalping/sweep/analytics",
  },
  takerflow: {
    label: "Taker Flow",
    description: "Follows aggressive taker buy/sell imbalance.",
    analyticsPath: "/trading/strategies/scalping/taker-flow/analytics",
  },
}

export function strategyLabel(slug: string): string {
  return STRATEGY_META[slug]?.label ?? slug
}

export function strategyDescription(slug: string): string {
  return STRATEGY_META[slug]?.description ?? ""
}

/** Where to reopen this strategy for analysis, pre-loaded with its own setup.
 *  Null for a slug with no workbench (nothing to open). */
export function strategyAnalyticsHref(slug: string, templateId: string): string | null {
  const path = STRATEGY_META[slug]?.analyticsPath
  return path ? `${path}?load=${encodeURIComponent(templateId)}` : null
}
