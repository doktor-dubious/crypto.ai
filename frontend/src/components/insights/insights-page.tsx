"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Sparkles, ArrowRight, Loader2, User, Bot, MapPin, Check,
} from "lucide-react"
import { toast } from "sonner"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { chatApi, type ChatMessageResponse, type ChatOutletRef, type ChatChartConfig } from "@/lib/api"
import { MarkdownContent } from "@/components/insights/markdown-content"
import { useSession } from "@/lib/auth-client"
import { useCustomer } from "@/components/providers/customer-provider"
import { InsightsChart } from "@/components/insights/insights-chart"
import { OutletDetailModal } from "@/components/insights/outlet-detail-modal"

// ── Message bubble ───────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const t = useTranslations("insights")

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        toast.success(t("copied"))
        setTimeout(() => setCopied(false), 2000)
      })
    } else {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
      setCopied(true)
      toast.success(t("copied"))
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return copied ? (
    <Check className="h-3.5 w-3.5 text-green-500" />
  ) : (
    <AnimateIcon animateOnHover>
      <CopyIcon
        size={14}
        className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
        onClick={handleCopy}
      />
    </AnimateIcon>
  )
}

function MessageBubble({
  msg,
  onOutletClick,
}: {
  msg: ChatMessageResponse
  onOutletClick: (outlet: ChatOutletRef) => void
}) {
  const isUser = msg.role === "user"

  return (
    <div className={`group/msg flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
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
        <div
          className={`inline-block rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-[var(--muted)] text-[var(--foreground)]"
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{msg.content}</div>
          ) : (
            <MarkdownContent>{msg.content}</MarkdownContent>
          )}
        </div>

        {/* Copy button — appears on hover */}
        <div className={`opacity-0 group-hover/msg:opacity-100 transition-opacity ${isUser ? "flex justify-end" : ""}`}>
          <CopyButton text={msg.content} />
        </div>

        {msg.chart && (
          <div className="text-left">
            <InsightsChart config={msg.chart} />
          </div>
        )}

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

// ── Main insights page ───────────────────────────────────────────────────────

export function InsightsPage({ initialSessionId }: { initialSessionId?: string }) {
  const t = useTranslations("insights")
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { data: authSession } = useSession()
  const { activeCustomer } = useCustomer()

  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId ?? null)
  const [message, setMessage] = useState("")
  const autoSubmittedRef = useRef(false)
  const [selectedOutlet, setSelectedOutlet] = useState<ChatOutletRef | null>(null)
  const [outletModalOpen, setOutletModalOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [streamText, setStreamText] = useState("")
  const [streamChart, setStreamChart] = useState<ChatChartConfig | null>(null)
  const [streamOutlets, setStreamOutlets] = useState<ChatOutletRef[] | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  // Update active session when route changes
  useEffect(() => {
    if (initialSessionId && initialSessionId !== activeSessionId) {
      setActiveSessionId(initialSessionId)
    }
  }, [initialSessionId])

  // Fetch active session messages
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["chat-session", activeSessionId],
    queryFn: () => chatApi.getSession(activeSessionId!),
    enabled: !!activeSessionId,
  })

  // Scroll to bottom on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [session?.messages?.length, isStreaming, streamText])

  const submitMessage = useCallback(async (text: string) => {
    if (!text.trim() || !activeCustomer || isStreaming) return

    setMessage("")
    setIsStreaming(true)
    setStreamStatus(null)
    setStreamText("")
    setStreamChart(null)
    setStreamOutlets(null)
    setStreamError(null)

    try {
      await chatApi.sendStream(
        {
          customer_id: activeCustomer.id,
          user_id: authSession?.user?.id,
          session_id: activeSessionId,
          message: text.trim(),
        },
        {
          onStatus: (status) => setStreamStatus(status),
          onText: (text) => {
            setStreamStatus(null)
            setStreamText((prev) => prev + text)
          },
          onChart: (chart) => setStreamChart(chart),
          onOutlets: (outlets) => setStreamOutlets(outlets),
          onDone: (data) => {
            setActiveSessionId(data.session_id)
            queryClient.invalidateQueries({ queryKey: ["chat-session", data.session_id] })
            queryClient.invalidateQueries({ queryKey: ["chat-sessions"] })
            if (!initialSessionId || initialSessionId !== data.session_id) {
              router.replace(`/insights/${data.session_id}`, { scroll: false })
            }
          },
          onError: (detail) => setStreamError(detail),
        },
      )
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Failed to send message")
    } finally {
      setIsStreaming(false)
      setStreamStatus(null)
    }
  }, [activeCustomer, authSession, activeSessionId, isStreaming, initialSessionId, queryClient, router])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submitMessage(message)
  }

  // Auto-submit from dashboard prompt (?q=...)
  useEffect(() => {
    const q = searchParams.get("q")
    if (q && activeCustomer && !autoSubmittedRef.current && !isStreaming) {
      autoSubmittedRef.current = true
      router.replace("/insights", { scroll: false })
      submitMessage(q)
    }
  }, [searchParams, activeCustomer, isStreaming, submitMessage, router])

  const hasActiveSession = !!activeSessionId && !!session

  return (
    <div className="flex flex-1 flex-col min-h-0 -m-6 -mb-0">
      {hasActiveSession ? (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto max-w-3xl space-y-6">
              {session.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  onOutletClick={(outlet) => {
                    setSelectedOutlet(outlet)
                    setOutletModalOpen(true)
                  }}
                />
              ))}

              {/* Streaming response */}
              {isStreaming && (
                <div className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                  <div className="max-w-[80%] space-y-3">
                    {streamText ? (
                      <div className="inline-block rounded-lg bg-[var(--muted)] text-[var(--foreground)] px-4 py-2.5 text-sm leading-relaxed">
                        <MarkdownContent>{streamText}</MarkdownContent>
                        {streamStatus && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {streamStatus}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg bg-[var(--muted)] px-4 py-2.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span className="text-sm text-[var(--muted-foreground)]">
                          {streamStatus ?? t("thinking")}
                        </span>
                      </div>
                    )}
                    {streamChart && (
                      <InsightsChart config={streamChart} />
                    )}
                    {streamOutlets && streamOutlets.length > 0 && (
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)]">
                        {streamOutlets.map((outlet) => (
                          <button
                            key={outlet.outlet_id}
                            onClick={() => { setSelectedOutlet(outlet); setOutletModalOpen(true) }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-[var(--muted)] cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--foreground)]">{outlet.name}</span>
                              {(outlet.city || outlet.state) && (
                                <span className="flex items-center gap-0.5 text-xs text-[var(--muted-foreground)]">
                                  <MapPin className="h-3 w-3" />
                                  {[outlet.city, outlet.state].filter(Boolean).join(", ")}
                                </span>
                              )}
                            </div>
                            {outlet.value != null && (
                              <span className="text-sm font-medium text-[var(--foreground)]">{outlet.value.toLocaleString()}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
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
                  disabled={isStreaming}
                  className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none disabled:opacity-50"
                />
                {isStreaming ? (
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
              {streamError && (
                <p className="mt-1 text-xs text-[var(--destructive)]">
                  {streamError.includes("429") ? t("rateLimitError")
                    : streamError.includes("403") ? t("accessDeniedError")
                    : t("sendError")}
                </p>
              )}
            </form>
          </div>
        </>
      ) : (
        /* Empty state — new conversation */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <div className="text-center">
            <Sparkles className="mx-auto mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
            <h2 className="text-lg font-medium text-[var(--foreground)]">{t("welcomeTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("welcomeSubtitle")}</p>
          </div>
          <form onSubmit={handleSubmit} className="w-full max-w-xl">
            <div className="relative flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm transition-colors focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)]">
              <Sparkles className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("promptPlaceholder")}
                disabled={isStreaming || !activeCustomer}
                className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none disabled:opacity-50"
              />
              {isStreaming ? (
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
            {streamError && (
              <p className="mt-1 text-xs text-[var(--destructive)]">
                {streamError.includes("429") ? t("rateLimitError")
                  : streamError.includes("403") ? t("accessDeniedError")
                  : t("sendError")}
              </p>
            )}
          </form>

          {sessionLoading && (
            <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
          )}
        </div>
      )}

      {/* Outlet detail modal */}
      <OutletDetailModal
        outlet={selectedOutlet}
        open={outletModalOpen}
        onOpenChange={setOutletModalOpen}
      />
    </div>
  )
}
