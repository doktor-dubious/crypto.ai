"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { KlineData } from "@/lib/api"

const UP_COLOR = "#26a69a"
const DOWN_COLOR = "#ef5350"
const AXIS_WIDTH = 64

type ChartPoint = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  hl: [number, number]
  up: boolean
}

/**
 * Draws a single candlestick. Recharts gives us the pixel geometry of the
 * [low, high] floating bar (x, y, width, height); we interpolate the open/close
 * pixels within that range to draw the body, and the full range as the wick.
 */
function Candle(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: ChartPoint
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props
  if (!payload) return null

  const { high, low, open, close, up } = payload
  const color = up ? UP_COLOR : DOWN_COLOR
  const range = high - low
  const valueToY = (v: number) => (range === 0 ? y : y + ((high - v) / range) * height)

  const centerX = x + width / 2
  const openY = valueToY(open)
  const closeY = valueToY(close)
  const bodyY = Math.min(openY, closeY)
  const bodyHeight = Math.max(Math.abs(closeY - openY), 1)
  const bodyWidth = Math.max(width * 0.7, 1)
  const bodyX = centerX - bodyWidth / 2

  return (
    <g>
      <line x1={centerX} x2={centerX} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={bodyX} y={bodyY} width={bodyWidth} height={bodyHeight} fill={color} />
    </g>
  )
}

function formatTick(time: number, interval: string) {
  const d = new Date(time)
  const intraday = /m|h/.test(interval) && !/d|w|M/.test(interval.replace("m", ""))
  if (intraday) {
    return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" })
}

function CandleTooltip({
  active,
  payload,
  interval,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartPoint }>
  interval: string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const color = p.up ? UP_COLOR : DOWN_COLOR
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 8 })
  return (
    <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{new Date(p.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: /m|h/.test(interval) ? "short" : undefined })}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
        <span className="text-muted-foreground">O</span><span className="text-right">{fmt(p.open)}</span>
        <span className="text-muted-foreground">H</span><span className="text-right">{fmt(p.high)}</span>
        <span className="text-muted-foreground">L</span><span className="text-right">{fmt(p.low)}</span>
        <span className="text-muted-foreground">C</span><span className="text-right" style={{ color }}>{fmt(p.close)}</span>
        <span className="text-muted-foreground">Vol</span><span className="text-right">{p.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </div>
    </div>
  )
}

export function KlineChart({
  data,
  interval,
}: {
  data: KlineData[]
  interval: string
}) {
  const chartData = useMemo<ChartPoint[]>(
    () =>
      [...data]
        .sort((a, b) => a.open_time - b.open_time)
        .map((k) => ({
          time: k.open_time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
          hl: [k.low, k.high],
          up: k.close >= k.open,
        })),
    [data],
  )

  const priceDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0) return [0, 1]
    let min = Infinity
    let max = -Infinity
    for (const p of chartData) {
      if (p.low < min) min = p.low
      if (p.high > max) max = p.high
    }
    const pad = (max - min) * 0.05 || max * 0.05 || 1
    return [min - pad, max + pad]
  }, [chartData])

  const priceFmt = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 6 : 2 })

  return (
    <div className="rounded-md border bg-card">
      {/* Price candlesticks */}
      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <XAxis dataKey="time" hide />
          <YAxis
            orientation="right"
            width={AXIS_WIDTH}
            domain={priceDomain}
            tickFormatter={priceFmt}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<CandleTooltip interval={interval} />}
            isAnimationActive={false}
            cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
          />
          <Bar dataKey="hl" shape={<Candle />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Volume */}
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={chartData} margin={{ top: 0, right: 12, bottom: 8, left: 0 }}>
          <XAxis
            dataKey="time"
            tickFormatter={(t) => formatTick(t, interval)}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis orientation="right" width={AXIS_WIDTH} hide domain={[0, "dataMax"]} />
          <Tooltip
            content={<CandleTooltip interval={interval} />}
            isAnimationActive={false}
            cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }}
          />
          <Bar dataKey="volume" isAnimationActive={false}>
            {chartData.map((p, i) => (
              <Cell key={i} fill={p.up ? UP_COLOR : DOWN_COLOR} fillOpacity={0.5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
