"use client"

// The small "?" affordance used beside a label whose meaning isn't obvious from
// its name. Shared so the explanation of a statistic lives in one place rather
// than being re-typed next to every table that shows it.

import type { ReactNode } from "react"
import { Info } from "lucide-react"
import {
  Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function InfoIcon({ text, className }: { text: ReactNode; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <UITooltip>
        <TooltipTrigger asChild>
          <Info className={cn("h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0", className)} />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">{text}</TooltipContent>
      </UITooltip>
    </TooltipProvider>
  )
}
