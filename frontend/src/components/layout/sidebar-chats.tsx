"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import {
  Plus, MoreHorizontal, Pencil, Link2, Star, Trash2,
  MessageCircle, MessageSquare,
} from "lucide-react"
import { toast } from "sonner"
import { chatApi, type ChatSessionResponse } from "@/lib/api"
import { useCustomer } from "@/components/providers/customer-provider"
import { useSidebar } from "@/components/ui/sidebar"
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

const SIDEBAR_CHAT_LIMIT = 5

function ChatItem({
  session,
  isExpanded,
}: {
  session: ChatSessionResponse
  isExpanded: boolean
}) {
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

  function handleRename() {
    setRenameValue(session.title)
    setRenameOpen(true)
  }

  function handleRenameSubmit() {
    if (renameValue.trim()) {
      updateMutation.mutate({ title: renameValue.trim() })
    }
    setRenameOpen(false)
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/share/${session.id}`
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => toast.success(t("linkCopied")),
        () => fallbackCopy(url),
      )
    } else {
      fallbackCopy(url)
    }
  }

  function fallbackCopy(text: string) {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    document.execCommand("copy")
    document.body.removeChild(ta)
    toast.success(t("linkCopied"))
  }

  function handleStar() {
    updateMutation.mutate({ starred: !session.starred })
  }

  if (!isExpanded) {
    return (
      <li
        className="flex items-center justify-center py-1 cursor-pointer"
        onClick={() => router.push(`/insights/${session.id}`)}
      >
        <MessageCircle className="h-4 w-4 text-[var(--sidebar-foreground)]/70" />
      </li>
    )
  }

  return (
    <>
      <li
        className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-[var(--sidebar-accent)] transition-colors cursor-pointer"
        onClick={() => router.push(`/insights/${session.id}`)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {session.starred && (
              <Star className="h-2.5 w-2.5 shrink-0 fill-yellow-500 text-yellow-500" />
            )}
            <span className="text-xs text-[var(--sidebar-foreground)] truncate">
              {session.title || t("untitled")}
            </span>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-[var(--sidebar-foreground)]/60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-40">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleRename() }}>
              <Pencil className="h-3.5 w-3.5" />
              {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleCopyLink() }}>
              <Link2 className="h-3.5 w-3.5" />
              {t("directLink")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStar() }}>
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
      </li>

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

export function SidebarChats() {
  const t = useTranslations("insights")
  const router = useRouter()
  const { activeCustomer } = useCustomer()
  const { state } = useSidebar()
  const isExpanded = state === "expanded"

  const { data: sessions = [] } = useQuery({
    queryKey: ["chat-sessions", activeCustomer?.id],
    queryFn: () => chatApi.listSessions(activeCustomer!.id, { limit: SIDEBAR_CHAT_LIMIT + 1 }),
    enabled: !!activeCustomer,
    staleTime: 30_000,
  })

  const hasMore = sessions.length > SIDEBAR_CHAT_LIMIT
  const visibleSessions = sessions.slice(0, SIDEBAR_CHAT_LIMIT)

  return (
    <div className="space-y-0.5">
      {/* New chat button */}
      {isExpanded ? (
        <button
          onClick={() => router.push("/insights")}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          {t("newConversation")}
        </button>
      ) : (
        <div className="flex justify-center py-1">
          <button
            onClick={() => router.push("/insights")}
            className="rounded-md p-1 hover:bg-[var(--sidebar-accent)] transition-colors cursor-pointer"
            title={t("newConversation")}
          >
            <Plus className="h-4 w-4 text-[var(--sidebar-foreground)]/70" />
          </button>
        </div>
      )}

      {/* Chat list */}
      {visibleSessions.length > 0 && (
        <ul className="space-y-0.5">
          {visibleSessions.map((session) => (
            <ChatItem key={session.id} session={session} isExpanded={isExpanded} />
          ))}
        </ul>
      )}

      {/* All chats link */}
      {hasMore && isExpanded && (
        <button
          onClick={() => router.push("/insights/all")}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--sidebar-foreground)]/60 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)] transition-colors cursor-pointer"
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          {t("allChats")}
        </button>
      )}
    </div>
  )
}
