"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useMutation } from "@tanstack/react-query"
import { Sparkles, ArrowRight, Loader2 } from "lucide-react"
import { chatApi } from "@/lib/api"
import { useCustomer } from "@/components/providers/customer-provider"

export function InsightsPrompt() {
  const t = useTranslations("insights")
  const router = useRouter()
  const { activeCustomer } = useCustomer()
  const [message, setMessage] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      chatApi.send({
        customer_id: activeCustomer!.id,
        message: msg,
      }),
    onSuccess: (data) => {
      router.push(`/insights/${data.session_id}`)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = message.trim()
    if (!trimmed || !activeCustomer || sendMutation.isPending) return
    sendMutation.mutate(trimmed)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm transition-colors focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)]">
        <Sparkles className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("promptPlaceholder")}
          disabled={sendMutation.isPending || !activeCustomer}
          className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none disabled:opacity-50"
        />
        {sendMutation.isPending ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--muted-foreground)]" />
        ) : (
          <button
            type="submit"
            disabled={!message.trim() || !activeCustomer}
            className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
      {sendMutation.isError && (
        <p className="mt-1 text-xs text-[var(--destructive)]">
          {t("sendError")}
        </p>
      )}
    </form>
  )
}
