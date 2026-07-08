"use client"

// Detail pane for the Live Data Ingester, shown when its row is selected in the
// workers table. Mirrors WorkerDetailPane's tab layout, but with ingester-specific
// fields (no health/models/gpu) and stats (coins updated, bars, connections …).

import { useEffect, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Play, Square, RotateCw } from "lucide-react"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { liveIngestApi } from "@/lib/api"
import { WorkerStatusBadge, formatUptime } from "./worker-ui"

export const LIVE_INGEST_WORKER_NAME = "Live Data Ingester (Binance)"
const COMPOSE_SERVICE = "live-ingest"
const TAB_STORAGE_KEY = "crypto:workers:activeTab"

function loadActiveTab(): string {
  if (typeof window === "undefined") return "tab1"
  try { return localStorage.getItem(TAB_STORAGE_KEY) || "tab1" } catch { return "tab1" }
}

function timeAgo(iso: string | null | undefined, none: string): string {
  if (!iso) return none
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 0) return none
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-[var(--border)]/50 last:border-0">
      <span className="text-xs font-medium text-[var(--muted-foreground)] shrink-0">{label}</span>
      <span className="text-sm text-right break-all">{children}</span>
    </div>
  )
}

export function LiveIngestDetailPane() {
  const t = useTranslations("workersPage")
  const tl = useTranslations("liveIngest")
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<string>(loadActiveTab)
  const [maximized, setMaximized] = useState(false)
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const { data: status } = useQuery({
    queryKey: ["liveIngestStatus"],
    queryFn: () => liveIngestApi.status(),
    refetchInterval: 5000,
  })

  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, activeTab) } catch { /* ignore */ }
  }, [activeTab])

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, status, maximized])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["liveIngestStatus"] })
    queryClient.invalidateQueries({ queryKey: ["workers"] })
  }

  const actionMutation = useMutation({
    mutationFn: (action: "start" | "stop" | "restart") => liveIngestApi[action](),
    onSuccess: (res) => {
      if (res.status === "error") toast.error(res.message)
      else toast.success(res.message)
      invalidate()
    },
    onError: (e) => toast.error(String(e)),
  })

  const modeMutation = useMutation({
    mutationFn: (mode: "ws" | "poll") => liveIngestApi.setMode(mode),
    onSuccess: (res) => {
      if (res.status === "error") toast.error(res.message)
      else toast.success(res.message)
      invalidate()
    },
    onError: (e) => toast.error(String(e)),
  })

  if (!status) {
    return (
      <div className="flex-1 flex items-center justify-center border-t text-sm text-[var(--muted-foreground)]">
        {tl("loading")}
      </div>
    )
  }

  const running = status.container_status === "running"
  const absent = status.container_status === "absent"
  const busy = actionMutation.isPending
  const badgeStatus = running ? "running" : "stopped"

  return (
    <div className={cn(
      "flex-1 flex flex-col min-h-0 overflow-hidden border-t",
      maximized && "absolute inset-0 z-20 bg-background",
    )}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
        <div className="relative w-full">
          <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabStatistics")}</TabsTrigger>
            <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabActions")}</TabsTrigger>
            <div
              className="ml-auto flex items-center pr-2 pl-3 mb-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMaximized((v) => !v)}
              aria-label={maximized ? "Minimize" : "Maximize"}
            >
              {maximized ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
            </div>
          </TabsList>
          <div
            className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
            style={{ left: indicator.left, width: indicator.width }}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Details ── */}
          <TabsContent value="tab1" className="space-y-1 max-w-2xl mt-6 px-4">
            <div className="pb-3 mb-2 border-b border-[var(--border)]/50">
              <p className="font-medium">{LIVE_INGEST_WORKER_NAME}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{tl("subtitle")}</p>
            </div>
            <InfoRow label={t("colStatus")}>
              <WorkerStatusBadge status={badgeStatus} label={t(`status_${badgeStatus}`)} spin={status.streaming} />
            </InfoRow>
            <InfoRow label={tl("mode")}>
              <span className="inline-flex rounded-md border overflow-hidden">
                {(["ws", "poll"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={modeMutation.isPending || status.mode === m}
                    onClick={() => modeMutation.mutate(m)}
                    className={cn(
                      "px-2.5 py-1 text-xs uppercase cursor-pointer transition-colors disabled:cursor-default",
                      status.mode === m
                        ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-medium"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]/50",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </span>
            </InfoRow>
            <InfoRow label={t("fieldService")}>
              <span className="font-mono text-xs">{COMPOSE_SERVICE}</span>
            </InfoRow>
            <InfoRow label={t("fieldContainer")}>
              {absent ? (
                <span className="text-xs text-[var(--muted-foreground)]">{status.message}</span>
              ) : (
                <span className="font-mono text-xs">{status.container_name ?? "—"}</span>
              )}
            </InfoRow>
          </TabsContent>

          {/* ── Statistics ── */}
          <TabsContent value="tab2" className="space-y-1 max-w-2xl mt-6 px-4">
            {!status.streaming ? (
              <p className="text-sm text-[var(--muted-foreground)] py-6">{tl("notStreaming")}</p>
            ) : (
              <>
                <InfoRow label={tl("uptime")}>{formatUptime(status.uptime_s)}</InfoRow>
                <InfoRow label={tl("mode")}><span className="uppercase">{status.mode ?? "—"}</span></InfoRow>
                <InfoRow label={tl("coinsUpdated")}>{status.coins?.toLocaleString() ?? "—"}</InfoRow>
                <InfoRow label={tl("streams")}>{status.streams?.toLocaleString() ?? "—"}</InfoRow>
                <InfoRow label={tl("connections")}>
                  {status.connections_total ? `${status.connections_up ?? 0}/${status.connections_total}` : "—"}
                </InfoRow>
                <InfoRow label={tl("barsSession")}>{status.bars_session?.toLocaleString() ?? "—"}</InfoRow>
                <InfoRow label={tl("lastBar")}>{timeAgo(status.last_bar_at, tl("never"))}</InfoRow>
                {status.per_interval.length > 0 && (
                  <InfoRow label={tl("perInterval")}>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {status.per_interval.map((pi) => (
                        <span
                          key={pi.interval}
                          className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs"
                          title={timeAgo(pi.last_bar_at, tl("never"))}
                        >
                          <span className="font-mono font-medium">{pi.interval}</span>
                          <span className="text-[var(--muted-foreground)]">{pi.bars.toLocaleString()}</span>
                        </span>
                      ))}
                    </span>
                  </InfoRow>
                )}
                {status.last_error && (
                  <InfoRow label={tl("lastError")}>
                    <span className="text-xs text-amber-500">
                      {timeAgo(status.last_error_at, "")} · {status.last_error}
                    </span>
                  </InfoRow>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Actions ── */}
          <TabsContent value="tab3" className="space-y-4 max-w-2xl mt-6 px-4">
            {/* Lifecycle controls — same style as the worker pane: a section with
                text on the left and the buttons stacked on the right. */}
            <div className="rounded-md border p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{tl("controls")}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{tl("controlsDescription")}</p>
                {absent && (
                  <p className="text-xs text-[var(--muted-foreground)] italic pt-1">{status.message}</p>
                )}
              </div>
              <div className="flex flex-col items-stretch gap-2 shrink-0">
                {running ? (
                  <>
                    <Button variant="secondary" size="sm" className="cursor-pointer" onClick={() => actionMutation.mutate("restart")} disabled={busy}>
                      <RotateCw className="h-3.5 w-3.5 mr-1.5" />{tl("restart")}
                    </Button>
                    <Button variant="secondary" size="sm" className="cursor-pointer" onClick={() => actionMutation.mutate("stop")} disabled={busy}>
                      <Square className="h-3.5 w-3.5 mr-1.5" />{tl("stop")}
                    </Button>
                  </>
                ) : (
                  <Button variant="default" size="sm" className="cursor-pointer" onClick={() => actionMutation.mutate("start")} disabled={busy}>
                    <Play className="h-3.5 w-3.5 mr-1.5" />{tl("start")}
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
