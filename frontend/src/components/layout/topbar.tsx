"use client"

import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Bell, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"

const ROUTE_TITLE_MAP: Record<string, string> = {
  "/": "home",
  "/customers": "customers",
  "/outlets": "outletsList",
  "/sales": "sales",
  "/predictions": "predictions",
  "/predictions/new": "predictionsNew",
  "/predictions/strategies": "predictionsStrategies",
  "/predictions/completed": "predictionsCompleted",
  "/predictions/configuration": "predictionsConfiguration",
  "/predictions/analytics": "predictionsAnalytics",
  "/simulations": "simulations",
  "/simulations/new": "simulationsNew",
  "/simulations/strategies": "simulationsStrategies",
  "/simulations/completed": "simulationsCompleted",
  "/pads": "padsFilters",
  "/pads/predefined": "predefinedPads",
  "/financials/date-override": "financialsDateOverride",
  "/financials/bulk-update": "financialsBulkUpdate",
  "/outlet-groups": "outletGroups",
  "/draw-adjustments": "drawAdjustments",
  "/statistics/sales": "statisticsSales",
  "/statistics/sold-out": "statisticsSoldOut",
  "/statistics/outlets": "statisticsOutlets",
  "/statistics/profit": "statisticsProfit",
  "/configuration": "configuration",
}

export function Topbar() {
  const pathname = usePathname()
  const tNav = useTranslations("nav")
  const tTopbar = useTranslations("topbar")

  const titleKey = ROUTE_TITLE_MAP[pathname] ?? "home"
  const title = tNav(titleKey as Parameters<typeof tNav>[0])

  return (
    <header
      className="flex items-center justify-between bg-[var(--background)] px-4"
      style={{ height: "var(--topbar-height, 3.5rem)" }}
    >
      <h1 className="text-sm font-semibold text-[var(--foreground)]">{title}</h1>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={tTopbar("notifications")}
          className="h-8 w-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <Bell className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tTopbar("settings")}
          className="h-8 w-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
