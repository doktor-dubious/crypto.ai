"use client"

import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts"
import type { ChatChartConfig } from "@/lib/api"

const DEFAULT_COLORS = [
  "hsl(217 91% 60%)",
  "hsl(0 72% 51%)",
  "hsl(38 92% 50%)",
  "hsl(142 71% 45%)",
  "hsl(262 83% 58%)",
  "hsl(330 81% 60%)",
]

export function InsightsChart({ config }: { config: ChatChartConfig }) {
  const { type, title, x_key, series, data } = config

  const chartSeries = series.map((s, i) => ({
    ...s,
    color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
  }))

  return (
    <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      {title && (
        <h4 className="mb-3 text-sm font-medium text-[var(--foreground)]">{title}</h4>
      )}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === "bar" ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey={x_key} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chartSeries.map((s) => (
                <Bar key={s.data_key} dataKey={s.data_key} name={s.name} fill={s.color} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey={x_key} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chartSeries.map((s) => (
                <Line
                  key={s.data_key}
                  type="monotone"
                  dataKey={s.data_key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
