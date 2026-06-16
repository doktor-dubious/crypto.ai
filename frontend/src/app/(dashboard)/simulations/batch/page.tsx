"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { Search, Trash2, Play, Loader2, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  coinsApi, klinesApi, klineSimulationsApi,
  type KlineSimulationResponse, type BacktestResponse,
} from "@/lib/api"

const BATCH_KEY = "crypt:simBatches"

type Batch = {
  id: string
  label: string
  createdAt: string
  strategy: string
  interval: string
  engine: string
  quoteAsset: string
  start: string
  end: string
  forecastVol: boolean
  simIds: string[]
}

function loadBatches(): Batch[] {
  if (typeof window === "undefined") return []
  try { return JSON.parse(localStorage.getItem(BATCH_KEY) || "[]") } catch { return [] }
}
function saveBatches(b: Batch[]) {
  if (typeof window !== "undefined") localStorage.setItem(BATCH_KEY, JSON.stringify(b))
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const SELECT_CLASS = "h-9 w-full px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
const fmtPct = (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`

// ── Per-batch results: poll each sim, backtest the finished ones, aggregate ──
type BatchRow = { sim: KlineSimulationResponse; bt: BacktestResponse | null }

function BatchResults({ batch }: { batch: Batch }) {
  const [threshold, setThreshold] = useState(0.6)
  const [feeBps, setFeeBps] = useState(15)
  const [minEdge, setMinEdge] = useState(0)
  const [volMode, setVolMode] = useState("")
  const isKline = batch.strategy === "kline"
  const effVolMode = isKline ? "" : volMode

  const { data: rows = [] } = useQuery({
    queryKey: ["batchResults", batch.id, threshold, feeBps, minEdge, effVolMode],
    queryFn: async (): Promise<BatchRow[]> => {
      const sims = await Promise.all(batch.simIds.map((id) => klineSimulationsApi.get(id).catch(() => null)))
      const out: BatchRow[] = []
      for (const s of sims) {
        if (!s) continue
        let bt: BacktestResponse | null = null
        if (s.status === "success" || s.status === "stopped") {
          bt = await klineSimulationsApi
            .backtest(s.id, { threshold, fee_bps: feeBps, min_edge_pct: minEdge, vol_mode: effVolMode || undefined })
            .catch(() => null)
        }
        out.push({ sim: s, bt })
      }
      return out
    },
    refetchInterval: (q) => {
      const d = q.state.data as BatchRow[] | undefined
      return d && d.some((r) => r.sim.status === "pending" || r.sim.status === "started") ? 3000 : false
    },
  })

  const done = rows.filter((r) => r.bt)
  const running = rows.filter((r) => r.sim.status === "pending" || r.sim.status === "started").length
  const failed = rows.filter((r) => r.sim.status === "failure").length
  const stratRets = done.map((r) => r.bt!.total_return_pct)
  const excess = done.map((r) => r.bt!.total_return_pct - r.bt!.buy_hold_return_pct)
  const sharpes = done.map((r) => r.bt!.sharpe)
  const beating = done.filter((r) => r.bt!.total_return_pct > r.bt!.buy_hold_return_pct).length
  const totalTrades = done.reduce((a, r) => a + r.bt!.n_trades, 0)

  return (
    <div className="space-y-4">
      {/* Backtest controls (applied to every coin) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-md border p-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Confidence threshold</label>
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={0.5} max={0.9} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="flex-1" />
            <span className="text-sm font-mono w-10 text-right">{threshold.toFixed(2)}</span>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Round-trip fee (bps)</label>
          <Input type="number" value={feeBps} min={0} max={100} step={2.5} onChange={(e) => setFeeBps(Number(e.target.value))} className="h-9 mt-1" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Min predicted move (%)</label>
          <Input type="number" value={minEdge} min={0} max={20} step={0.1} onChange={(e) => setMinEdge(Number(e.target.value))} className="h-9 mt-1" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Volatility strategy</label>
          <select value={effVolMode} disabled={isKline} onChange={(e) => setVolMode(e.target.value)} className={cn(SELECT_CLASS, "mt-1 disabled:cursor-not-allowed")}>
            <option value="">None (price)</option>
            <option value="vol_targeting">Vol-targeting</option>
            <option value="vol_breakout">Vol-breakout</option>
          </select>
        </div>
      </div>

      {/* Distribution summary */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Summary label="Coins done" value={`${done.length}/${batch.simIds.length}`} hint={running ? `${running} running` : failed ? `${failed} failed` : undefined} />
        <Summary label="Median return" value={fmtPct(median(stratRets))} tone={(median(stratRets) ?? 0) >= 0 ? "good" : "bad"} />
        <Summary label="Median vs B&H" value={fmtPct(median(excess))} tone={(median(excess) ?? 0) >= 0 ? "good" : "bad"} hint="excess over buy & hold" />
        <Summary label="Beat B&H" value={done.length ? `${Math.round((beating / done.length) * 100)}%` : "—"} hint={`${beating}/${done.length} coins`} />
        <Summary label="Median Sharpe" value={median(sharpes) == null ? "—" : median(sharpes)!.toFixed(2)} tone={(median(sharpes) ?? 0) >= 0 ? "good" : "bad"} />
        <Summary label="Total trades" value={totalTrades.toLocaleString()} />
      </div>

      {/* Per-coin table */}
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Coin</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Strategy</TableHead>
              <TableHead className="text-right">Buy &amp; Hold</TableHead>
              <TableHead className="text-right">Excess</TableHead>
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-right">Sharpe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : [...rows].sort((a, b) => (b.bt?.total_return_pct ?? -Infinity) - (a.bt?.total_return_pct ?? -Infinity)).map(({ sim, bt }) => {
              const exc = bt ? bt.total_return_pct - bt.buy_hold_return_pct : null
              return (
                <TableRow key={sim.id}>
                  <TableCell className="font-mono text-sm">{sim.coin_symbol}{sim.quote_asset}</TableCell>
                  <TableCell><StatusBadge status={sim.status} /></TableCell>
                  <TableCell className={cn("text-right text-sm font-mono", bt ? (bt.total_return_pct >= 0 ? "text-green-500" : "text-red-500") : "text-muted-foreground")}>{bt ? fmtPct(bt.total_return_pct) : "—"}</TableCell>
                  <TableCell className="text-right text-sm font-mono text-muted-foreground">{bt ? fmtPct(bt.buy_hold_return_pct) : "—"}</TableCell>
                  <TableCell className={cn("text-right text-sm font-mono", exc == null ? "text-muted-foreground" : exc >= 0 ? "text-green-500" : "text-red-500")}>{exc == null ? "—" : fmtPct(exc)}</TableCell>
                  <TableCell className="text-right text-sm font-mono">{bt ? bt.n_trades.toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-right text-sm font-mono">{bt ? bt.sharpe.toFixed(2) : "—"}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function Summary({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold", tone === "good" && "text-green-500", tone === "bad" && "text-red-500")}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success") return <span className="inline-flex rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-500">Done</span>
  if (status === "pending" || status === "started") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" /> Running
    </span>
  )
  if (status === "failure") return <span className="inline-flex rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">Failed</span>
  return <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">{status}</span>
}

export default function BatchPage() {
  // ── New-batch form ──
  const [label, setLabel] = useState("")
  const [coinIds, setCoinIds] = useState<Set<string>>(new Set())
  const [coinSearch, setCoinSearch] = useState("")
  const [quoteAsset, setQuoteAsset] = useState("USDT")
  const [timeframe, setTimeframe] = useState("")
  const [engine, setEngine] = useState("")
  const [strategy, setStrategy] = useState("price")
  const [forecastVol, setForecastVol] = useState(false)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [creating, setCreating] = useState(false)

  // ── Batches (localStorage) ──
  const [batches, setBatches] = useState<Batch[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => { setBatches(loadBatches()) }, [])
  const selectedBatch = batches.find((b) => b.id === selectedId) ?? null

  const { data: coins = [] } = useQuery({ queryKey: ["coins"], queryFn: () => coinsApi.list({ limit: 1000 }) })
  const { data: engines = [] } = useQuery({ queryKey: ["predictionEngines"], queryFn: () => klinesApi.getEngines() })
  // Pairs/timeframes are read from the first selected coin (assumed shared).
  const firstCoinId = coinIds.size ? [...coinIds][0] : null
  const { data: pairsResp } = useQuery({
    queryKey: ["batchPairs", firstCoinId],
    queryFn: () => klinesApi.getTradingPairs(firstCoinId!),
    enabled: !!firstCoinId,
  })
  const pairs = pairsResp?.pairs ?? []
  const { data: tfResp } = useQuery({
    queryKey: ["batchTfs", firstCoinId, quoteAsset],
    queryFn: () => klinesApi.getTimeframes(firstCoinId!, quoteAsset),
    enabled: !!firstCoinId && !!quoteAsset,
  })
  const timeframes = tfResp?.timeframes ?? []

  const filteredCoins = coins.filter((c) =>
    !coinSearch || c.symbol.toLowerCase().includes(coinSearch.toLowerCase()) || c.name.toLowerCase().includes(coinSearch.toLowerCase()))

  const valid = coinIds.size > 0 && quoteAsset && timeframe && engine && start && end && start < end

  async function runBatch() {
    if (!valid) return
    setCreating(true)
    try {
      const selected = coins.filter((c) => coinIds.has(c.id))
      const lbl = label.trim() || `Batch ${format(new Date(), "MMM d HH:mm")}`
      const results = await Promise.allSettled(
        selected.map((c) => klineSimulationsApi.create({
          coin_id: c.id,
          quote_asset: quoteAsset,
          interval: timeframe,
          start_date: start,
          end_date: end,
          models: [engine],
          strategy,
          forecast_vol: strategy !== "kline" && forecastVol,
          name: `${lbl} · ${c.symbol}`,
        })),
      )
      const simIds = results.flatMap((r) => r.status === "fulfilled" ? [r.value.id] : [])
      const failed = results.length - simIds.length
      if (!simIds.length) { toast.error("Failed to queue any simulations"); return }
      const batch: Batch = {
        id: crypto.randomUUID(),
        label: lbl,
        createdAt: new Date().toISOString(),
        strategy, interval: timeframe, engine, quoteAsset, start, end, forecastVol,
        simIds,
      }
      const next = [batch, ...loadBatches()]
      saveBatches(next); setBatches(next); setSelectedId(batch.id)
      toast.success(`Queued ${simIds.length} simulations${failed ? ` (${failed} failed to queue)` : ""}`)
    } finally {
      setCreating(false)
    }
  }

  function deleteBatch(id: string) {
    const next = loadBatches().filter((b) => b.id !== id)
    saveBatches(next); setBatches(next)
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-6 py-6 gap-8 max-w-5xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Layers className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Batch Runner</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Run the same simulation across many coins at once, then compare the distribution of backtest results — the honest way to tell a real edge from luck on a single coin.
        </p>
      </div>

      {/* ── New batch form ── */}
      <div className="flex flex-col gap-5 rounded-md border p-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 1h Vol-breakout sweep" className="max-w-md" />
        </div>

        {/* Coins */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Coins ({coinIds.size} selected)</label>
            <div className="flex items-center gap-2">
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setCoinIds(new Set(filteredCoins.map((c) => c.id)))}>Select all</button>
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setCoinIds(new Set())}>Clear</button>
            </div>
          </div>
          <div className="relative max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search coins..." value={coinSearch} onChange={(e) => setCoinSearch(e.target.value)} className="h-8 pl-8 text-sm" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1 max-h-52 overflow-y-auto rounded-md border p-2">
            {filteredCoins.map((c) => (
              <label key={c.id} className="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-muted text-sm">
                <Checkbox checked={coinIds.has(c.id)} onCheckedChange={(v) => setCoinIds((prev) => { const n = new Set(prev); v ? n.add(c.id) : n.delete(c.id); return n })} />
                <span className="font-mono">{c.symbol}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Trading Pair</label>
            <select value={quoteAsset} onChange={(e) => { setQuoteAsset(e.target.value); setTimeframe("") }} disabled={!firstCoinId} className={SELECT_CLASS}>
              {pairs.length === 0 ? <option value="USDT">USDT</option> : pairs.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Timeframe</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} disabled={!firstCoinId} className={SELECT_CLASS}>
              <option value="">Select…</option>
              {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Strategy</label>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className={SELECT_CLASS}>
              <option value="price">Price</option>
              <option value="kline">Kline</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Forecast Engine</label>
            <select value={engine} onChange={(e) => setEngine(e.target.value)} className={SELECT_CLASS}>
              <option value="">{engines.length === 0 ? "Loading…" : "Select…"}</option>
              {engines.map((eng) => <option key={eng.name} value={eng.name}>{eng.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Start date</label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">End date</label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9" />
          </div>
          {strategy !== "kline" && (
            <label className="flex items-center gap-2 cursor-pointer h-9">
              <Checkbox checked={forecastVol} onCheckedChange={(c) => setForecastVol(!!c)} />
              <span className="text-sm">Forecast volatility</span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Creates one simulation per coin (pair &amp; timeframe taken from the first coin — assumed shared). The worker runs ~4 at a time, so large batches take a while.
          </p>
          <Button size="sm" onClick={runBatch} disabled={!valid || creating} className="shrink-0">
            {creating ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Queuing…</> : <><Play className="h-4 w-4 mr-1" /> Run batch ({coinIds.size})</>}
          </Button>
        </div>
      </div>

      {/* ── Batches list ── */}
      {batches.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Batches</h2>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Coins</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Timeframe</TableHead>
                  <TableHead>Date Range</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id} data-state={selectedId === b.id ? "selected" : undefined} onClick={() => setSelectedId(b.id)} className="cursor-pointer">
                    <TableCell className="text-sm font-medium">{b.label}</TableCell>
                    <TableCell className="text-sm">{b.simIds.length}</TableCell>
                    <TableCell className="text-xs">{b.strategy === "kline" ? "Kline" : "Price"}{b.forecastVol ? " · vol" : ""}</TableCell>
                    <TableCell className="text-sm">{b.interval}</TableCell>
                    <TableCell className="text-xs font-mono">{b.start} → {b.end}</TableCell>
                    <TableCell className="text-xs">{format(new Date(b.createdAt), "MMM d, HH:mm")}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => deleteBatch(b.id)} className="text-muted-foreground hover:text-destructive" title="Delete batch (keeps the simulations)">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ── Selected batch results ── */}
      {selectedBatch && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{selectedBatch.label} — results</h2>
          <BatchResults key={selectedBatch.id} batch={selectedBatch} />
        </div>
      )}
    </div>
  )
}
