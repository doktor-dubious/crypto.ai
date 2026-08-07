"use client"

// Analyze tab of the Paper Trade detail pane. Slices a template's closed trades
// into buckets — hour of day, 4-hour block, session, weekday, side, exit reason
// — and shows how the strategy performed in each, with the sample size and a
// significance number next to every figure.
//
// The headline question is time of day: with a handful of trades per hour, the
// spread between hours is nearly always noise, so the verdict line leans on the
// bucket-vs-rest Welch t (|t| ≥ 2, n ≥ MIN_N) rather than on the ranking, and
// the multiple-comparison caveat stays visible.
//
// On top of the read-only cuts there's a what-if filter: restrict the trades to
// a set of hours / 4-hour blocks / weekdays / sides and see what the strategy
// would have returned. Intersections can't be read off the pre-aggregated
// buckets, so the response carries the raw trades and the filtered stats are
// recomputed here as the selection changes.

import { createContext, useContext, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { BarChart3, RefreshCw, RotateCcw } from "lucide-react"
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  ChartContainer, ChartTooltip, type ChartConfig,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import {
  paperTradeApi, type AnalysisBucket, type AnalysisTrade, type PaperTradeAnalysis,
} from "@/lib/api"

// A bucket below this many trades is shown but never used to draw a conclusion.
const MIN_N = 10
// |Welch t| against the other trades that we're willing to call a real edge.
const T_THRESHOLD = 2

// The pane runs as wide as the window; full-bleed charts stretch a 24-bar series
// into something unreadable, so cap the content and cap the charts tighter.
const PANEL_W = "max-w-5xl"
const CHART_W = "max-w-3xl"

const POS = "hsl(142 71% 45%)"
const NEG = "hsl(0 72% 51%)"
const DIM = "hsl(215 16% 47%)"

const chartConfig: ChartConfig = {
  mean_bps: { label: "Mean return (bps)", color: POS },
}

// The same view serves paper trades and a strategy workbench's BACKTEST trades.
// A backtest has no runs and no capital behind it, so every quote-P/L figure
// would read a constant 0 — those columns are dropped rather than shown as zero.
const BacktestContext = createContext(false)
const useIsBacktest = () => useContext(BacktestContext)

export function AnalysisTab({ templateId }: { templateId: string }) {
  const t = useTranslations("paperTrade")
  const [started, setStarted] = useState(false)
  const [scope, setScope] = useState<"template" | "run">("template")
  const [useLocal, setUseLocal] = useState(false)

  // Positive-east offset in minutes (getTimezoneOffset is positive-west).
  const localOffset = useMemo(() => -new Date().getTimezoneOffset(), [])
  const tzOffset = useLocal ? localOffset : 0

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["paperTradeAnalysis", templateId, scope, tzOffset],
    queryFn: () => paperTradeApi.analyze(templateId, scope, tzOffset),
    enabled: started,
    staleTime: 60_000,
  })

  if (!started) {
    return (
      <div className="max-w-2xl space-y-4 py-6">
        <div className="rounded-md border p-4 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">{t("analyzeTitle")}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{t("analyzeDescription")}</p>
          </div>
          <Button size="sm" className="shrink-0 cursor-pointer" onClick={() => setStarted(true)}>
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" />{t("analyzeRun")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-6 py-4", PANEL_W)}>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          options={[
            { value: "template", label: t("analyzeScopeAll") },
            { value: "run", label: t("analyzeScopeRun") },
          ]}
          value={scope}
          onChange={(v) => setScope(v as "template" | "run")}
        />
        <Toggle
          options={[
            { value: "utc", label: t("analyzeTzUtc") },
            { value: "local", label: t("analyzeTzLocal") },
          ]}
          value={useLocal ? "local" : "utc"}
          onChange={(v) => setUseLocal(v === "local")}
        />
        <Button
          variant="ghost" size="sm" className="cursor-pointer ml-auto"
          onClick={() => refetch()} disabled={isFetching}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
          {t("analyzeRefresh")}
        </Button>
      </div>

      {/* Tick-guard notices. When only SOME pooled runs are tick-limited they
          are dropped and the shrunken totals say so; when ALL of them are, the
          backend keeps them (dropping would leave nothing to analyze at all)
          and flags the analysis instead — warn, don't hide. */}
      {data && data.tick_limited && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("analyzeTickLimitedAll", {
            symbols: data.tick_excluded_symbols.join(", "),
          })}
        </p>
      )}
      {data && !data.tick_limited && data.n_tick_excluded > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("analyzeTickExcluded", {
            count: data.n_tick_excluded,
            symbols: data.tick_excluded_symbols.join(", "),
          })}
        </p>
      )}

      {isError ? (
        <p className="py-8 text-center text-sm text-red-500">{t("analyzeError")}</p>
      ) : !data ? (
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{t("analyzeRunning")}</p>
      ) : data.n_trades === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{t("analyzeNoTrades")}</p>
      ) : (
        <Results data={data} useLocal={useLocal} tzOffset={tzOffset} />
      )}
    </div>
  )
}

/**
 * The bucket cuts, charts and what-if filter for one analysis. Exported so the
 * strategy workbench's Analytics tab can render the same view over the trades a
 * BACKTEST produced (`isBacktest`), instead of a template's paper trades.
 */
export function AnalysisResults({
  data, useLocal, tzOffset, isBacktest = false,
}: {
  data: PaperTradeAnalysis
  useLocal: boolean
  tzOffset: number
  isBacktest?: boolean
}) {
  return (
    <BacktestContext.Provider value={isBacktest}>
      <Results data={data} useLocal={useLocal} tzOffset={tzOffset} />
    </BacktestContext.Provider>
  )
}

function Results({
  data, useLocal, tzOffset,
}: { data: PaperTradeAnalysis; useLocal: boolean; tzOffset: number }) {
  const t = useTranslations("paperTrade")
  const isBacktest = useIsBacktest()
  const tzLabel = useLocal ? t("analyzeTzLocal") : "UTC"

  // The verdict: strongest hour block that clears both the sample-size floor and
  // the significance bar. Hours are ranked too, but a single hour rarely has the
  // sample to support a claim, so blocks lead.
  const verdict = useMemo(() => pickStandout(data.by_hour_block), [data.by_hour_block])
  const hourStandout = useMemo(() => pickStandout(data.by_hour), [data.by_hour])

  return (
    <div className="space-y-8">
      {/* Header stats */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="font-medium tabular-nums">
          {data.n_trades.toLocaleString("en-US")} {t("analyzeClosedTrades")}
        </span>
        {!isBacktest && (
          <span className="text-[var(--muted-foreground)] tabular-nums">
            {t("analyzeAcrossRuns", { runs: data.n_runs, coins: data.coins.length })}
          </span>
        )}
        {data.n_open > 0 && (
          <span className="text-[var(--muted-foreground)] tabular-nums">
            {t("analyzeOpenExcluded", { count: data.n_open })}
          </span>
        )}
        {data.first_entry && data.last_entry && (
          <span className="text-[var(--muted-foreground)]">
            {new Date(data.first_entry).toLocaleDateString()} – {new Date(data.last_entry).toLocaleDateString()}
          </span>
        )}
        <span className="text-[var(--muted-foreground)] tabular-nums">
          {t("analyzeOverall")}{" "}
          <span className={cn("font-mono", (data.overall.mean_bps ?? 0) >= 0 ? "text-emerald-500" : "text-red-500")}>
            {bps(data.overall.mean_bps)}
          </span>
          {" · "}
          {pct(data.overall.win_rate)} {t("summaryWinRate")}
        </span>
      </div>

      {/* Verdict */}
      <div className={cn(
        "rounded-md border p-3 text-sm",
        verdict ? "border-amber-500/40 bg-amber-500/5" : "border-[var(--border)]",
      )}>
        {verdict ? (
          <>
            <p className="font-medium">
              {t(verdict.mean_bps! >= 0 ? "analyzeVerdictBest" : "analyzeVerdictWorst", {
                block: `${verdict.label} ${tzLabel}`,
                bps: bps(verdict.mean_bps),
                n: verdict.n_trades,
                t: verdict.t_vs_rest!.toFixed(1),
              })}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">{t("analyzeVerdictCaveat")}</p>
          </>
        ) : (
          <>
            <p className="font-medium">{t("analyzeVerdictNone", { n: MIN_N, t: T_THRESHOLD })}</p>
            {hourStandout && (
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                {t("analyzeVerdictHourHint", { hour: `${hourStandout.label} ${tzLabel}` })}
              </p>
            )}
          </>
        )}
      </div>

      {/* What-if: constrain the trades to a schedule and re-score them */}
      <WhatIf
        trades={data.trades}
        tzOffset={tzOffset}
        tzLabel={tzLabel}
        truncated={data.trades_truncated}
        weekdayLabels={data.by_weekday.map((b) => b.label)}
      />

      {/* Hour of day */}
      <Section title={t("analyzeByHour", { tz: tzLabel })} description={t("analyzeByHourDesc")}>
        <BucketBars buckets={data.by_hour} overall={data.overall.mean_bps ?? 0} />
      </Section>

      {/* 4-hour blocks — the same data at a sample size that can carry a claim */}
      <Section title={t("analyzeByBlock", { tz: tzLabel })} description={t("analyzeByBlockDesc")}>
        <BucketBars buckets={data.by_hour_block} overall={data.overall.mean_bps ?? 0} />
        <BucketTable buckets={data.by_hour_block} label={t("analyzeColBlock")} />
      </Section>

      {/* Sessions (always UTC) */}
      <Section title={t("analyzeBySession")} description={t("analyzeBySessionDesc")}>
        <BucketTable buckets={data.by_session} label={t("analyzeColSession")} />
      </Section>

      {/* Weekday */}
      <Section title={t("analyzeByWeekday")} description={t("analyzeByWeekdayDesc")}>
        <BucketBars buckets={data.by_weekday} overall={data.overall.mean_bps ?? 0} />
        <BucketTable buckets={data.by_weekday} label={t("analyzeColWeekday")} />
      </Section>

      {/* Side + exit reason — context for whatever the time cuts turn up */}
      <Section title={t("analyzeBySide")} description={t("analyzeBySideDesc")}>
        <BucketTable buckets={data.by_side} label={t("colSide")} />
      </Section>
      <Section title={t("analyzeByExitReason")} description={t("analyzeByExitReasonDesc")}>
        <BucketTable buckets={data.by_exit_reason} label={t("colReason")} />
      </Section>
    </div>
  )
}

function Section({
  title, description, children,
}: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-[var(--muted-foreground)]">{description}</p>
      </div>
      {children}
    </section>
  )
}

// Mean return per bucket, green above zero / red below, dimmed when the bucket
// is too small to mean anything. The dashed line is the overall mean.
function BucketBars({ buckets, overall }: { buckets: AnalysisBucket[]; overall: number }) {
  const rows = buckets.map((b) => ({ ...b, mean_bps: b.mean_bps ?? 0 }))
  return (
    <ChartContainer config={chartConfig} className={cn("h-48 w-full", CHART_W)}>
      <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
        <ReferenceLine y={overall} stroke="var(--muted-foreground)" strokeDasharray="4 4" opacity={0.6} />
        <ChartTooltip content={<BucketTooltip />} />
        <Bar dataKey="mean_bps" radius={[3, 3, 0, 0]}>
          {rows.map((b) => (
            <Cell key={b.key} fill={b.n_trades < MIN_N ? DIM : b.mean_bps >= 0 ? POS : NEG} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// The shared ChartTooltipContent only forwards value+name; the sample size and
// win rate matter more than the bar height here, so read the row off the payload.
function BucketTooltip({ active, payload }: { active?: boolean; payload?: { payload: AnalysisBucket }[] }) {
  const b = payload?.[0]?.payload
  if (!active || !b) return null
  return (
    <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{b.label}</p>
      <p className="text-[var(--muted-foreground)] tabular-nums">
        <span className={signColor(b.mean_bps)}>{bps(b.mean_bps)}</span>
        {` · ${b.n_trades} trades · ${pct(b.win_rate)} win`}
      </p>
    </div>
  )
}

// ─── What-if filter ──────────────────────────────────────────────────────────

// Hours follow the timezone toggle and weekdays stay UTC, exactly as the tables
// below do, so a chip's contribution matches the row it came from.
// `sides: null` means "every side" — which sides exist isn't known until the
// data lands, so the initial state can't enumerate them.
type Filter = { hours: Set<number>; weekdays: Set<number>; sides: Set<string> | null }

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i)
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

function WhatIf({
  trades, tzOffset, tzLabel, truncated, weekdayLabels,
}: {
  trades: AnalysisTrade[]
  tzOffset: number
  tzLabel: string
  truncated: boolean
  weekdayLabels: string[]
}) {
  const t = useTranslations("paperTrade")
  const showPnl = !useIsBacktest()

  // Entry hour in the selected zone, weekday in UTC, once per fetch.
  const rows = useMemo(
    () =>
      trades.map((tr) => {
        const utc = new Date(tr.entry_time.endsWith("Z") ? tr.entry_time : `${tr.entry_time}Z`)
        const shifted = new Date(utc.getTime() + tzOffset * 60_000)
        return {
          ...tr,
          ms: utc.getTime(),
          hour: shifted.getUTCHours(),
          weekday: (utc.getUTCDay() + 6) % 7, // Mon-first
        }
      }),
    [trades, tzOffset],
  )

  const sides = useMemo(
    () => Array.from(new Set(rows.map((r) => r.side))).sort(),
    [rows],
  )

  const [filter, setFilter] = useState<Filter>(() => ({
    hours: new Set(ALL_HOURS), weekdays: new Set(ALL_WEEKDAYS), sides: null,
  }))
  const activeSides = useMemo(
    () => filter.sides ?? new Set(sides),
    [filter.sides, sides],
  )

  const matches = (r: { hour: number; weekday: number; side: string }) =>
    filter.hours.has(r.hour) && filter.weekdays.has(r.weekday) && activeSides.has(r.side)
  const kept = rows.filter(matches)
  const excluded = rows.filter((r) => !matches(r))
  // "Nothing is selected away" (drives Reset) vs "the selection happens to keep
  // every trade" (drives the vs-all deltas) — dropping an empty hour is one but
  // not the other.
  const isDefault =
    filter.hours.size === 24 && filter.weekdays.size === 7 && filter.sides === null
  const isFull = kept.length === rows.length

  const keptStats = statsOf(kept)
  const allStats = statsOf(rows)
  const tVsExcluded = welchT(kept.map((r) => r.ret_bps), excluded.map((r) => r.ret_bps))

  // Cumulative bps over time, constrained series against the unconstrained one.
  const { hours: fHours, weekdays: fWeekdays } = filter
  const curve = useMemo(() => {
    let all = 0, sel = 0
    const pts = rows.map((r) => {
      all += r.ret_bps
      if (fHours.has(r.hour) && fWeekdays.has(r.weekday) && activeSides.has(r.side)) {
        sel += r.ret_bps
      }
      return { ms: r.ms, all: round1(all), kept: round1(sel) }
    })
    // Recharts renders every point as an SVG node; thin long series out but keep
    // the last one so the drawn endpoint is the real total.
    const stride = Math.ceil(pts.length / 600)
    return stride > 1 ? pts.filter((_, i) => i % stride === 0 || i === pts.length - 1) : pts
  }, [rows, fHours, fWeekdays, activeSides])

  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }
  const setHours = (hours: Set<number>) => setFilter((f) => ({ ...f, hours }))
  const reset = () =>
    setFilter({ hours: new Set(ALL_HOURS), weekdays: new Set(ALL_WEEKDAYS), sides: null })

  // A response from before the raw rows shipped (or a truncated-to-nothing one).
  if (rows.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">{t("analyzeWhatIfTitle")}</h3>
          <p className="text-xs text-[var(--muted-foreground)]">{t("analyzeWhatIfDesc")}</p>
        </div>
        <Button
          variant="ghost" size="sm" className="cursor-pointer shrink-0"
          onClick={reset} disabled={isDefault}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />{t("analyzeWhatIfReset")}
        </Button>
      </div>

      <div className="rounded-lg border divide-y">
        {/* Hours, grouped under their 4-hour block so a block is one click */}
        <div className="p-3 space-y-2">
          <FilterLabel
            text={t("analyzeWhatIfHours", { tz: tzLabel })}
            onAll={() => setHours(new Set(ALL_HOURS))}
            onNone={() => setHours(new Set())}
          />
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: 6 }, (_, b) => {
              const hours = [0, 1, 2, 3].map((i) => b * 4 + i)
              const on = hours.every((h) => filter.hours.has(h))
              return (
                <div key={b} className="space-y-1">
                  <button
                    onClick={() => {
                      const next = new Set(filter.hours)
                      hours.forEach((h) => (on ? next.delete(h) : next.add(h)))
                      setHours(next)
                    }}
                    className={cn(
                      "block w-full text-[10px] rounded-sm px-1 py-0.5 cursor-pointer transition-colors",
                      on ? "text-foreground font-medium" : "text-[var(--muted-foreground)]",
                      "hover:bg-[var(--muted)]",
                    )}
                  >
                    {`${(b * 4).toString().padStart(2, "0")}–${(b * 4 + 4).toString().padStart(2, "0")}`}
                  </button>
                  <div className="flex gap-0.5">
                    {hours.map((h) => (
                      <Chip
                        key={h}
                        on={filter.hours.has(h)}
                        onClick={() => setHours(toggle(filter.hours, h))}
                        label={h.toString().padStart(2, "0")}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Weekday */}
        <div className="p-3 space-y-2">
          <FilterLabel
            text={t("analyzeWhatIfWeekdays")}
            onAll={() => setFilter((f) => ({ ...f, weekdays: new Set(ALL_WEEKDAYS) }))}
            onNone={() => setFilter((f) => ({ ...f, weekdays: new Set() }))}
          />
          <div className="flex flex-wrap gap-0.5">
            {ALL_WEEKDAYS.map((d) => (
              <Chip
                key={d}
                on={filter.weekdays.has(d)}
                onClick={() => setFilter((f) => ({ ...f, weekdays: toggle(f.weekdays, d) }))}
                label={weekdayLabels[d] ?? String(d)}
                wide
              />
            ))}
          </div>
        </div>

        {/* Side */}
        {sides.length > 1 && (
          <div className="p-3 space-y-2">
            <FilterLabel
              text={t("analyzeWhatIfSides")}
              onAll={() => setFilter((f) => ({ ...f, sides: null }))}
              onNone={() => setFilter((f) => ({ ...f, sides: new Set() }))}
            />
            <div className="flex flex-wrap gap-0.5">
              {sides.map((s) => (
                <Chip
                  key={s}
                  on={activeSides.has(s)}
                  onClick={() =>
                    setFilter((f) => ({ ...f, sides: toggle(f.sides ?? new Set(sides), s) }))
                  }
                  label={s}
                  wide
                />
              ))}
            </div>
          </div>
        )}

        {/* Outcome of the constraint */}
        <div className="p-3 space-y-3">
          {kept.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">
              {t("analyzeWhatIfEmpty")}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Metric
                  label={t("analyzeWhatIfKept")}
                  value={`${kept.length}`}
                  sub={t("analyzeWhatIfOfAll", {
                    total: rows.length,
                    pct: ((kept.length / rows.length) * 100).toFixed(0),
                  })}
                />
                <Metric
                  label={t("analyzeWhatIfMean")}
                  value={bps(keptStats.mean)}
                  tone={keptStats.mean}
                  sub={isFull ? undefined : t("analyzeWhatIfDelta", {
                    delta: bps(keptStats.mean! - allStats.mean!),
                  })}
                />
                <Metric label={t("analyzeWhatIfMedian")} value={bps(keptStats.median)} tone={keptStats.median} />
                <Metric
                  label={t("analyzeWhatIfWinRate")}
                  value={pct(keptStats.winRate)}
                  sub={isFull ? undefined : t("analyzeWhatIfDelta", {
                    delta: `${((keptStats.winRate! - allStats.winRate!) * 100).toFixed(0)}pp`,
                  })}
                />
                <Metric
                  label={t("analyzeWhatIfTotalBps")}
                  value={bps(keptStats.sum)}
                  tone={keptStats.sum}
                  sub={isFull ? undefined : t("analyzeWhatIfOutOf", { total: bps(allStats.sum) })}
                />
                {showPnl && (
                  <Metric
                    label={t("analyzeWhatIfPnl")}
                    value={`${keptStats.pnl >= 0 ? "+" : ""}${keptStats.pnl.toFixed(2)}`}
                    tone={keptStats.pnl}
                  />
                )}
                <Metric
                  label={t("analyzeWhatIfTVsExcluded")}
                  value={tVsExcluded == null ? "—" : tVsExcluded.toFixed(2)}
                  sub={
                    kept.length >= MIN_N && Math.abs(tVsExcluded ?? 0) >= T_THRESHOLD
                      ? t("analyzeStandout")
                      : undefined
                  }
                />
              </div>

              <ChartContainer
                config={{
                  kept: { label: t("analyzeWhatIfCurveKept"), color: POS },
                  all: { label: t("analyzeWhatIfCurveAll"), color: DIM },
                }}
                className={cn("h-44 w-full", CHART_W)}
              >
                <LineChart data={curve} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                  <XAxis
                    dataKey="ms" type="number" domain={["dataMin", "dataMax"]} scale="time"
                    tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" opacity={0.6} />
                  <ChartTooltip content={<CurveTooltip />} />
                  <Line type="monotone" dataKey="all" stroke={DIM} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  <Line type="monotone" dataKey="kept" stroke={POS} dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ChartContainer>
              <div className="flex gap-4 text-[10px] text-[var(--muted-foreground)]">
                <span className="flex items-center gap-1">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: POS }} />
                  {t("analyzeWhatIfCurveKept")}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: DIM }} />
                  {t("analyzeWhatIfCurveAll")}
                </span>
              </div>
            </>
          )}
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("analyzeWhatIfCaveat")}
            {truncated && ` ${t("analyzeWhatIfTruncated", { count: rows.length })}`}
          </p>
        </div>
      </div>
    </section>
  )
}

function FilterLabel({
  text, onAll, onNone,
}: { text: string; onAll: () => void; onNone: () => void }) {
  const t = useTranslations("paperTrade")
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium">{text}</span>
      <button onClick={onAll} className="text-[10px] text-[var(--muted-foreground)] hover:text-foreground cursor-pointer">
        {t("analyzeWhatIfAll")}
      </button>
      <button onClick={onNone} className="text-[10px] text-[var(--muted-foreground)] hover:text-foreground cursor-pointer">
        {t("analyzeWhatIfNone")}
      </button>
    </div>
  )
}

function Chip({
  on, onClick, label, wide,
}: { on: boolean; onClick: () => void; label: string; wide?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-sm border text-[11px] tabular-nums py-0.5 cursor-pointer transition-colors",
        wide ? "px-2" : "w-7",
        on
          ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
          : "border-transparent bg-[var(--muted)] text-[var(--muted-foreground)] line-through opacity-60 hover:opacity-100",
      )}
    >
      {label}
    </button>
  )
}

function Metric({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: number | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className={cn("text-sm font-mono tabular-nums", tone === undefined ? "" : signColor(tone))}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--muted-foreground)] tabular-nums">{sub}</p>}
    </div>
  )
}

function CurveTooltip({
  active, payload, label,
}: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: number }) {
  const t = useTranslations("paperTrade")
  if (!active || !payload?.length) return null
  const get = (k: string) => payload.find((p) => p.dataKey === k)?.value ?? 0
  return (
    <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-md space-y-0.5">
      <p className="font-medium">{label ? new Date(label).toLocaleDateString() : ""}</p>
      <p className="tabular-nums">
        <span className={signColor(get("kept"))}>{bps(get("kept"))}</span>
        <span className="text-[var(--muted-foreground)]">{` ${t("analyzeWhatIfCurveKept")}`}</span>
      </p>
      <p className="tabular-nums text-[var(--muted-foreground)]">
        {bps(get("all"))} {t("analyzeWhatIfCurveAll")}
      </p>
    </div>
  )
}

// Mean/median/win-rate/total for a selection. Mirrors the backend's BucketStat
// so a single-bucket filter reproduces that bucket's row exactly.
function statsOf(rows: { ret_bps: number; pnl: number }[]) {
  const n = rows.length
  if (!n) return { n, mean: null, median: null, winRate: null, sum: null, pnl: 0 }
  const v = rows.map((r) => r.ret_bps)
  const sorted = [...v].sort((a, b) => a - b)
  const mid = Math.floor(n / 2)
  return {
    n,
    mean: v.reduce((a, b) => a + b, 0) / n,
    median: n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    winRate: v.filter((x) => x > 0).length / n,
    sum: v.reduce((a, b) => a + b, 0),
    pnl: rows.reduce((a, r) => a + r.pnl, 0),
  }
}

// Welch t of the kept trades against the ones the filter dropped — the same test
// the bucket tables report, so it's read the same way (|t| ≥ 2, n ≥ MIN_N).
function welchT(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length
  const varOf = (x: number[]) => {
    const m = mean(x)
    return x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)
  }
  const se = Math.sqrt(varOf(a) / a.length + varOf(b) / b.length)
  if (!(se > 0)) return null
  return (mean(a) - mean(b)) / se
}

const round1 = (v: number) => Math.round(v * 10) / 10

// ─── Read-only bucket tables ─────────────────────────────────────────────────

function BucketTable({ buckets, label }: { buckets: AnalysisBucket[]; label: string }) {
  const t = useTranslations("paperTrade")
  const showPnl = !useIsBacktest()
  return (
    <div className={cn("rounded-lg border overflow-x-auto", PANEL_W)}>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">{label}</TableHead>
            <TableHead className="text-right">{t("analyzeColTrades")}</TableHead>
            <TableHead className="text-right">{t("analyzeColWinRate")}</TableHead>
            <TableHead className="text-right">{t("analyzeColMean")}</TableHead>
            <TableHead className="text-right">{t("analyzeColMedian")}</TableHead>
            {showPnl && <TableHead className="text-right">{t("analyzeColPnl")}</TableHead>}
            <TableHead className="text-right pr-4">{t("analyzeColTVsRest")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {buckets.map((b) => {
            const strong = b.n_trades >= MIN_N && Math.abs(b.t_vs_rest ?? 0) >= T_THRESHOLD
            return (
              <TableRow key={b.key} className={cn(b.n_trades === 0 && "opacity-40")}>
                <TableCell className="pl-4 font-medium">
                  {b.label}
                  {strong && (
                    <Badge variant="outline" className="ml-2 text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                      {t("analyzeStandout")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", b.n_trades < MIN_N && "text-[var(--muted-foreground)]")}>
                  {b.n_trades}
                </TableCell>
                <TableCell className="text-right tabular-nums">{pct(b.win_rate)}</TableCell>
                <TableCell className={cn("text-right font-mono tabular-nums", signColor(b.mean_bps))}>{bps(b.mean_bps)}</TableCell>
                <TableCell className={cn("text-right font-mono tabular-nums", signColor(b.median_bps))}>{bps(b.median_bps)}</TableCell>
                {showPnl && (
                  <TableCell className={cn("text-right font-mono tabular-nums", signColor(b.sum_pnl))}>
                    {b.n_trades === 0 ? "—" : `${b.sum_pnl >= 0 ? "+" : ""}${b.sum_pnl.toFixed(2)}`}
                  </TableCell>
                )}
                <TableCell className={cn("text-right font-mono tabular-nums pr-4", strong ? "font-medium" : "text-[var(--muted-foreground)]")}>
                  {b.t_vs_rest == null ? "—" : b.t_vs_rest.toFixed(2)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function Toggle({
  options, value, onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 text-xs rounded-sm cursor-pointer transition-colors",
            value === o.value ? "bg-[var(--muted)] font-medium" : "text-[var(--muted-foreground)] hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// The bucket that most stands out from the rest of the trades — biggest |t| that
// clears both bars. Null when nothing does, which is the common (honest) case.
function pickStandout(buckets: AnalysisBucket[]): AnalysisBucket | null {
  const eligible = buckets.filter(
    (b) => b.n_trades >= MIN_N && b.t_vs_rest != null && Math.abs(b.t_vs_rest) >= T_THRESHOLD,
  )
  if (eligible.length === 0) return null
  return eligible.reduce((a, b) => (Math.abs(b.t_vs_rest!) > Math.abs(a.t_vs_rest!) ? b : a))
}

const bps = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)} bps`)
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`)
const signColor = (v: number | null) =>
  v == null ? "text-[var(--muted-foreground)]" : v >= 0 ? "text-emerald-500" : "text-red-500"
