"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { MessageSquare, Trash2, Loader2, Sparkles, ArrowRight } from "lucide-react"
import { chatApi } from "@/lib/api"
import { useCustomer } from "@/components/providers/customer-provider"
import { Button } from "@/components/ui/button"

export function InsightsHistory() {
  const t = useTranslations("insights")
  const router = useRouter()
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()
  const [message, setMessage] = useState("")

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["chat-sessions", activeCustomer?.id],
    queryFn: () => chatApi.listSessions(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

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

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => chatApi.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] })
    },
  })

  function handleNewQuestion(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = message.trim()
    if (!trimmed || !activeCustomer || sendMutation.isPending) return
    sendMutation.mutate(trimmed)
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {/* New question input */}
      <form onSubmit={handleNewQuestion}>
        <div className="relative flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm transition-colors focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)]">
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          <input
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
      </form>

      {/* Session list */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : !sessions?.length ? (
        <div className="py-12 text-center">
          <MessageSquare className="mx-auto mb-3 h-8 w-8 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">{t("noSessions")}</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card)]">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="group flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--muted)] cursor-pointer"
              onClick={() => router.push(`/insights/${session.id}`)}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {session.title || t("untitled")}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {formatDistanceToNow(new Date(session.updated_at), { addSuffix: true })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteMutation.mutate(session.id)
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
