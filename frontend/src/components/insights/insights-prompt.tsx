"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Sparkles, ArrowRight } from "lucide-react"
import { useCustomer } from "@/components/providers/customer-provider"

export function InsightsPrompt() {
  const t = useTranslations("insights")
  const router = useRouter()
  const { activeCustomer } = useCustomer()
  const [message, setMessage] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = message.trim()
    if (!trimmed || !activeCustomer) return
    // Navigate to insights page with the question as a query param
    router.push(`/insights?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm transition-colors focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)]">
        <Sparkles className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("promptPlaceholder")}
          disabled={!activeCustomer}
          className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!message.trim() || !activeCustomer}
          className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  )
}
