"use client"

// Shared coin / trading pair / timeframe / date-range picker for the Trading
// strategy pages. Defaults the range to the last 12 months of available data;
// persists the selection so the scope follows the user between strategy pages.
//
// The fields come back as two separate nodes rather than one block, because the
// workbench splits them across tabs: coin/pair/timeframe are what a strategy is
// PINNED to (Basics), while the date range only scopes the backtest you are
// looking at right now (Parameters) and is never saved onto a strategy.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CoinSelect } from "@/components/trading/coin-select"
import { format, parseISO, subMonths } from "date-fns"
import type { DateRange } from "react-day-picker"
import { CalendarIcon, Lock } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { coinsApi, coinGroupsApi, klinesApi, type CoinResponse, type SwingScope } from "@/lib/api"

const SELECT_CLASS = "h-9 w-full px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
const DEFAULT_FORM_KEY = "crypt:tradingScope"

const INTERVAL_UNIT_MIN: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080, M: 43200 }
export function intervalMinutes(s: string): number {
  const m = /^(\d+)\s*([mhdwM])$/.exec(s.trim())
  return m ? parseInt(m[1], 10) * (INTERVAL_UNIT_MIN[m[2]] ?? 1) : Number.MAX_SAFE_INTEGER
}

// A coin group selected in place of a single coin. Creating a strategy with one
// of these selected stamps out one strategy per member coin.
export interface TradingScopeGroup {
  id: string
  name: string
  coins: { id: string; symbol: string }[]
}

export interface TradingScopeOptions {
  // Separate persisted selections per page when they shouldn't share one.
  storageKey?: string
  // Pins the date range and locks the calendar (Trend Swings does this while a
  // model-confirmation simulation is selected, so the backtest can't drift
  // outside the sim's forecast coverage). `reason` is the tooltip.
  lockedRange?: { from: Date; to: Date; reason: string } | null
  // An extra control rendered after Timeframe in the Basics block.
  extraField?: React.ReactNode
}

export interface TradingScopeResult {
  scope: SwingScope | null
  group: TradingScopeGroup | null
  selectedCoin: CoinResponse | undefined
  // Point the picker at a saved strategy's market. The date range is left
  // alone — a strategy stores no dates, and clearing it would only strand the
  // explorer with no scope to analyse.
  applyScope: (s: { coin_id?: string; quote_asset?: string; interval?: string }) => void
  // Set the backtest window explicitly. Used by "Open in Analytics" to scope the
  // analysis to the period the strategy actually traded.
  applyDateRange: (from: Date, to: Date) => void
  // Coin / Trading Pair / Timeframe (+ `extraField`) — what a strategy is pinned to.
  basicsFields: React.ReactNode
  // Date range — scopes the backtest only, never saved onto a strategy.
  dateField: React.ReactNode
}

export function useTradingScope(opts: TradingScopeOptions = {}): TradingScopeResult {
  const { storageKey = DEFAULT_FORM_KEY, lockedRange = null, extraField = null } = opts

  const [coinId, setCoinId] = useState<string | null>(null)
  // When a coin GROUP is picked instead of a single coin, coinId holds a
  // representative member (so pairs / timeframes / range still resolve) and
  // groupId marks the group so strategy creation fans out over all members.
  const [groupId, setGroupId] = useState<string | null>(null)
  const [quoteAsset, setQuoteAsset] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const s = JSON.parse(raw)
        if (s.coinId) setCoinId(s.coinId)
        if (s.groupId) setGroupId(s.groupId)
        if (s.quoteAsset) setQuoteAsset(s.quoteAsset)
        if (s.timeframe) setTimeframe(s.timeframe)
        if (s.from && s.to) setDateRange({ from: parseISO(s.from), to: parseISO(s.to) })
      }
    } catch { /* ignore malformed storage */ }
    setLoaded(true)
  }, [storageKey])
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        coinId, groupId, quoteAsset, timeframe,
        from: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : null,
        to: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : null,
      }))
    } catch { /* quota / unavailable — ignore */ }
  }, [loaded, storageKey, coinId, groupId, quoteAsset, timeframe, dateRange])

  const { data: coins = [] } = useQuery({ queryKey: ["coins"], queryFn: () => coinsApi.list({ limit: 1000 }) })
  const { data: groups = [] } = useQuery({ queryKey: ["coin-groups"], queryFn: () => coinGroupsApi.list() })
  const { data: favGroup } = useQuery({ queryKey: ["coinGroups", "favorites"], queryFn: () => coinGroupsApi.favorites() })
  const favoriteIds = useMemo(() => new Set(favGroup?.member_coin_ids ?? []), [favGroup])

  // Picking a coin group: drive the scope off a representative member (first
  // member with data) and reset the dependent fields.
  const selectGroup = useCallback((gid: string) => {
    const g = groups.find((x) => x.id === gid)
    if (!g) return
    const coinSet = new Set(coins.map((c) => c.id))
    const rep = g.member_coin_ids.find((id) => coinSet.has(id)) ?? g.member_coin_ids[0] ?? null
    setGroupId(gid)
    setCoinId(rep)
    setQuoteAsset(null)
    setTimeframe(null)
    setDateRange(undefined)
  }, [groups, coins])

  // The selected group with member symbols resolved, for the create-strategy
  // fan-out. Memoized so consumers can depend on it without looping.
  const group: TradingScopeGroup | null = useMemo(() => {
    const g = groups.find((x) => x.id === groupId)
    if (!g) return null
    const symById = new Map(coins.map((c) => [c.id, c.symbol]))
    const memberCoins = g.member_coin_ids
      .filter((id) => symById.has(id))
      .map((id) => ({ id, symbol: symById.get(id)! }))
    return { id: g.id, name: g.name, coins: memberCoins }
  }, [groups, groupId, coins])

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

  // Default to the LAST 12 MONTHS (capped to available data) — full history
  // (2017+ for BTC) is a heavy first request and rarely what an interactive
  // exploration wants; widen explicitly if needed.
  useEffect(() => {
    if (!dataMin || !dataMax) return
    const yearBack = subMonths(dataMax, 12)
    const from = yearBack > dataMin ? yearBack : dataMin
    setDateRange((r) => (r?.from && r?.to ? r : { from, to: dataMax }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeResp?.start_date, rangeResp?.end_date])

  // A locked range overrides whatever is picked, for as long as it is set.
  const lockFrom = lockedRange ? format(lockedRange.from, "yyyy-MM-dd") : null
  const lockTo = lockedRange ? format(lockedRange.to, "yyyy-MM-dd") : null
  useEffect(() => {
    if (!lockFrom || !lockTo) return
    setDateRange({ from: parseISO(lockFrom), to: parseISO(lockTo) })
  }, [lockFrom, lockTo])

  // Applying a saved strategy's market always targets a single coin, so any
  // group selection is cleared.
  const applyScope = useCallback((s: { coin_id?: string; quote_asset?: string; interval?: string }) => {
    if (s.coin_id) { setCoinId(s.coin_id); setGroupId(null) }
    if (s.quote_asset) setQuoteAsset(s.quote_asset)
    if (s.interval) setTimeframe(s.interval)
  }, [])

  const applyDateRange = useCallback((from: Date, to: Date) => setDateRange({ from, to }), [])

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

  const basicsFields = (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Coin</label>
        <CoinSelect
          coins={coins}
          favoriteIds={favoriteIds}
          value={coinId}
          onChange={(id) => { setCoinId(id || null); setGroupId(null); setQuoteAsset(null); setTimeframe(null); setDateRange(undefined) }}
          groups={groups}
          selectedGroupId={groupId}
          onSelectGroup={selectGroup}
        />
        {group && (
          <p className="text-[10px] text-muted-foreground leading-tight">
            Group · analysing {selectedCoin?.symbol ?? "—"}; Create Strategy makes {group.coins.length} strategies
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Trading Pair</label>
        <select value={quoteAsset ?? ""} onChange={(e) => { setQuoteAsset(e.target.value || null); setTimeframe(null); setDateRange(undefined) }} disabled={!coinId} className={SELECT_CLASS}>
          <option value="">Select…</option>
          {/* With a group selected the base varies per member — show only the
              quote asset (it's the common part) instead of the representative's. */}
          {pairs.map((p) => <option key={p} value={p}>{group ? p : `${selectedCoin?.symbol ?? ""}${p}`}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Timeframe</label>
        <select value={timeframe ?? ""} onChange={(e) => { setTimeframe(e.target.value || null); setDateRange(undefined) }} disabled={!quoteAsset} className={SELECT_CLASS}>
          <option value="">Select…</option>
          {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
        </select>
      </div>
      {extraField}
    </>
  )

  const locked = !!lockedRange
  const dateField = (
    <div className="flex flex-col gap-1.5 col-span-2">
      <label className="text-xs font-medium text-muted-foreground">Date range</label>
      <Popover open={datePickerOpen && !!timeframe && !locked} onOpenChange={(o) => setDatePickerOpen(o && !!timeframe && !locked)}>
        <PopoverTrigger asChild>
          {/* span wrapper: disabled buttons swallow hover, so the tooltip
              must live on an enabled ancestor */}
          <span
            title={
              locked
                ? lockedRange!.reason
                : !timeframe
                  ? "Select a coin, trading pair and timeframe first — the calendar is bounded to that pair's available data."
                  : undefined
            }
            className="w-full"
          >
            <Button
              variant="outline"
              disabled={!timeframe || locked}
              className={cn(
                "h-9 w-full justify-start text-left text-sm font-normal cursor-pointer",
                !dateRange?.from && "text-muted-foreground",
              )}
            >
              {locked ? <Lock className="mr-1.5 h-3.5 w-3.5" /> : <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />}
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
  )

  return { scope, group, selectedCoin, applyScope, applyDateRange, basicsFields, dateField }
}
