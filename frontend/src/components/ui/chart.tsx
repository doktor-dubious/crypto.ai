"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"
import { cn } from "@/lib/utils"

// ─── Theme helpers ─────────────────────────────────────────────────────────

export type ChartConfig = Record<
  string,
  { label?: React.ReactNode; color?: string; icon?: React.ComponentType }
>

type ChartContextProps = { config: ChartConfig }
const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const ctx = React.useContext(ChartContext)
  if (!ctx) throw new Error("useChart must be used within ChartContainer")
  return ctx
}

// ─── Container ────────────────────────────────────────────────────────────

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & { config: ChartConfig; children: React.ReactNode }) {
  const uniqueId = React.useId()
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn("flex aspect-video justify-center text-xs", className)}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children as React.ReactElement}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

// ─── CSS variable injection ────────────────────────────────────────────────

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, cfg]) => cfg.color)
  if (!colorConfig.length) return null
  return (
    <style>{`
      [data-chart=${id}] {
        ${colorConfig.map(([key, cfg]) => `--color-${key}: ${cfg.color};`).join("\n")}
      }
    `}</style>
  )
}

// ─── Tooltip ─────────────────────────────────────────────────────────────

const ChartTooltip = RechartsPrimitive.Tooltip

type TooltipPayloadItem = {
  dataKey?: string | number
  name?: string | number
  value?: number | string | null
  color?: string
  payload?: Record<string, unknown>
}

function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  formatter,
  hideLabel = false,
  hideIndicator = false,
  indicator = "dot",
  nameKey,
  labelKey,
  labelFormatter,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  className?: string
  formatter?: (value: number | string | null | undefined, name: string) => React.ReactNode
  hideLabel?: boolean
  hideIndicator?: boolean
  indicator?: "line" | "dot" | "dashed"
  nameKey?: string
  labelKey?: string
  labelFormatter?: (label: string, payload: TooltipPayloadItem[]) => React.ReactNode
}) {
  const { config } = useChart()
  if (!active || !payload?.length) return null

  const resolvedLabel = labelFormatter
    ? labelFormatter(label ?? "", payload)
    : labelKey
      ? (payload[0]?.payload as Record<string, unknown>)?.[labelKey] as string
      : label

  return (
    <div
      className={cn(
        "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
        className
      )}
    >
      {!hideLabel && (
        <div className="font-medium">{resolvedLabel}</div>
      )}
      <div className="grid gap-1.5">
        {payload.map((item, idx) => {
          const key = nameKey ?? String(item.dataKey ?? item.name ?? "value")
          const itemConfig = config[key]
          const indicatorColor = item.color ?? itemConfig?.color

          return (
            <div key={`${String(item.dataKey)}-${idx}`} className="flex w-full flex-wrap items-stretch gap-2">
              {!hideIndicator && (
                <div
                  className={cn("shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)", {
                    "my-0.5 w-1 border-[none]": indicator === "line",
                    "w-2.5 self-center": indicator === "dot",
                    "w-0 border-[1.5px] border-dashed": indicator === "dashed",
                  })}
                  style={{ "--color-bg": indicatorColor, "--color-border": indicatorColor } as React.CSSProperties}
                />
              )}
              <div className={cn("flex flex-1 leading-none", hideIndicator ? "gap-1.5" : "justify-between")}>
                <span className="text-muted-foreground">
                  {itemConfig?.label ?? item.name}
                </span>
                {item.value != null && (
                  <span className="font-mono font-medium tabular-nums text-foreground ml-2">
                    {formatter ? formatter(item.value, String(item.name ?? "")) : String(item.value)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Legend ──────────────────────────────────────────────────────────────

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  payload,
  nameKey,
}: React.ComponentProps<"div"> & {
  payload?: Array<{ value: string; color?: string }>
  nameKey?: string
}) {
  const { config } = useChart()
  if (!payload?.length) return null

  return (
    <div className={cn("flex items-center justify-center gap-4", className)}>
      {payload.map((item) => {
        const key = nameKey ?? item.value
        const itemConfig = config[key]
        return (
          <div key={item.value} className="flex items-center gap-1.5">
            <div
              className="h-2 w-4 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color ?? itemConfig?.color }}
            />
            <span className="text-muted-foreground">{itemConfig?.label ?? item.value}</span>
          </div>
        )
      })}
    </div>
  )
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
}
