"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import {
  MoreHorizontal, Pencil, Link2, Star, Trash2, Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { chatApi, type ChatSessionResponse } from "@/lib/api"
import { useCustomer } from "@/components/providers/customer-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

function ChatRow({ session }: { session: ChatSessionResponse }) {
  const t = useTranslations("insights")
  const router = useRouter()
  const queryClient = useQueryClient()
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")

  const updateMutation = useMutation({
    mutationFn: (data: { title?: string; starred?: boolean }) =>
      chatApi.updateSession(session.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => chatApi.deleteSession(session.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] })
    },
  })

  function handleRenameSubmit() {
    if (renameValue.trim()) {
      updateMutation.mutate({ title: renameValue.trim() })
    }
    setRenameOpen(false)
  }

  return (
    <>
      <div
        className="group flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--muted)] cursor-pointer"
        onClick={() => router.push(`/insights/${session.id}`)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {session.starred && (
              <Star className="h-3 w-3 shrink-0 fill-yellow-500 text-yellow-500" />
            )}
            <p className="truncate text-sm font-medium text-[var(--foreground)]">
              {session.title || t("untitled")}
            </p>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {formatDistanceToNow(new Date(session.updated_at), { addSuffix: true })}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4 text-[var(--muted-foreground)]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="left" align="start" className="w-40">
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation()
              setRenameValue(session.title)
              setRenameOpen(true)
            }}>
              <Pencil className="h-3.5 w-3.5" />
              {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation()
              const url = `${window.location.origin}/share/${session.id}`
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(url).then(
                  () => toast.success(t("linkCopied")),
                  () => { /* fallback below */ },
                )
              } else {
                const ta = document.createElement("textarea")
                ta.value = url
                ta.style.position = "fixed"
                ta.style.opacity = "0"
                document.body.appendChild(ta)
                ta.select()
                document.execCommand("copy")
                document.body.removeChild(ta)
                toast.success(t("linkCopied"))
              }
            }}>
              <Link2 className="h-3.5 w-3.5" />
              {t("directLink")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation()
              updateMutation.mutate({ starred: !session.starred })
            }}>
              <Star className={`h-3.5 w-3.5 ${session.starred ? "fill-yellow-500 text-yellow-500" : ""}`} />
              {t("star")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[var(--destructive)] focus:text-[var(--destructive)]"
              onClick={(e) => { e.stopPropagation(); deleteMutation.mutate() }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{t("rename")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit() }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(false)}>
              {t("close")}
            </Button>
            <Button size="sm" onClick={handleRenameSubmit}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function InsightsAllChats() {
  const t = useTranslations("insights")
  const { activeCustomer } = useCustomer()

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["chat-sessions", activeCustomer?.id],
    queryFn: () => chatApi.listSessions(activeCustomer!.id, { limit: 200 }),
    enabled: !!activeCustomer,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {!sessions.length ? (
        <div className="py-12 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">{t("noSessions")}</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card)]">
          {sessions.map((session) => (
            <ChatRow key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  )
}
