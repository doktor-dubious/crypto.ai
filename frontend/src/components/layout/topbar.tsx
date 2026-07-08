"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Bell, Info, LayoutTemplate, Settings } from "lucide-react"
import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger,
} from "@/components/ui/drawer"
import { getPageInfo } from "@/components/layout/page-info"
import { Button } from "@/components/ui/button"
import { LockIcon } from "@/components/ui/animated-icons/lock"
import { LockOpenIcon } from "@/components/ui/animated-icons/lock-open"
import { useLock } from "@/components/providers/lock-provider"
import { useTradingTemplate } from "@/components/trading/template-context"
import { TemplateModal } from "@/components/trading/template-modal"

const ROUTE_TITLE_MAP: Record<string, string> = {
  "/": "home",
  "/coins": "coins",
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
  "/simulations/batch": "simulationsBatch",
  "/simulations/strategies": "simulationsStrategies",
  "/simulations/completed": "simulationsCompleted",
  "/simulations/filter": "simulationsFilter",
  "/simulations/finetune-new": "aiModelsFinetuneAnalysis",
  "/simulations/finetune-completed": "aiModelsFinetuneCompleted",
  "/trading/paper": "tradingPaperTrade",
  "/trading/strategies/price-direction": "tradingPriceDirection",
  "/trading/strategies/trend-swings": "tradingTrendSwings",
  "/trading/strategies/scalping/order-book": "tradingScalpOrderBook",
  "/trading/strategies/scalping/range": "tradingScalpRange",
  "/trading/strategies/scalping/momentum": "tradingScalpMomentum",
  "/trading/strategies/scalping/indicator": "tradingScalpIndicator",
  "/trading/strategies/scalping/streak-reversion": "tradingScalpStreak",
  "/trading/strategies/scalping/sweep": "tradingScalpSweep",
  "/trading/strategies/scalping/taker-flow": "tradingScalpTakerFlow",
  "/pads": "padsFilters",
  "/pads/predefined": "predefinedPads",
  "/financials/date-override": "financialsDateOverride",
  "/financials/price-history": "financialsPriceHistory",
  "/financials/pricing-analytics": "financialsPricingAnalytics",
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
  "/ai-models/orchestration": "aiModelsOrchestrationGroups",
  "/ai-models/orchestration/new": "aiModelsOrchestrationNew",
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
  const pageInfo = getPageInfo(pathname)
  // A trading strategy explorer registers this bridge while mounted; the template
  // icon appears only then (i.e. on the trading analytics pages).
  const { bridge } = useTradingTemplate()
  const [templateOpen, setTemplateOpen] = useState(false)

  let titleKey = ROUTE_TITLE_MAP[pathname]
  // Trading strategy sub-pages: "<base>/paper" | "<base>/analytics" → the base
  // strategy title with a " · Paper Trade" / " · Analytics" suffix.
  let suffixKey: string | null = null
  if (!titleKey) {
    const m = pathname.match(/^(.*)\/(paper|analytics)$/)
    if (m && ROUTE_TITLE_MAP[m[1]]) {
      titleKey = ROUTE_TITLE_MAP[m[1]]
      suffixKey = m[2] === "paper" ? "tradingPaperTrade" : "tradingAnalytics"
    }
  }
  if (!titleKey && pathname.startsWith("/insights/")) titleKey = "insightsConversation"
  titleKey ??= "home"
  let title = tNav(titleKey as Parameters<typeof tNav>[0])
  if (suffixKey) title = `${title} · ${tNav(suffixKey as Parameters<typeof tNav>[0])}`

  return (
    <header
      className="flex items-center justify-between bg-[var(--background)] px-4"
      style={{ height: "var(--topbar-height, 3.5rem)" }}
    >
      <h1 className="text-sm font-semibold text-[var(--foreground)]">{title}</h1>

      <div className="flex items-center gap-1">
        {/* Page information — icon appears only on routes registered in PAGE_INFO */}
        {pageInfo && (
          <Drawer>
            <DrawerTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={tTopbar("pageInfo")}
                title={tTopbar("pageInfo")}
                className="h-8 w-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              >
                <Info className="h-4 w-4" />
              </Button>
            </DrawerTrigger>
            {/* Width = the content column (comfortable prose measure), not a
                fixed viewport fraction — no dead space beside the text. */}
            <DrawerContent className="w-full max-w-2xl">
              <DrawerHeader>
                <DrawerTitle>{pageInfo.title}</DrawerTitle>
                <DrawerDescription>{pageInfo.description}</DrawerDescription>
              </DrawerHeader>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {pageInfo.content}
              </div>
            </DrawerContent>
          </Drawer>
        )}
        {/* Trading strategy templates — only on the analytics pages (a strategy
            explorer registers the bridge while mounted). */}
        {bridge && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={tTopbar("templates")}
            title={tTopbar("templates")}
            onClick={() => setTemplateOpen(true)}
            className="h-8 w-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
          >
            <LayoutTemplate className="h-4 w-4" />
          </Button>
        )}
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
      {bridge && (
        <TemplateModal bridge={bridge} open={templateOpen} onOpenChange={setTemplateOpen} />
      )}
    </header>
  )
}
