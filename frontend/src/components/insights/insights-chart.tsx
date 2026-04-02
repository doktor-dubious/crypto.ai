"use client"

import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, RadialBarChart, RadialBar,
  CartesianGrid, XAxis, YAxis, Label,
} from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { ChatChartConfig } from "@/lib/api"

const DEFAULT_COLORS = [
  "hsl(217 91% 60%)",
  "hsl(0 72% 51%)",
  "hsl(38 92% 50%)",
  "hsl(142 71% 45%)",
  "hsl(262 83% 58%)",
  "hsl(330 81% 60%)",
  "hsl(190 80% 50%)",
  "hsl(30 90% 55%)",
]

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function buildChartConfig(config: ChatChartConfig): ChartConfig {
  const cc: ChartConfig = {}
  config.series.forEach((s, i) => {
    cc[sanitizeKey(s.data_key)] = {
      label: s.name,
      color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    }
  })
  // For pie charts, map each data item name as a config key
  if (config.type === "pie" && config.data.length > 0) {
    const nameKey = config.x_key || Object.keys(config.data[0]).find(
      k => typeof config.data[0][k] === "string"
    ) || "name"
    config.data.forEach((d, i) => {
      const name = String(d[nameKey] ?? `Item ${i}`)
      cc[sanitizeKey(name)] = {
        label: name,
        color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      }
    })
  }
  return cc
}

export function InsightsChart({ config }: { config: ChatChartConfig }) {
  const { type, title, x_key, series, data } = config
  const chartConfig = buildChartConfig(config)

  const resolvedSeries = series.map((s, i) => ({
    ...s,
    color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
  }))

  // Pie chart helpers
  const pieNameKey = x_key || Object.keys(data[0] ?? {}).find(
    k => typeof data[0]?.[k] === "string"
  ) || "name"
  const pieDataKey = resolvedSeries[0]?.data_key || Object.keys(data[0] ?? {}).find(
    k => typeof data[0]?.[k] === "number"
  ) || "value"

  // Add fill color to pie data using CSS variable names for Shadcn theming
  const pieData = data.map((d, i) => {
    const name = String(d[pieNameKey] ?? `Item ${i}`)
    return {
      ...d,
      fill: `var(--color-${sanitizeKey(name)})`,
    }
  })

  const formatNumber = (value: number | string | null | undefined) => {
    if (value == null) return ""
    const num = typeof value === "string" ? parseFloat(value) : value
    if (isNaN(num)) return String(value)
    return num.toLocaleString()
  }

  return (
    <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      {title && (
        <h4 className="mb-3 text-sm font-medium text-[var(--foreground)]">{title}</h4>
      )}
      <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto">
        {type === "pie" ? (
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey={pieNameKey} formatter={formatNumber} />} />
            <Pie
              data={pieData}
              dataKey={pieDataKey}
              nameKey={pieNameKey}
              innerRadius="40%"
              outerRadius="70%"
              strokeWidth={2}
              stroke="var(--background)"
            />
            <ChartLegend content={<ChartLegendContent nameKey={pieNameKey} />} />
          </PieChart>
        ) : type === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis dataKey={x_key} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
            <ChartTooltip content={<ChartTooltipContent formatter={formatNumber} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {resolvedSeries.map((s) => (
              <Area
                key={s.data_key}
                type="monotone"
                dataKey={s.data_key}
                stroke={`var(--color-${s.data_key})`}
                fill={`var(--color-${s.data_key})`}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        ) : type === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis dataKey={x_key} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
            <ChartTooltip content={<ChartTooltipContent formatter={formatNumber} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {resolvedSeries.map((s) => (
              <Bar
                key={s.data_key}
                dataKey={s.data_key}
                fill={`var(--color-${s.data_key})`}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        ) : type === "radar" ? (
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="var(--border)" opacity={0.5} />
            <PolarAngleAxis
              dataKey={x_key}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <PolarRadiusAxis tick={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent formatter={formatNumber} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {resolvedSeries.map((s, i) => (
              <Radar
                key={s.data_key}
                dataKey={s.data_key}
                stroke={`var(--color-${s.data_key})`}
                fill={`var(--color-${s.data_key})`}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
          </RadarChart>
        ) : type === "radial" ? (
          <RadialBarChart
            data={data}
            innerRadius={30}
            outerRadius={100}
            startAngle={180}
            endAngle={0}
          >
            <ChartTooltip content={<ChartTooltipContent hideLabel formatter={formatNumber} />} />
            <RadialBar
              dataKey={resolvedSeries[0]?.data_key ?? "value"}
              background
            >
              {data.map((_, i) => (
                <Cell key={i} fill={DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
              ))}
            </RadialBar>
            <ChartLegend content={<ChartLegendContent nameKey={x_key || "name"} />} />
          </RadialBarChart>
        ) : (
          /* Default: line chart */
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis dataKey={x_key} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
            <ChartTooltip content={<ChartTooltipContent formatter={formatNumber} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {resolvedSeries.map((s) => (
              <Line
                key={s.data_key}
                type="monotone"
                dataKey={s.data_key}
                stroke={`var(--color-${s.data_key})`}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    </div>
  )
}
