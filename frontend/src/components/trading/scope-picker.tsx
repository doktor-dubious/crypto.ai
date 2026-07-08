"use client"

// Shared coin / trading pair / timeframe / date-range picker for the Trading
// analysis pages. Defaults the range to the last 12 months of available data;
// persists the selection under a shared key so the scope follows the user
// between strategy pages.

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format, parseISO, subMonths } from "date-fns"
import type { DateRange } from "react-day-picker"
import { CalendarIcon } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { coinsApi, klinesApi, type SwingScope } from "@/lib/api"

const SELECT_CLASS = "h-9 w-full px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
const FORM_KEY = "crypt:tradingScope"

const INTERVAL_UNIT_MIN: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080, M: 43200 }
function intervalMinutes(s: string): number {
  const m = /^(\d+)\s*([mhdwM])$/.exec(s.trim())
  return m ? parseInt(m[1], 10) * (INTERVAL_UNIT_MIN[m[2]] ?? 1) : Number.MAX_SAFE_INTEGER
}

export function useTradingScope(): { scope: SwingScope | null; picker: React.ReactNode } {
  const [coinId, setCoinId] = useState<string | null>(null)
  const [quoteAsset, setQuoteAsset] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [datePickerOpen, setDatePickerOpen] = useState(false)

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

  // Default to the last 12 months (capped to available data).
  useEffect(() => {
    if (!dataMin || !dataMax) return
    const yearBack = subMonths(dataMax, 12)
    const from = yearBack > dataMin ? yearBack : dataMin
    setDateRange((r) => (r?.from && r?.to ? r : { from, to: dataMax }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeResp?.start_date, rangeResp?.end_date])

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

  const picker = (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Coin</label>
        <select value={coinId ?? ""} onChange={(e) => { setCoinId(e.target.value || null); setQuoteAsset(null); setTimeframe(null); setDateRange(undefined) }} className={SELECT_CLASS}>
          <option value="">Select…</option>
          {coins.map((c) => <option key={c.id} value={c.id}>{c.symbol}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Trading Pair</label>
        <select value={quoteAsset ?? ""} onChange={(e) => { setQuoteAsset(e.target.value || null); setTimeframe(null); setDateRange(undefined) }} disabled={!coinId} className={SELECT_CLASS}>
          <option value="">Select…</option>
          {pairs.map((p) => <option key={p} value={p}>{selectedCoin?.symbol}{p}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Timeframe</label>
        <select value={timeframe ?? ""} onChange={(e) => { setTimeframe(e.target.value || null); setDateRange(undefined) }} disabled={!quoteAsset} className={SELECT_CLASS}>
          <option value="">Select…</option>
          {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5 col-span-2">
        <label className="text-xs font-medium text-muted-foreground">Date range</label>
        <Popover open={datePickerOpen && !!timeframe} onOpenChange={(o) => setDatePickerOpen(o && !!timeframe)}>
          <PopoverTrigger asChild>
            {/* span wrapper: disabled buttons swallow hover, so the tooltip
                must live on an enabled ancestor */}
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
    </div>
  )

  return { scope, picker }
}
