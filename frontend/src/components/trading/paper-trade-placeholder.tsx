"use client"

import { useTranslations } from "next-intl"
import { Wallet } from "lucide-react"

// Placeholder shown on each strategy's Paper Trade tab until live paper trading
// is built. `strategyKey` is the strategy's `nav.*` label key.
export function PaperTradePlaceholder({ strategyKey }: { strategyKey: string }) {
  const tNav = useTranslations("nav")
  const t = useTranslations("tradingPaper")
  const name = tNav(strategyKey as Parameters<typeof tNav>[0])

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3 text-center px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--muted)] text-[var(--muted-foreground)]">
        <Wallet className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold">{name} · {t("title")}</h2>
      <p className="text-sm text-muted-foreground max-w-md">{t("comingSoon", { strategy: name })}</p>
    </div>
  )
}
