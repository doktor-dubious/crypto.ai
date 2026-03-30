"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  FileText,
  Server,
  Cpu,
  Database,
  Globe,
  Container,
  Bot,
  Scissors,
} from "lucide-react"
import { ViewSwitcher } from "@/components/ui/view-switcher"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { logsApi, type LogEntry } from "@/lib/api"

const LOG_SOURCES = [
  { id: "gorm", icon: <FileText className="h-4 w-4" />, labelKey: "gorm" as const },
  { id: "fastapi", icon: <Server className="h-4 w-4" />, labelKey: "fastapi" as const },
  { id: "finetuning", icon: <Scissors className="h-4 w-4" />, labelKey: "finetuning" as const },
  { id: "celery-worker", icon: <Cpu className="h-4 w-4" />, labelKey: "celeryWorker" as const },
  { id: "redis", icon: <Database className="h-4 w-4" />, labelKey: "redis" as const },
  { id: "database", icon: <Container className="h-4 w-4" />, labelKey: "database" as const },
  { id: "frontend", icon: <Globe className="h-4 w-4" />, labelKey: "frontend" as const },
  { id: "claude", icon: <Bot className="h-4 w-4" />, labelKey: "claude" as const },
]

const PAGE_SIZE = 100

export default function SystemLogsPage() {
  const t = useTranslations("systemLogs")
  const [source, setSource] = useState("gorm")
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [autoRefresh, setAutoRefresh] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 400)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search])

  const handleSourceChange = useCallback((id: string) => {
    setSource(id)
    setPage(1)
  }, [])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["system-logs", source, page, debouncedSearch],
    queryFn: () => logsApi.get({ source, page, page_size: PAGE_SIZE, search: debouncedSearch }),
    refetchInterval: autoRefresh ? 5000 : false,
  })

  const totalPages = data?.total_pages ?? 1
  const totalLines = data?.total_lines ?? 0
  const entries = data?.entries ?? []

  const from = totalLines === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, totalLines)

  const viewOptions = LOG_SOURCES.map((s) => ({
    id: s.id,
    label: t(s.labelKey),
    icon: s.icon,
  }))

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden">
      {/* Top bar: view switcher */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <ViewSwitcher options={viewOptions} value={source} onChange={handleSourceChange} />

        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} />
            {t("autoRefresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            {t("refresh")}
          </Button>
        </div>
      </div>

      {/* Search + pagination controls */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {totalLines > 0
              ? t("showing", { from, to, total: totalLines.toLocaleString() })
              : ""}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-auto bg-[var(--card)] font-mono text-[11px] leading-[1.6]">
        {isLoading && (
          <div className="flex items-center justify-center p-8 text-muted-foreground text-xs">
            Loading...
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center p-8 text-destructive text-xs">
            {t("loadError")}
          </div>
        )}
        {!isLoading && !isError && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1 p-12 text-muted-foreground">
            <FileText className="h-8 w-8 opacity-40" />
            <span className="text-sm font-medium">{t("noLogs")}</span>
            <span className="text-xs">{t("noLogsHint")}</span>
          </div>
        )}
        {!isLoading && !isError && entries.length > 0 && (
          <table className="w-full">
            <tbody>
              {entries.map((entry, i) => {
                const isError = /\bERROR\b/i.test(entry.message)
                const isWarning = !isError && /\bWARN(ING)?\b/i.test(entry.message)
                const colorClass = isError ? "text-red-500" : isWarning ? "text-yellow-500" : ""
                return (
                  <tr
                    key={`${page}-${i}`}
                    className="border-b border-border/30 hover:bg-muted/30 transition-colors"
                  >
                    <td className={`select-none whitespace-nowrap px-3 py-px align-top w-[1%] ${colorClass || "text-muted-foreground/60"}`}>
                      {entry.timestamp}
                    </td>
                    <td className={`whitespace-pre-wrap break-all px-3 py-px ${colorClass || "text-foreground/90"}`}>
                      <HighlightedText text={entry.message} search={debouncedSearch} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function HighlightedText({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>

  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(${escaped})`, "gi")
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-300/40 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}
