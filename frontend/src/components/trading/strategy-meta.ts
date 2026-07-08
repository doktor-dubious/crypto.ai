// Human-readable label + one-line description for each strategy slug stored on a
// template. Used by the Paper Trade page (table + detail pane).

export interface StrategyMeta {
  label: string
  description: string
}

export const STRATEGY_META: Record<string, StrategyMeta> = {
  swings: {
    label: "Trend Swings",
    description: "Rides confirmed multi-bar swings off a volume/participation signal composite.",
  },
  range: {
    label: "Range Scalping",
    description: "Fades stretched moves back toward the range mean in calm regimes.",
  },
  momentum: {
    label: "Momentum Scalping",
    description: "Enters in the direction of short-term momentum bursts.",
  },
  indicator: {
    label: "Indicator Scalping",
    description: "Trades a classic indicator (EMA / RSI / …) crossover or threshold.",
  },
  streak: {
    label: "Streak Reversion",
    description: "Fades extended up/down streaks — mean reversion after N bars one way.",
  },
  sweep: {
    label: "Liquidity Sweep",
    description: "Enters after a stop-run wick sweeps a level and reclaims it.",
  },
  takerflow: {
    label: "Taker Flow",
    description: "Follows aggressive taker buy/sell imbalance.",
  },
}

export function strategyLabel(slug: string): string {
  return STRATEGY_META[slug]?.label ?? slug
}

export function strategyDescription(slug: string): string {
  return STRATEGY_META[slug]?.description ?? ""
}
