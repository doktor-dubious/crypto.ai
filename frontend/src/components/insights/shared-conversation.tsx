"use client"

import { useQuery } from "@tanstack/react-query"
import { Loader2, User, Bot, MapPin } from "lucide-react"
import { chatApi, type ChatMessageResponse } from "@/lib/api"
import { MarkdownContent } from "@/components/insights/markdown-content"
import { InsightsChart } from "@/components/insights/insights-chart"

function ReadOnlyMessage({ msg }: { msg: ChatMessageResponse }) {
  const isUser = msg.role === "user"

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-[hsl(222,47%,31%)] text-white"
            : "bg-[hsl(220,13%,91%)] text-[hsl(220,9%,46%)]"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div className={`max-w-[80%] space-y-3 ${isUser ? "text-right" : ""}`}>
        <div
          className={`inline-block rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-[hsl(222,47%,31%)] text-white"
              : "bg-[hsl(220,14%,96%)] text-[hsl(224,71%,4%)]"
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{msg.content}</div>
          ) : (
            <MarkdownContent>{msg.content}</MarkdownContent>
          )}
        </div>

        {msg.chart && (
          <div className="text-left">
            <InsightsChart config={msg.chart} />
          </div>
        )}

        {msg.outlets && msg.outlets.length > 0 && (
          <div className="text-left">
            <div className="rounded-lg border border-[hsl(220,13%,91%)] bg-white divide-y divide-[hsl(220,13%,91%)]">
              {msg.outlets.map((outlet) => (
                <div
                  key={outlet.outlet_id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[hsl(224,71%,4%)]">
                      {outlet.name}
                    </span>
                    {(outlet.city || outlet.state) && (
                      <span className="flex items-center gap-0.5 text-xs text-[hsl(220,9%,46%)]">
                        <MapPin className="h-3 w-3" />
                        {[outlet.city, outlet.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>
                  {outlet.value != null && (
                    <div className="text-right">
                      <span className="text-sm font-medium text-[hsl(224,71%,4%)]">
                        {outlet.value.toLocaleString()}
                      </span>
                      {outlet.value_label && (
                        <span className="ml-1 text-xs text-[hsl(220,9%,46%)]">
                          {outlet.value_label}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function SharedConversation({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading, isError } = useQuery({
    queryKey: ["shared-session", sessionId],
    queryFn: () => chatApi.getSession(sessionId),
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(220,9%,46%)]" />
      </div>
    )
  }

  if (isError || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-sm text-[hsl(220,9%,46%)]">Conversation not found.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white light" data-theme="light">
      {/* Header */}
      <header className="border-b border-[hsl(220,13%,91%)] px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2">
            <img src="/gorm.png" alt="Gorm AI" className="h-6 w-6" />
            <span className="text-sm font-semibold text-[hsl(224,71%,4%)]">Gorm AI</span>
          </div>
          <h1 className="mt-1 text-base font-medium text-[hsl(224,71%,4%)]">
            {session.title}
          </h1>
          <p className="text-xs text-[hsl(220,9%,46%)]">
            {new Date(session.created_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </header>

      {/* Messages */}
      <main className="px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {session.messages.map((msg) => (
            <ReadOnlyMessage key={msg.id} msg={msg} />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[hsl(220,13%,91%)] px-6 py-3">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs text-[hsl(220,9%,46%)]">
            Shared from Gorm AI Insights
          </p>
        </div>
      </footer>
    </div>
  )
}
