"use client"

// Higher-timeframe trend gate — the control block shared by the scalp and
// swings explorers. An optional requirement that the bigger picture agrees
// before a trade fires: don't short an otherwise rising market, don't buy a
// falling one.
//
// The trend is read off the run's OWN timeframe over an equivalent span, not
// from joined higher-timeframe candles — the tooltip says so, because it is a
// real difference and pretending otherwise would misrepresent the signal.

import { type ReactNode } from "react"
import { Info } from "lucide-react"
import {
  Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"

const INTERVAL_UNIT_MIN: Record<string, number> = {
  m: 1, h: 60, d: 1440, w: 10080, M: 43200,
}

export function intervalMinutes(s: string): number {
  const m = /^(\d+)\s*([mhdwM])$/.exec((s ?? "").trim())
  return m ? parseInt(m[1], 10) * (INTERVAL_UNIT_MIN[m[2]] ?? 1) : 0
}

// Lookback length in higher-timeframe bars — must match _TREND_HTF_BARS in
// services/swing_analysis.py, which is what actually computes the trend.
const HTF_BARS = 16

export const HTF_TIMEFRAMES = ["30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w"] as const

export const HTF_GATE_MODES = [
  { value: "off", label: "Off" },
  { value: "align", label: "Align with trend" },
  { value: "flat", label: "Only when flat" },
  { value: "counter", label: "Counter-trend (control)" },
] as const

/** Base-timeframe bars in the trend lookback; 0 when tf isn't actually higher. */
export function htfLookbackBars(baseInterval: string, tf: string): number {
  const base = intervalMinutes(baseInterval)
  const htf = intervalMinutes(tf)
  if (!base || htf < base * 2) return 0
  return Math.floor((HTF_BARS * htf) / base)
}

/** The offered timeframes, limited to those meaningfully above the base one
 *  and not so far above that the warmup swallows the whole date range. */
export function htfOptions(baseInterval: string): string[] {
  return HTF_TIMEFRAMES.filter((tf) => {
    const bars = htfLookbackBars(baseInterval, tf)
    return bars > 0 && bars <= 4000
  })
}

function InfoIcon({ text }: { text: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <UITooltip>
        <TooltipTrigger asChild>
          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">{text}</TooltipContent>
      </UITooltip>
    </TooltipProvider>
  )
}

const TOOLTIP = (
  <span>
    Require the higher timeframe to agree before entering.{" "}
    <b>Align</b> trades only with the bigger trend (no shorts in a rising market,
    no longs in a falling one) — the natural pairing for breakout and
    cross strategies. <b>Only when flat</b> trades only while the higher
    timeframe is going nowhere, which is what fading the edges of a range
    actually wants; a strong trend is where edge-fading gets run over.{" "}
    <b>Counter-trend</b> is the null control: if it scores as well as Align,
    this gate is noise and should be left off.
    <br /><br />
    The trend is measured on <i>this</i> timeframe over a span of {HTF_BARS}{" "}
    higher-timeframe bars — not by reading actual higher-timeframe candles.
    The value is the move over that span divided by the move you would expect
    from noise alone, so the strength threshold means the same thing on every
    coin and at every timeframe. Entries are blocked until enough history has
    warmed up.
  </span>
)

export function HtfGateControl({
  baseInterval, gate, setGate, tf, setTf, level, setLevel,
}: {
  baseInterval: string
  gate: string
  setGate: (v: string) => void
  tf: string
  setTf: (v: string) => void
  level: number
  setLevel: (v: number) => void
}) {
  const options = htfOptions(baseInterval)
  const bars = htfLookbackBars(baseInterval, tf)
  // A saved template can carry a timeframe that isn't higher than the scope the
  // user has now picked (e.g. a 15m/4h template opened on a 1d scope). The gate
  // is inert in that case and the backend treats it as off — say so rather than
  // showing knobs that do nothing.
  const inert = gate !== "off" && bars === 0

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Higher timeframe</label>
        <InfoIcon text={TOOLTIP} />
      </div>
      <select
        value={gate}
        onChange={(e) => setGate(e.target.value)}
        className="w-full h-9 mt-1 px-3 border border-input rounded-md bg-background text-sm"
      >
        {HTF_GATE_MODES.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      <div className="mt-1 min-h-6">
        {gate !== "off" && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <select
              value={tf}
              onChange={(e) => setTf(e.target.value)}
              className="h-6 px-1 border border-input rounded bg-background text-[11px]"
            >
              {(options.includes(tf) ? options : [tf, ...options]).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <span>trend ≥</span>
            <Input
              type="number" min={0} max={3} step={0.1} value={level}
              onChange={(e) =>
                setLevel(Math.max(0, Math.min(3, Number(e.target.value) || 0)))
              }
              className="h-6 w-14 px-1.5 text-[11px]"
            />
            <span>σ</span>
          </div>
        )}
      </div>
      {inert && (
        <div className="text-[10px] text-amber-500 mt-0.5">
          {tf} isn&apos;t above this scope&apos;s {baseInterval} — gate inactive.
        </div>
      )}
      {gate !== "off" && !inert && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {bars} bar lookback · needs {bars + 200} bars of warmup
        </div>
      )}
    </div>
  )
}
