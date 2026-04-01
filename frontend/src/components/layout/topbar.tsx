"use client"

import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Bell, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LockIcon } from "@/components/ui/animated-icons/lock"
import { LockOpenIcon } from "@/components/ui/animated-icons/lock-open"
import { useLock } from "@/components/providers/lock-provider"

const ROUTE_TITLE_MAP: Record<string, string> = {
  "/": "home",
  "/customers": "customers",
  "/customers/new": "customersNew",
  "/outlets": "outletsList",
  "/sales": "sales",
  "/sales/analyse": "salesAnalyse",
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
  "/simulations/filter": "simulationsFilter",
  "/simulations/finetune-new": "aiModelsFinetuneAnalysis",
  "/simulations/finetune-completed": "aiModelsFinetuneCompleted",
  "/pads": "padsFilters",
  "/pads/predefined": "predefinedPads",
  "/financials/date-override": "financialsDateOverride",
  "/financials/price-history": "financialsPriceHistory",
  "/financials/bulk-update": "financialsBulkUpdate",
  "/outlet-groups": "outletGroups",
  "/prediction-adjustments": "predictionAdjustments",
  "/statistics/sales": "statisticsSales",
  "/statistics/sold-out": "statisticsSoldOut",
  "/statistics/outlets": "statisticsOutlets",
  "/statistics/profit": "statisticsProfit",
  "/import": "importImport",
  "/import/templates": "importTemplates",
  "/import/log": "importLog",
  "/export": "exportExport",
  "/export/templates": "exportTemplates",
  "/export/log": "exportLog",
  "/ai-models": "aiModelsModels",
  "/ai-models/finetune": "aiModelsFinetuneNew",
  "/ai-models/finetune/completed": "aiModelsFinetuneRuns",
  "/configuration/profile": "configProfile",
  "/configuration": "configSettings",
  "/configuration/exploration/new": "configExplorationNew",
  "/configuration/exploration": "configExplorationCompleted",
  "/insights": "insightsHistory",
  "/insights/all": "insightsAllChats",
  "/system/logs": "systemLogs",
  "/system/workers": "systemWorkers",
  "/system/docker": "systemDocker",
}

export function Topbar() {
  const pathname = usePathname()
  const tNav = useTranslations("nav")
  const tTopbar = useTranslations("topbar")
  const { isLocked, toggleLock } = useLock()

  let titleKey = ROUTE_TITLE_MAP[pathname]
  if (!titleKey && pathname.startsWith("/insights/")) titleKey = "insightsConversation"
  titleKey ??= "home"
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
          aria-label={tTopbar("lock")}
          className="h-8 w-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          asChild
        >
          <div onClick={toggleLock}>
            {isLocked ? <LockIcon size={16} /> : <LockOpenIcon size={16} />}
          </div>
        </Button>
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
