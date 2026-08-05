"use client"

// Building a grid search. Every group defaults to whatever the strategy page is
// currently set to, so an untouched dialog runs exactly one combo — the
// strategy as it stands — and each box you tick multiplies from there.
//
// The counter is not decoration. The full cartesian of these axes is ~3.8
// MILLION combos per coin × timeframe, so the count and the projected runtime
// come from the server (the same arithmetic the runner uses) and gate the submit
// button behind a warning and then a hard confirmation.

import { useEffect, useMemo, useState } from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { AlertTriangle, Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { CoinSelect } from "@/components/trading/coin-select"
import { axesFor } from "@/components/trading/optimize/strategy-axes"
import {
  coinsApi, coinGroupsApi, strategyOptimizationsApi,
  type StrategyOptimization, type SwingScope,
} from "@/lib/api"

// Above this many combos the user is warned; above the second they must confirm
// a second time. Both are about attention, not capacity — the projected RUNTIME
// beside them is the number that actually matters.
const WARN_AT = 100
const DANGER_AT = 250

const INTERVALS = ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as const
const SIDES = ["long", "short", "both"] as const
const VOL_GATES = ["off", "calm", "expanding"] as const
const HTF_GATES = ["off", "align", "flat", "counter"] as const
const HOLDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

// ATR ladders lead because they self-scale across coins; the percentage ladders
// are sized for scalping, where a 5% stop on a 6-bar hold is just "no stop".
const SL_MODES = ["none", "pct", "atr", "structure", "trail_atr"] as const
const TP_MODES = ["none", "pct", "resistance", "mean", "reversal"] as const
const PCT_LADDER = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const
const ATR_LADDER = [1, 1.5, 2, 2.5, 3] as const

// The date range an optimization was last RUN with, per strategy. Everything
// else in this dialog is seeded from the page, which is right — those are the
// strategy's own settings. The range isn't: it says which slice of history you
// are searching, and that intent survives from one search to the next, whereas
// the page's range follows whatever you were last backtesting.
const RANGE_KEY = "crypt:optimize:lastRange"

function loadRange(strategy: string): { from: string; to: string } | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(`${RANGE_KEY}:${strategy}`)
    if (!raw) return null
    const v = JSON.parse(raw) as { from?: string; to?: string }
    return v.from && v.to ? { from: v.from, to: v.to } : null
  } catch { return null }
}
function saveRange(strategy: string, from: string, to: string) {
  if (typeof window === "undefined" || !from || !to) return
  try { localStorage.setItem(`${RANGE_KEY}:${strategy}`, JSON.stringify({ from, to })) } catch { /* ignore */ }
}

function toggle<T>(set: T[], v: T): T[] {
  return set.includes(v) ? set.filter((x) => x !== v) : [...set, v]
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-semibold">{title}</p>
        {hint && <p className="text-[10px] text-[var(--muted-foreground)]">{hint}</p>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">{children}</div>
    </div>
  )
}

function Tick({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span className="text-xs">{label}</span>
    </label>
  )
}

/** A one-of-many choice. Every other group in this dialog is multi-select, so the
 *  control has to look different or the coin modes read as combinable — you
 *  cannot search "a single coin AND all coins". Native inputs sharing a `name`
 *  give the group real radio semantics: arrow-key navigation and one-at-a-time
 *  selection, without hand-rolling either. Sized to match the Checkbox beside it. */
function Radio({
  name, checked, onChange, label,
}: { name: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className={cn(
          "size-4 shrink-0 cursor-pointer accent-[var(--primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      />
      <span className="text-xs">{label}</span>
    </label>
  )
}

export function CreateOptimizationDialog({
  open, strategy, scope, params, onClose, onCreated,
}: {
  open: boolean
  strategy: string
  scope: SwingScope | null
  params: Record<string, unknown> | null
  onClose: () => void
  onCreated: (o: StrategyOptimization) => void
}) {
  const t = useTranslations("optimize")
  const p = (params ?? {}) as Record<string, any>
  const pv = (p.paramValues ?? {}) as Record<string, any>

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [notes, setNotes] = useState("")

  const [coinMode, setCoinMode] = useState<"single" | "group" | "random" | "all">("single")
  const [coinId, setCoinId] = useState<string | null>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [coinCount, setCoinCount] = useState(10)

  const [intervals, setIntervals] = useState<string[]>([])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

  const axes = axesFor(strategy)
  const [thresholds, setThresholds] = useState<number[]>([])
  // { paramValues key -> ticked values }, whatever this strategy's knobs are.
  const [signalAxes, setSignalAxes] = useState<Record<string, number[]>>({})
  // The string-valued axis some strategies have: indicator kinds, or named
  // swing-composite subsets. Plus, for indicator, each kind's own knobs.
  const [choices, setChoices] = useState<string[]>([])
  const [choiceParams, setChoiceParams] = useState<Record<string, number[]>>({})
  const [holds, setHolds] = useState<number[]>([])
  const [sides, setSides] = useState<string[]>([])
  const [volGate, setVolGate] = useState<string[]>([])
  const [htfGate, setHtfGate] = useState<string[]>([])
  const [slModes, setSlModes] = useState<string[]>([])
  const [slPct, setSlPct] = useState<number[]>([])
  const [slAtr, setSlAtr] = useState<number[]>([])
  const [slTrail, setSlTrail] = useState<number[]>([])
  const [tpModes, setTpModes] = useState<string[]>([])
  const [tpPct, setTpPct] = useState<number[]>([])
  const [maxCombos, setMaxCombos] = useState(500)
  const [confirmed, setConfirmed] = useState(false)

  const { data: coins = [] } = useQuery({ queryKey: ["coins"], queryFn: () => coinsApi.list({ limit: 1000 }), enabled: open })
  const { data: groups = [] } = useQuery({ queryKey: ["coin-groups"], queryFn: () => coinGroupsApi.list(), enabled: open })
  const { data: favGroup } = useQuery({ queryKey: ["coinGroups", "favorites"], queryFn: () => coinGroupsApi.favorites(), enabled: open })
  const favoriteIds = useMemo(() => new Set(favGroup?.member_coin_ids ?? []), [favGroup])

  // Seed everything from the page's current setup: an untouched dialog is one
  // combo — the strategy as it stands — not an empty grid.
  useEffect(() => {
    if (!open || !scope) return
    setName(t("defaultName", { date: new Date().toISOString().slice(0, 10) }))
    setDescription(""); setNotes(""); setConfirmed(false)
    setCoinMode("single"); setCoinId(scope.coin_id); setGroupId(null); setCoinCount(10)
    setIntervals([scope.interval])
    // Reuse the range the last search actually ran with; fall back to whatever
    // the page is currently backtesting the first time round.
    const remembered = loadRange(strategy)
    setStartDate(remembered?.from ?? scope.start_date)
    setEndDate(remembered?.to ?? scope.end_date)
    setThresholds([Number(p.threshold ?? axes.thresholdOptions[0].value)])
    setHolds([Number(p.holdBars ?? 6)])
    setSides([String(p.side ?? "both")])
    // Seed each signal knob from the page, falling back to the strategy's own
    // default when the explorer hasn't set it.
    setSignalAxes(Object.fromEntries(
      axes.signal.map((a) => [a.key, [Number(pv[a.key] ?? a.options[0].value)]]),
    ))
    if (axes.choice) {
      const current = axes.choice.key === "indicator" ? String(p.indicator ?? "ema") : "all"
      const seeded = axes.choice.options.some((o) => o.value === current)
        ? current : axes.choice.options[0].value
      setChoices([seeded])
      setChoiceParams(Object.fromEntries(
        Object.entries(axes.choice.params ?? {}).map(([kind, ax]) => [
          kind, [Number(pv[ax.key] ?? ax.options[0].value)],
        ]),
      ))
    } else {
      setChoices([]); setChoiceParams({})
    }
    setVolGate([String(p.volGate ?? "off")])
    setHtfGate([String(p.htfGate ?? "off")])
    setSlModes([String(p.slMode ?? "none")])
    setTpModes([String(p.tpMode ?? "none")])
    setSlPct([]); setSlAtr([]); setSlTrail([]); setTpPct([])
    setMaxCombos(500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, strategy, scope?.coin_id, scope?.interval])

  const body = useMemo(() => ({
    name: name.trim() || "Optimization",
    description: description.trim() || null,
    notes: notes.trim() || null,
    strategy,
    coins: {
      mode: coinMode,
      coin_id: coinId,
      group_id: groupId,
      count: coinCount,
      quote_asset: scope?.quote_asset ?? "USDT",
    },
    intervals,
    start_date: startDate,
    end_date: endDate,
    threshold: thresholds,
    holdBars: holds,
    sides,
    // Streak's two knobs keep their original spec fields so the optimizations
    // already recorded still expand identically; everything else travels in the
    // generic map.
    voldiv: signalAxes.require_voldiv ?? [0],
    btcFilter: signalAxes.btc_filter ?? [0],
    paramAxes: Object.fromEntries(
      Object.entries(signalAxes).filter(([k]) => k !== "require_voldiv" && k !== "btc_filter"),
    ),
    ...(axes.choice?.key === "indicator"
      ? {
          indicators: choices,
          indicatorValues: Object.fromEntries(
            choices.map((kind) => {
              const ax = axes.choice!.params?.[kind]
              return [kind, ax ? { [ax.key]: choiceParams[kind] ?? [] } : {}]
            }),
          ),
        }
      : {}),
    ...(axes.choice?.key === "subset" ? { signalSubsets: choices } : {}),
    // Swings has no volatility-regime gate; sending one would be inventing a
    // control its explorer doesn't have.
    volGate: axes.supportsVolGate === false ? ["off"] : volGate,
    htfGate,
    slModes,
    slValues: { pct: slPct, atr: slAtr, trail_atr: slTrail },
    tpModes,
    tpValues: { pct: tpPct },
    // Fees and gate LEVELS ride along unchanged: fees are a venue property, and
    // sweeping the levels would multiply the grid without saying much.
    fixed: {
      feeBps: p.feeBps ?? axes.defaultFeeBps ?? 4, volLevel: p.volLevel ?? 1,
      htfTf: p.htfTf ?? "4h", htfLevel: p.htfLevel ?? 0.5,
      slValue: p.slValue ?? 2, tpValue: p.tpValue ?? 3,
    },
    baseline: scope ? { coin_id: scope.coin_id, quote_asset: scope.quote_asset, interval: scope.interval } : undefined,
    baseline_params: params ?? undefined,
    max_combos: maxCombos,
  }), [name, description, notes, strategy, coinMode, coinId, groupId, coinCount, scope, intervals,
       startDate, endDate, thresholds, holds, sides, signalAxes, choices, choiceParams, axes,
       volGate, htfGate, slModes, slPct, slAtr, slTrail, tpModes, tpPct, p, params, maxCombos])

  const ready = !!scope && intervals.length > 0 && !!startDate && !!endDate
    && (coinMode !== "single" || !!coinId) && (coinMode !== "group" || !!groupId)

  // The count comes from the server so the dialog and the runner can't disagree.
  const { data: est, isFetching: estimating } = useQuery({
    queryKey: ["optimizationEstimate", JSON.stringify(body)],
    queryFn: () => strategyOptimizationsApi.estimate(body),
    enabled: open && ready,
    staleTime: 30_000,
  })

  const createMutation = useMutation({
    mutationFn: () => strategyOptimizationsApi.create(body),
    onSuccess: (o) => {
      // Remembered on RUN, not on edit: a range you abandoned mid-form was never
      // a decision, and restoring it next time would be putting words in your mouth.
      saveRange(strategy, startDate, endDate)
      toast.success(t("created", { name: o.name }))
      onCreated(o)
    },
    onError: (e: Error) => toast.error(e.message || t("createError")),
  })

  const n = est?.n_to_run ?? 0
  const danger = n > DANGER_AT
  const warn = n > WARN_AT && !danger
  const needsConfirm = warn || danger
  const canSubmit = ready && n > 0 && (!needsConfirm || confirmed) && !createMutation.isPending

  const mins = est ? Math.round(est.est_seconds / 60) : 0
  const runtime = est
    ? est.est_seconds < 90 ? t("estSeconds", { s: est.est_seconds }) : t("estMinutes", { m: Math.max(1, mins) })
    : "—"

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fName")}</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fDescription")}</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("fDescriptionPlaceholder")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fNotes")}</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" placeholder={t("fNotesPlaceholder")} />
          </div>

          {/* ── Coins ── */}
          <Group title={t("gCoins")} hint={t("gCoinsHint")}>
            {(["single", "group", "random", "all"] as const).map((m) => (
              <Radio
                key={m}
                name="optimization-coin-mode"
                checked={coinMode === m}
                onChange={() => setCoinMode(m)}
                label={t(`coinMode_${m}`)}
              />
            ))}
          </Group>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {coinMode === "single" && (
              <CoinSelect coins={coins} favoriteIds={favoriteIds} value={coinId} onChange={(id) => setCoinId(id || null)} groups={[]} selectedGroupId={null} onSelectGroup={() => {}} />
            )}
            {coinMode === "group" && (
              <select value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value || null)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
                <option value="">{t("selectGroup")}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.member_coin_ids.length})</option>)}
              </select>
            )}
            {coinMode === "random" && (
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={500} value={coinCount} onChange={(e) => setCoinCount(Math.max(1, Math.min(500, e.target.valueAsNumber || 1)))} className="h-9 w-24" />
                <span className="text-xs text-[var(--muted-foreground)]">{t("randomCoinsHint")}</span>
              </div>
            )}
            {coinMode === "all" && <p className="text-xs text-amber-600 dark:text-amber-400 self-center">{t("allCoinsHint")}</p>}
          </div>

          {/* ── Timeframes + range ── */}
          <Group title={t("gTimeframes")}>
            {INTERVALS.map((iv) => (
              <Tick key={iv} checked={intervals.includes(iv)} onChange={() => setIntervals((s) => toggle(s, iv))} label={iv} />
            ))}
          </Group>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fFrom")}</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fTo")}</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* ── Signal knobs, per strategy ── */}
          <Group title={axes.thresholdLabel} hint={axes.thresholdHint}>
            {axes.thresholdOptions.map((o) => (
              <Tick
                key={o.value}
                checked={thresholds.includes(o.value)}
                onChange={() => setThresholds((s) => toggle(s, o.value))}
                label={o.label}
              />
            ))}
          </Group>
          {axes.choice && (
            <Group title={axes.choice.label} hint={axes.choice.hint}>
              {axes.choice.options.map((o) => (
                <Tick
                  key={o.value}
                  checked={choices.includes(o.value)}
                  onChange={() => setChoices((s) => toggle(s, o.value))}
                  label={o.label}
                />
              ))}
            </Group>
          )}
          {/* Each picked kind's own knobs — only the ones it reads. */}
          {axes.choice?.params && choices.map((kind) => {
            const ax = axes.choice!.params![kind]
            if (!ax) return null
            return (
              <Group key={kind} title={`${kind.toUpperCase()} · ${ax.label}`} hint={ax.hint}>
                {ax.options.map((o) => (
                  <Tick
                    key={o.value}
                    checked={(choiceParams[kind] ?? []).includes(o.value)}
                    onChange={() => setChoiceParams((prev) => ({
                      ...prev, [kind]: toggle(prev[kind] ?? [], o.value),
                    }))}
                    label={o.label}
                  />
                ))}
              </Group>
            )
          })}
          {axes.signal.map((a) => (
            <Group key={a.key} title={a.label} hint={a.hint}>
              {a.options.map((o) => (
                <Tick
                  key={o.value}
                  checked={(signalAxes[a.key] ?? []).includes(o.value)}
                  onChange={() => setSignalAxes((prev) => ({
                    ...prev, [a.key]: toggle(prev[a.key] ?? [], o.value),
                  }))}
                  label={o.label}
                />
              ))}
            </Group>
          ))}
          <Group title={t("gHold")}>
            {HOLDS.map((v) => <Tick key={v} checked={holds.includes(v)} onChange={() => setHolds((s) => toggle(s, v))} label={String(v)} />)}
          </Group>
          <Group title={t("gSide")}>
            {SIDES.map((v) => <Tick key={v} checked={sides.includes(v)} onChange={() => setSides((s) => toggle(s, v))} label={t(`side_${v}`)} />)}
          </Group>
          {axes.supportsVolGate !== false && <Group title={t("gVolGate")}>
            {VOL_GATES.map((v) => <Tick key={v} checked={volGate.includes(v)} onChange={() => setVolGate((s) => toggle(s, v))} label={t(`volGate_${v}`)} />)}
          </Group>}
          <Group title={t("gHtf")}>
            {HTF_GATES.map((v) => <Tick key={v} checked={htfGate.includes(v)} onChange={() => setHtfGate((s) => toggle(s, v))} label={t(`htfGate_${v}`)} />)}
          </Group>

          {/* ── Exits ── */}
          <Group title={t("gStop")} hint={t("gStopHint")}>
            {SL_MODES.map((v) => <Tick key={v} checked={slModes.includes(v)} onChange={() => setSlModes((s) => toggle(s, v))} label={t(`sl_${v}`)} />)}
          </Group>
          {slModes.includes("pct") && (
            <Group title={t("gStopPct")}>
              {PCT_LADDER.map((v) => <Tick key={v} checked={slPct.includes(v)} onChange={() => setSlPct((s) => toggle(s, v))} label={`${v}%`} />)}
            </Group>
          )}
          {slModes.includes("atr") && (
            <Group title={t("gStopAtr")}>
              {ATR_LADDER.map((v) => <Tick key={v} checked={slAtr.includes(v)} onChange={() => setSlAtr((s) => toggle(s, v))} label={`${v}×`} />)}
            </Group>
          )}
          {slModes.includes("trail_atr") && (
            <Group title={t("gStopTrail")}>
              {ATR_LADDER.map((v) => <Tick key={v} checked={slTrail.includes(v)} onChange={() => setSlTrail((s) => toggle(s, v))} label={`${v}×`} />)}
            </Group>
          )}
          <Group title={t("gTarget")}>
            {TP_MODES.map((v) => <Tick key={v} checked={tpModes.includes(v)} onChange={() => setTpModes((s) => toggle(s, v))} label={t(`tp_${v}`)} />)}
          </Group>
          {tpModes.includes("pct") && (
            <Group title={t("gTargetPct")}>
              {PCT_LADDER.map((v) => <Tick key={v} checked={tpPct.includes(v)} onChange={() => setTpPct((s) => toggle(s, v))} label={`${v}%`} />)}
            </Group>
          )}

          {/* ── Budget + counter ── */}
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">{t("fBudget")}</span>
                <Input type="number" min={1} max={20000} value={maxCombos} onChange={(e) => setMaxCombos(Math.max(1, Math.min(20000, e.target.valueAsNumber || 1)))} className="h-8 w-28" />
              </div>
              <div className="text-xs tabular-nums flex items-center gap-2">
                {estimating && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />}
                <span className={cn("font-medium", danger ? "text-red-500" : warn ? "text-amber-500" : "")}>
                  {t("combosCount", { n: n.toLocaleString("en-US") })}
                </span>
                <span className="text-[var(--muted-foreground)]">
                  {t("acrossMarkets", { markets: est?.n_markets ?? 0, per: (est?.n_param_combos ?? 0).toLocaleString("en-US") })}
                </span>
                <Badge variant="outline" className="text-[10px] font-normal">{t("estRuntime", { runtime })}</Badge>
              </div>
            </div>
            {est?.sampled && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                {t("willSample", { cartesian: est.n_cartesian.toLocaleString("en-US"), n: n.toLocaleString("en-US") })}
              </p>
            )}
            {needsConfirm && (
              <label className={cn(
                "flex items-start gap-2.5 rounded-md border p-2.5 cursor-pointer",
                danger ? "border-red-500/40 bg-red-500/5" : "border-amber-500/40 bg-amber-500/5",
              )}>
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)} className="mt-0.5 shrink-0" />
                <span className="text-xs flex items-start gap-1.5">
                  <AlertTriangle className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", danger ? "text-red-500" : "text-amber-500")} />
                  {danger
                    ? t("dangerConfirm", { n: n.toLocaleString("en-US"), runtime })
                    : t("warnConfirm", { n: n.toLocaleString("en-US"), runtime })}
                </span>
              </label>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>{t("cancel")}</Button>
          <Button
            size="sm"
            variant={danger ? "destructive" : "default"}
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
          >
            <Play className="h-3.5 w-3.5 mr-1.5" />
            {createMutation.isPending ? t("starting") : t("run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
