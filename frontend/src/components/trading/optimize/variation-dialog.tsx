"use client"

// What one variation actually was, and the button that adopts it.
//
// "Implement" writes the variation's market onto Basics and its knobs onto
// Parameters, then the explorer re-runs it — so the number you clicked is
// reproduced from scratch rather than trusted. That is deliberate: these rows
// are stored stats, and the only way to be sure they mean what they say is to
// recompute them.

import { useTranslations } from "next-intl"
import { Wand2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { axesFor } from "@/components/trading/optimize/strategy-axes"
import type { OptimizationResult } from "@/lib/api"

// Labels for the strategy knobs whose numeric value encodes a mode — showing a
// bare "1" would say nothing about what actually ran.
const VALUE_LABELS: Record<string, Record<string, string>> = {
  require_voldiv: { "0": "Not required", "1": "Required" },
  btc_filter: {
    "0": "Off", "1": "Only idiosyncratic runs", "2": "Only BTC-driven runs (control)",
  },
}

/** Swings records what is switched OFF and how the rest are weighted; the popup
 *  should say what voted, and how loudly where that isn't the default.
 *
 *  Phrased as the DIFFERENCE from all-signals-equal, because that is what the
 *  leave-one-out and weight sweeps produce: "without volume spike" reads as the
 *  variation it is, where "10 of 11: streak, range, …" makes the reader diff two
 *  lists by eye to find the one that changed. */
function describeSubset(
  disabled: string[] | undefined,
  weights: Record<string, number> | undefined,
): string {
  if (!disabled) return "—"
  const scaled = Object.entries(weights ?? {}).filter(([, v]) => Number(v) !== 100)
  const parts: string[] = []
  if (disabled.length === 0) parts.push("All signals")
  else if (disabled.length === 1) parts.push(`All but ${disabled[0]}`)
  else {
    const enabled = SWING_ALL.filter((k) => !disabled.includes(k))
    parts.push(`${enabled.length} of ${SWING_ALL.length}: ${enabled.join(", ")}`)
  }
  if (scaled.length) parts.push(scaled.map(([k, v]) => `${k} @ ${v}%`).join(", "))
  return parts.join(" · ")
}

const SWING_ALL = [
  "streak", "volume", "range", "trades", "avg_trade", "wick", "taker", "stretch",
  "sweep", "voldiv", "decel",
]

export function VariationDialog({
  result,
  varied,
  strategy,
  onClose,
  onImplement,
}: {
  result: OptimizationResult | null
  // Which strategy's knobs to name — each has its own signal parameters.
  strategy: string
  // Axis keys the grid actually searched. Everything else was held constant, so
  // highlighting it would suggest a choice that was never made.
  varied: Set<string>
  onClose: () => void
  onImplement: (
    scope: { coin_id: string; quote_asset: string; interval: string },
    params: Record<string, unknown>,
  ) => void
}) {
  const t = useTranslations("optimize")
  if (!result) return null
  const p = result.params as Record<string, any>
  const pv = (p.paramValues ?? {}) as Record<string, unknown>
  const axes = axesFor(strategy)

  // Every setting that shaped this run, with the SEARCHED ones marked. The
  // distinction is what makes the popup readable: a dozen rows all look equally
  // deliberate until you can see which two or three the grid actually moved.
  const rows: { key: string; label: string; value: string }[] = [
    { key: "coin", label: t("fCoin"), value: `${result.coin_symbol ?? result.coin_id}${result.quote_asset}` },
    { key: "interval", label: t("fTimeframe"), value: result.interval },
    { key: "threshold", label: axes.thresholdLabel, value: String(p.threshold) },
    { key: "holdBars", label: t("fHold"), value: `${p.holdBars} bars` },
    { key: "side", label: t("fSide"), value: String(p.side) },
    // Only this strategy's own signal knobs, named as the dialog names them.
    ...axes.signal.map((a) => ({
      key: a.key === "require_voldiv" ? "voldiv" : a.key === "btc_filter" ? "btc" : a.key,
      label: a.label,
      value: VALUE_LABELS[a.key]?.[String(pv[a.key] ?? 0)] ?? String(pv[a.key] ?? "—"),
    })),
    ...(axes.supportsVolGate === false ? [] : [{
      key: "volGate", label: t("fVolGate"),
      value: p.volGate === "off" ? "Off" : `${p.volGate} (${p.volLevel})`,
    }]),
    // The string-valued axis, where the strategy has one.
    ...(axes.choice
      ? [{
          key: axes.choice.key,
          label: axes.choice.label,
          value: axes.choice.key === "indicator"
            ? String(p.indicator ?? "—")
            : describeSubset(
                p.disabledSignals as string[] | undefined,
                p.weightPct as Record<string, number> | undefined,
              ),
        }]
      : []),
    { key: "htfGate", label: t("fHtf"), value: p.htfGate === "off" ? "Off" : `${p.htfGate} ${p.htfTf} (${p.htfLevel}σ)` },
    { key: "sl", label: t("fStop"), value: p.slMode === "none" ? "None" : `${p.slMode} (${p.slValue})` },
    { key: "tp", label: t("fTarget"), value: p.tpMode === "none" ? "None" : `${p.tpMode}${p.tpMode === "pct" ? ` (${p.tpValue}%)` : ""}` },
    // Fees are never searched — they are a property of the venue, not the strategy.
    { key: "fees", label: t("fFees"), value: `${p.feeBps} bps` },
  ]
  const nVaried = rows.filter((r) => varied.has(r.key)).length

  const stat = (label: string, t_: number, bps: number, n: number) => {
    // Sharpe = t / sqrt(n): the same information with the sample size taken back
    // out, so segments with very different trade counts stay comparable.
    const sharpe = n > 0 && Number.isFinite(t_) ? t_ / Math.sqrt(n) : null
    return (
      <div className="rounded-md border p-3 space-y-1">
        <p className="text-xs font-medium text-[var(--muted-foreground)]">{label}</p>
        <p className="flex items-baseline gap-2">
          <span className={cn("text-lg font-semibold font-mono", bps >= 0 ? "text-green-500" : "text-red-400")}>
            {bps >= 0 ? "+" : ""}{bps.toFixed(1)} bps
          </span>
          <span className={cn("text-xs font-mono", t_ >= 3 ? "text-green-500" : t_ >= 2 ? "text-amber-400" : t_ <= -2 ? "text-red-400" : "text-muted-foreground")}>
            t={t_.toFixed(2)}
          </span>
        </p>
        <p className="text-xs text-[var(--muted-foreground)] tabular-nums">
          {n.toLocaleString("en-US")} {t("trades")}
          {sharpe != null && <> · {t("sharpeShort")} {sharpe.toFixed(3)}</>}
        </p>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("variationTitle")}
            {result.is_baseline && <Badge variant="outline" className="text-[10px] font-normal">{t("baseline")}</Badge>}
            {!result.qualified && (
              <Badge variant="outline" className="text-[10px] font-normal border-amber-500/40 text-amber-600 dark:text-amber-400">
                {t("underpopulated")}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{t("variationDescription")}</DialogDescription>
        </DialogHeader>

        {/* Train and validation side by side — the comparison IS the result. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {stat(t("segTrain"), result.train_edge_t, result.train_avg_net_bps, result.train_n_trades)}
          {stat(t("segVal"), result.val_edge_t, result.val_avg_net_bps, result.val_n_trades)}
          {stat(t("segFull"), result.edge_t, result.avg_net_bps, result.n_trades)}
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          {result.val_edge_t < result.train_edge_t / 2
            ? t("variationDegrades")
            : t("variationHolds")}
        </p>

        {/* Shape, over the full range. t and Sharpe above say nothing about it,
            and for a mean-reversion strategy that is the gap that bites. */}
        {result.skew != null && (
          <div className="rounded-md border px-3 py-2 space-y-1">
            <div className="flex items-center gap-4 flex-wrap text-xs tabular-nums">
              <span>
                <span className="text-[var(--muted-foreground)]">{t("fSkew")} </span>
                <span className={cn(
                  "font-mono",
                  result.skew <= -1 ? "text-amber-500" : result.skew >= 1 ? "text-sky-500" : "",
                )}>
                  {result.skew > 0 ? "+" : ""}{result.skew.toFixed(2)}
                </span>
              </span>
              {result.max_drawdown_pct != null && (
                <span>
                  <span className="text-[var(--muted-foreground)]">{t("fMaxDD")} </span>
                  <span className="font-mono">{result.max_drawdown_pct.toFixed(1)}%</span>
                </span>
              )}
              {result.worst_trade_bps != null && (
                <span>
                  <span className="text-[var(--muted-foreground)]">{t("fWorstTrade")} </span>
                  <span className="font-mono text-red-500">{result.worst_trade_bps.toFixed(0)} bps</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {result.skew <= -1 ? t("skewNegative") : result.skew >= 1 ? t("skewPositive") : t("skewNeutral")}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-medium">{t("settings")}</p>
          {nVaried > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
              <span className="h-2.5 w-2.5 rounded-sm bg-sky-500/20 border border-sky-500/40" />
              {t("variedLegend", { n: nVaried })}
            </p>
          )}
        </div>
        <div className="rounded-md border divide-y">
          {rows.map((r) => {
            const isVaried = varied.has(r.key)
            return (
              <div
                key={r.key}
                className={cn(
                  "flex items-center justify-between gap-4 px-3 py-1.5",
                  isVaried && "bg-sky-500/10",
                )}
              >
                <span className={cn(
                  "text-xs font-medium",
                  isVaried ? "text-sky-600 dark:text-sky-400" : "text-[var(--muted-foreground)]",
                )}>
                  {r.label}
                </span>
                <span className={cn("text-sm text-right", isVaried && "font-medium")}>{r.value}</span>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>{t("close")}</Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => onImplement(
              { coin_id: result.coin_id, quote_asset: result.quote_asset, interval: result.interval },
              result.params,
            )}
          >
            <Wand2 className="h-3.5 w-3.5" />{t("implement")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
