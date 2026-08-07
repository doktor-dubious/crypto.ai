// What varies, per strategy.
//
// Every scalp strategy shares the exit and gate machinery, but each has its own
// entry signal — so "threshold" means a different quantity with a different
// sensible ladder, and the signal knobs differ entirely. Keeping that in one
// table means adding a strategy is a data change, not a component change.
//
// Ladders are chosen to span the useful range at a resolution the backtest can
// actually distinguish, not to be exhaustive: every extra tick multiplies the
// grid, and neighbouring values often produce near-identical trades.

export interface SignalAxis {
  /** Key inside the explorer's `paramValues` blob. */
  key: string
  label: string
  hint?: string
  options: { value: number; label: string }[]
}

/** A one-of-many choice whose value is a STRING, not a number — the indicator
 *  kind, or a named swing-composite subset. */
export interface ChoiceAxis {
  key: string
  label: string
  hint?: string
  options: { value: string; label: string }[]
  /** Numeric knobs that only apply when this choice is picked. */
  params?: Record<string, SignalAxis>
}

export interface StrategyAxes {
  thresholdLabel: string
  thresholdHint: string
  thresholdOptions: { value: number; label: string }[]
  signal: SignalAxis[]
  /** Indicator kinds ("indicator") or composite subsets ("swings"). */
  choice?: ChoiceAxis
  /** Swings has no volatility-regime gate; its explorer offers none. */
  supportsVolGate?: boolean
  /** Swings fees default higher — its trades are longer and more often taker. */
  defaultFeeBps?: number
}

const num = (vs: number[], suffix = "") =>
  vs.map((v) => ({ value: v, label: `${v}${suffix}` }))

export const STRATEGY_AXES: Record<string, StrategyAxes> = {
  streak: {
    thresholdLabel: "Streak length",
    thresholdHint: "Consecutive same-direction closes before the run is faded. Reversal probability rises with length but entries get rarer.",
    thresholdOptions: num([2, 3, 4, 5, 6, 7, 8]),
    signal: [
      {
        key: "require_voldiv",
        label: "Volume divergence",
        hint: "Require the run to be advancing on falling volume — the conditioner that roughly doubled the fade edge in the research.",
        options: [{ value: 0, label: "Not required" }, { value: 1, label: "Required" }],
      },
      {
        key: "btc_filter",
        label: "BTC-beta filter",
        hint: "Judge a run by whether BTC explains it. Idiosyncratic runs reverted +1.96 bps against −0.22 for BTC-driven ones; the third option is the null control.",
        options: [
          { value: 0, label: "Off" },
          { value: 1, label: "Only idiosyncratic runs" },
          { value: 2, label: "Only BTC-driven runs (control)" },
        ],
      },
    ],
  },
  range: {
    thresholdLabel: "Edge depth (band units)",
    thresholdHint: "How far into the edge band price must push before the edge is faded. 1.0 = exactly at the band boundary; higher = closer to the absolute channel edge, so fewer but better-priced entries.",
    thresholdOptions: [
      { value: 0.5, label: "0.5" }, { value: 0.75, label: "0.75" },
      { value: 1, label: "1.0" }, { value: 1.25, label: "1.25" },
      { value: 1.5, label: "1.5" }, { value: 2, label: "2.0" },
    ],
    signal: [
      {
        key: "window",
        label: "Channel window (bars)",
        hint: "The channel is the highest high / lowest low of the previous N bars — the current bar cannot define its own support or resistance.",
        options: num([24, 48, 96, 144]),
      },
      {
        key: "band_pct",
        label: "Edge band (%)",
        hint: "The entry zone at each channel edge, as a percentage of channel height. 15% means trading only in the outer 15% slices.",
        options: num([10, 15, 20, 30], "%"),
      },
      {
        key: "max_width_pct",
        label: "Max channel width (%)",
        hint: "The regime gate, and the axis that decides whether this strategy works at all: only channels narrower than this count as ranges. A wide channel is a trend, and fading a trend's edge is how range scalpers die. Worth pairing with the Calm volatility regime.",
        options: num([1, 2, 3, 5], "%"),
      },
    ],
  },
  sweep: {
    thresholdLabel: "Sweep depth (ATR)",
    thresholdHint: "How far beyond the prior extreme the sweep must reach, in 14-bar ATRs, before the rejection is faded. 0 = any poke through the level counts; higher = only deep, violent stop-hunts.",
    thresholdOptions: num([0, 0.1, 0.25, 0.5, 1, 1.5]),
    signal: [
      {
        key: "window",
        label: "Extreme window (bars)",
        hint: "The swept level is the highest high / lowest low of the previous N bars. 12 matches the researched swing-sweep flag; longer windows mean more significant levels, swept less often.",
        options: num([6, 12, 24, 48, 96]),
      },
    ],
  },
  takerflow: {
    thresholdLabel: "Imbalance (σ)",
    thresholdHint: "Required z-score of the rolling taker-flow imbalance against its own trailing distribution. Higher = only the most lopsided aggressive-flow episodes trade.",
    thresholdOptions: num([0.5, 1, 1.5, 2, 2.5, 3]),
    signal: [
      {
        key: "window",
        label: "Flow window (bars)",
        hint: "Bars over which the taker-buy imbalance is averaged. Short reacts to single-bar bursts; long only to sustained campaigns.",
        options: num([4, 8, 12, 24, 48]),
      },
      {
        key: "fade",
        label: "Direction",
        hint: "Ride the flow (buy when aggressive buyers dominate) or fade it (sell into buyer dominance — exhaustion). The swing research saw taker tilt flip exactly at turns, which argues for fading on longer windows.",
        options: [{ value: 0, label: "With the flow" }, { value: 1, label: "Fade the flow" }],
      },
    ],
  },
  indicator: {
    thresholdLabel: "Trigger depth (σ)",
    thresholdHint: "How far beyond the textbook trigger level the signal must go. 0 = exactly at it (RSI 30/70, the 2σ band, VWAP itself); higher = deeper extremes only. EMA crosses are binary events, so any threshold ≤ 1 takes every cross.",
    thresholdOptions: num([0, 0.5, 1, 1.5, 2]),
    signal: [],
    choice: {
      key: "indicator",
      label: "Indicator",
      hint: "Each kind is paired only with the knobs it actually reads — sweeping an RSI period while the kind is EMA would just repeat the same backtest.",
      options: [
        { value: "ema", label: "EMA cross" },
        { value: "rsi", label: "RSI (30/70)" },
        { value: "bollinger", label: "Bollinger touch" },
        { value: "vwap", label: "VWAP deviation" },
      ],
      params: {
        ema: { key: "fast", label: "Fast EMA (bars)", options: num([5, 9, 12, 21]) },
        rsi: { key: "period", label: "RSI period (bars)", options: num([7, 14, 21, 28]) },
        bollinger: { key: "period", label: "Band period (bars)", options: num([10, 20, 50]) },
        vwap: { key: "vwap_window", label: "VWAP window (bars)", options: num([24, 48, 96, 200]) },
      },
    },
  },
  swings: {
    thresholdLabel: "Signal threshold (σ)",
    thresholdHint: "How many standard deviations the swing composite — the averaged z-scores of the reversal signals, plus bonuses for confirming flags — must reach before a trade fires. Higher = fewer, stronger setups.",
    thresholdOptions: num([0.5, 0.75, 1, 1.25, 1.5, 2]),
    signal: [],
    choice: {
      key: "subset",
      label: "Composite members",
      hint: "Which signals get a vote, and how loudly. The first three are fixed member lists: All = every member; Spikes = the climax read (participation and violence plus confirming flags); Direction = exhaustion (who is pushing, how stretched, how tired). The last two probe the members one at a time — cheap and readable, unlike searching all eleven weights at once (3^11 combos, 3.2× the cost each, and eleven continuous knobs fitted to one half of the data).",
      options: [
        { value: "all", label: "All signals" },
        { value: "spikes", label: "Spikes (climax)" },
        { value: "direction", label: "Direction (exhaustion)" },
        // 11 and 44 combos respectively: one member disabled, or one member's
        // weight moved to 0/50/200/300% (the 0% level IS a disable, so 11 of
        // the 44 coincide with leave-one-out and are deduplicated when both
        // modes are ticked). Counts are in the labels because these two
        // multiply the grid far more than the fixed subsets do — and they must
        // match the backend's _swing_variants, which is what actually expands.
        { value: "leave_one_out", label: "Leave one out (11)" },
        { value: "weight_oat", label: "Weight sweep, one at a time (44)" },
      ],
    },
    // The swings explorer has no volatility-regime control, and its fee default
    // is the spot-taker figure rather than the futures-maker one.
    supportsVolGate: false,
    defaultFeeBps: 8,
  },
  momentum: {
    thresholdLabel: "Volume spike (σ)",
    thresholdHint: "Volume z-score required on the breakout bar. Higher = only the most heavily-confirmed breakouts trade; 2σ matched the researched continuation effect.",
    // The explorer allows 0–5 in 0.25 steps; that resolution is far finer than
    // the backtest can distinguish, so the ladder steps where behaviour does.
    thresholdOptions: num([0, 0.5, 1, 1.5, 2, 2.5, 3, 4]),
    signal: [
      {
        key: "window",
        label: "Channel window (bars)",
        hint: "A breakout = the close exceeding the highest high (or lowest low) of the previous N bars. Longer windows mean rarer, more significant breaks.",
        options: num([12, 24, 48, 96, 144]),
      },
    ],
  },
}

/** Strategies the Optimize tab can search. */
export const OPTIMIZABLE = Object.keys(STRATEGY_AXES)

export function axesFor(strategy: string): StrategyAxes {
  return STRATEGY_AXES[strategy] ?? STRATEGY_AXES.streak
}
