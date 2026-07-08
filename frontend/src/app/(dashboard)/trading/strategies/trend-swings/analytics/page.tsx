"use client"

// Trading → Strategies → Trend Swings: the standalone swing/crest explorer.
// Pure kline analysis — pick a scope (coin / pair / timeframe / date range)
// and explore; no simulation needed. A completed simulation can optionally be
// selected to power the model-confirmation entry filter.

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format, parseISO, subMonths } from "date-fns"
import type { DateRange } from "react-day-picker"
import { CalendarIcon } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { coinsApi, klinesApi, klineSimulationsApi, type SwingScope } from "@/lib/api"
import { SwingsExplorer } from "@/components/trading/swings-explorer"

const SELECT_CLASS = "h-9 w-full px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
const FORM_KEY = "crypt:trendSwingsScope"

// Order timeframes by real duration (shortest first), e.g. 5m, 15m, 1h, 4h, 1d.
const INTERVAL_UNIT_MIN: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080, M: 43200 }
function intervalMinutes(s: string): number {
  const m = /^(\d+)\s*([mhdwM])$/.exec(s.trim())
  return m ? parseInt(m[1], 10) * (INTERVAL_UNIT_MIN[m[2]] ?? 1) : Number.MAX_SAFE_INTEGER
}

export default function TrendSwingsPage() {
  const [coinId, setCoinId] = useState<string | null>(null)
  const [quoteAsset, setQuoteAsset] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [confirmSimId, setConfirmSimId] = useState<string | null>(null)

  // Persist the scope so it survives navigation.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FORM_KEY)
      if (raw) {
        const s = JSON.parse(raw)
        if (s.coinId) setCoinId(s.coinId)
        if (s.quoteAsset) setQuoteAsset(s.quoteAsset)
        if (s.timeframe) setTimeframe(s.timeframe)
        if (s.from && s.to) setDateRange({ from: parseISO(s.from), to: parseISO(s.to) })
      }
    } catch { /* ignore malformed storage */ }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify({
        coinId, quoteAsset, timeframe,
        from: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : null,
        to: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : null,
      }))
    } catch { /* quota / unavailable — ignore */ }
  }, [loaded, coinId, quoteAsset, timeframe, dateRange])

  const { data: coins = [] } = useQuery({ queryKey: ["coins"], queryFn: () => coinsApi.list({ limit: 1000 }) })
  const { data: pairsResp } = useQuery({
    queryKey: ["simFormPairs", coinId],
    queryFn: () => klinesApi.getTradingPairs(coinId!),
    enabled: !!coinId,
  })
  const pairs = pairsResp?.pairs ?? []
  const { data: tfResp } = useQuery({
    queryKey: ["simFormTfs", coinId, quoteAsset],
    queryFn: () => klinesApi.getTimeframes(coinId!, quoteAsset!),
    enabled: !!coinId && !!quoteAsset,
  })
  const timeframes = [...(tfResp?.timeframes ?? [])].sort((a, b) => intervalMinutes(a) - intervalMinutes(b))
  const { data: rangeResp } = useQuery({
    queryKey: ["simFormRange", coinId, quoteAsset, timeframe],
    queryFn: () => klinesApi.getDateRange(coinId!, quoteAsset!, timeframe!),
    enabled: !!coinId && !!quoteAsset && !!timeframe,
  })
  const dataMin = rangeResp?.start_date ? parseISO(rangeResp.start_date) : undefined
  const dataMax = rangeResp?.end_date ? parseISO(rangeResp.end_date) : undefined

  // Default to the LAST 12 MONTHS (capped to available data) once the scope's
  // range is known — full history (2017+ for BTC) is a heavy first request and
  // rarely what an interactive exploration wants; widen explicitly if needed.
  useEffect(() => {
    if (!dataMin || !dataMax) return
    const yearBack = subMonths(dataMax, 12)
    const from = yearBack > dataMin ? yearBack : dataMin
    setDateRange((r) => (r?.from && r?.to ? r : { from, to: dataMax }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeResp?.start_date, rangeResp?.end_date])

  // Completed simulations matching the scope — candidates for the
  // model-confirmation filter (the one genuinely model-dependent feature).
  const { data: simsResp } = useQuery({
    queryKey: ["klineSimulations", "swingConfirm"],
    queryFn: () => klineSimulationsApi.list({ limit: 500 }),
  })
  const confirmCandidates = useMemo(
    () => (simsResp?.items ?? []).filter((s) =>
      s.coin_id === coinId && s.quote_asset === quoteAsset && s.interval === timeframe
      && (s.status === "success" || s.status === "stopped"),
    ),
    [simsResp, coinId, quoteAsset, timeframe],
  )
  // Drop a selection that no longer matches the scope.
  useEffect(() => {
    if (confirmSimId && !confirmCandidates.some((s) => s.id === confirmSimId)) setConfirmSimId(null)
  }, [confirmSimId, confirmCandidates])

  const selectedCoin = coins.find((c) => c.id === coinId)
  const scope: SwingScope | null =
    coinId && quoteAsset && timeframe && dateRange?.from && dateRange?.to
    && dateRange.from < dateRange.to
      ? {
          coin_id: coinId,
          quote_asset: quoteAsset,
          interval: timeframe,
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        }
      : null
  const confirmSim = confirmCandidates.find((s) => s.id === confirmSimId) ?? null

  function resetDates() {
    setDateRange(undefined)
  }

  return (
    <div className="px-6 py-6 space-y-4">
      {/* Scope pickers */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 rounded-md border p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Coin</label>
          <select value={coinId ?? ""} onChange={(e) => { setCoinId(e.target.value || null); setQuoteAsset(null); setTimeframe(null); resetDates() }} className={SELECT_CLASS}>
            <option value="">Select…</option>
            {coins.map((c) => <option key={c.id} value={c.id}>{c.symbol}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Trading Pair</label>
          <select value={quoteAsset ?? ""} onChange={(e) => { setQuoteAsset(e.target.value || null); setTimeframe(null); resetDates() }} disabled={!coinId} className={SELECT_CLASS}>
            <option value="">Select…</option>
            {pairs.map((p) => <option key={p} value={p}>{selectedCoin?.symbol}{p}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Timeframe</label>
          <select value={timeframe ?? ""} onChange={(e) => { setTimeframe(e.target.value || null); resetDates() }} disabled={!quoteAsset} className={SELECT_CLASS}>
            <option value="">Select…</option>
            {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Date range</label>
          <Popover open={datePickerOpen && !!timeframe} onOpenChange={(o) => setDatePickerOpen(o && !!timeframe)}>
            <PopoverTrigger asChild>
              {/* span wrapper: disabled buttons swallow hover, so the
                  explanation tooltip must live on an enabled ancestor */}
              <span title={!timeframe ? "Select a coin, trading pair and timeframe first — the calendar is bounded to that pair's available data." : undefined} className="w-full">
                <Button
                  variant="outline"
                  disabled={!timeframe}
                  className={cn(
                    "h-9 w-full justify-start text-left text-sm font-normal cursor-pointer",
                    !dateRange?.from && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                  {!timeframe
                    ? "Pick coin / pair / timeframe first"
                    : dateRange?.from
                      ? dateRange.to
                        ? <>{format(dateRange.from, "MMM d, yyyy")} – {format(dateRange.to, "MMM d, yyyy")}</>
                        : format(dateRange.from, "MMM d, yyyy")
                      : "Pick a range"}
                </Button>
              </span>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex gap-0">
                <Calendar
                  mode="range"
                  captionLayout="dropdown"
                  defaultMonth={dateRange?.from ?? dataMin}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={1}
                  startMonth={dataMin}
                  endMonth={dataMax}
                  disabled={dataMin && dataMax ? { before: dataMin, after: dataMax } : undefined}
                />
                <Calendar
                  mode="range"
                  captionLayout="dropdown"
                  defaultMonth={dateRange?.to ?? dataMax}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={1}
                  startMonth={dataMin}
                  endMonth={dataMax}
                  disabled={dataMin && dataMax ? { before: dataMin, after: dataMax } : undefined}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" title="Optional: a completed simulation of this exact scope whose stored P(up) forecasts power the model-confirmation entry filter.">Model confirmation</label>
          <select value={confirmSimId ?? ""} onChange={(e) => setConfirmSimId(e.target.value || null)} disabled={confirmCandidates.length === 0} className={SELECT_CLASS}>
            <option value="">{confirmCandidates.length === 0 ? "No matching sims" : "None"}</option>
            {confirmCandidates.map((s) => (
              <option key={s.id} value={s.id}>{s.name || `${s.models.join(",")} ${s.start_date}→${s.end_date}`}</option>
            ))}
          </select>
        </div>
      </div>

      {scope ? (
        <SwingsExplorer scope={scope} confirmSimId={confirmSimId} confirmSimName={confirmSim?.name ?? null} />
      ) : (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Pick a coin, trading pair, timeframe and date range to explore swing signals — no simulation required.
        </p>
      )}
    </div>
  )
}
