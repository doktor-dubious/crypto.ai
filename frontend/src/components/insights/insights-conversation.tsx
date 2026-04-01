"use client"

import { useState, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Sparkles, ArrowRight, Loader2, User, Bot, MapPin } from "lucide-react"
import { chatApi, type ChatMessageResponse, type ChatOutletRef } from "@/lib/api"
import { useCustomer } from "@/components/providers/customer-provider"
import { InsightsChart } from "@/components/insights/insights-chart"
import { OutletDetailModal } from "@/components/insights/outlet-detail-modal"

function MessageBubble({
  msg,
  onOutletClick,
}: {
  msg: ChatMessageResponse
  onOutletClick: (outlet: ChatOutletRef) => void
}) {
  const isUser = msg.role === "user"

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "bg-[var(--muted)] text-[var(--muted-foreground)]"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div className={`max-w-[80%] space-y-3 ${isUser ? "text-right" : ""}`}>
        {/* Text content */}
        <div
          className={`inline-block rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-[var(--muted)] text-[var(--foreground)]"
          }`}
        >
          <div className="whitespace-pre-wrap">{msg.content}</div>
        </div>

        {/* Chart */}
        {msg.chart && (
          <div className="text-left">
            <InsightsChart config={msg.chart} />
          </div>
        )}

        {/* Outlet list */}
        {msg.outlets && msg.outlets.length > 0 && (
          <div className="text-left">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)]">
              {msg.outlets.map((outlet) => (
                <button
                  key={outlet.outlet_id}
                  onClick={() => onOutletClick(outlet)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-[var(--muted)] cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {outlet.name}
                    </span>
                    {(outlet.city || outlet.state) && (
                      <span className="flex items-center gap-0.5 text-xs text-[var(--muted-foreground)]">
                        <MapPin className="h-3 w-3" />
                        {[outlet.city, outlet.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>
                  {outlet.value != null && (
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {outlet.value.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function InsightsConversation({ sessionId }: { sessionId: string }) {
  const t = useTranslations("insights")
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()
  const [message, setMessage] = useState("")
  const [selectedOutlet, setSelectedOutlet] = useState<ChatOutletRef | null>(null)
  const [outletModalOpen, setOutletModalOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data: session, isLoading } = useQuery({
    queryKey: ["chat-session", sessionId],
    queryFn: () => chatApi.getSession(sessionId),
  })

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      chatApi.send({
        customer_id: activeCustomer!.id,
        session_id: sessionId,
        message: msg,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-session", sessionId] })
      setMessage("")
    },
  })

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [session?.messages?.length, sendMutation.isPending])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = message.trim()
    if (!trimmed || !activeCustomer || sendMutation.isPending) return
    sendMutation.mutate(trimmed)
  }

  function handleOutletClick(outlet: ChatOutletRef) {
    setSelectedOutlet(outlet)
    setOutletModalOpen(true)
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[var(--muted-foreground)]">{t("sessionNotFound")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {session.messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onOutletClick={handleOutletClick}
            />
          ))}

          {/* Pending indicator */}
          {sendMutation.isPending && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                <Bot className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-[var(--muted)] px-4 py-2.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-sm text-[var(--muted-foreground)]">{t("thinking")}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Follow-up input */}
      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-4 py-3">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="relative flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 transition-colors focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)]">
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("followUpPlaceholder")}
              disabled={sendMutation.isPending}
              className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none disabled:opacity-50"
            />
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--muted-foreground)]" />
            ) : (
              <button
                type="submit"
                disabled={!message.trim()}
                className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
          {sendMutation.isError && (
            <p className="mt-1 text-xs text-[var(--destructive)]">{t("sendError")}</p>
          )}
        </form>
      </div>

      {/* Outlet detail modal */}
      <OutletDetailModal
        outlet={selectedOutlet}
        open={outletModalOpen}
        onOpenChange={setOutletModalOpen}
      />
    </div>
  )
}
