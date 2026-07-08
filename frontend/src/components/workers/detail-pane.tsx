"use client"

import { useState, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { Trash2, Play, Square, RotateCw, Radio } from "lucide-react"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { workersApi } from "@/lib/api"
import { WorkerStatusBadge, HealthDot, formatUptime } from "./worker-ui"

type ControlAction = "start" | "stop" | "restart"

// Persist the selected tab globally so it survives navigation and switching
// between workers in the master table (the pane is remounted per worker).
const TAB_STORAGE_KEY = "crypto:workers:activeTab"

function loadActiveTab(): string {
  if (typeof window === "undefined") return "tab1"
  try { return localStorage.getItem(TAB_STORAGE_KEY) || "tab1" } catch { return "tab1" }
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-[var(--border)]/50 last:border-0">
      <span className="text-xs font-medium text-[var(--muted-foreground)] shrink-0">{label}</span>
      <span className="text-sm text-right break-all">{children}</span>
    </div>
  )
}

export function WorkerDetailPane({ name, onDeleted }: { name: string; onDeleted: () => void }) {
  const t = useTranslations("workersPage")
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<string>(loadActiveTab)
  const [maximized, setMaximized] = useState(false)
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [pingResult, setPingResult] = useState<string | null>(null)

  const { data: worker } = useQuery({
    queryKey: ["worker", name],
    queryFn: () => workersApi.get(name),
    refetchInterval: 5000,
  })

  // ── Persist selected tab ──
  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, activeTab) } catch { /* ignore */ }
  }, [activeTab])

  // ── Tab indicator ──
  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, worker, maximized])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["workers"] })
    queryClient.invalidateQueries({ queryKey: ["worker", name] })
  }

  const actionMutation = useMutation({
    mutationFn: (action: ControlAction) => workersApi[action](name),
    onSuccess: (res) => {
      if (res.status === "error") toast.error(res.message)
      else toast.success(res.message)
      invalidate()
    },
    onError: (e) => toast.error(String(e)),
  })

  const pingMutation = useMutation({
    mutationFn: () => workersApi.ping(name),
    onSuccess: (res) => {
      const msg = res.alive ? t("pingAlive", { source: res.source ?? "" }) : t("pingDead")
      setPingResult(msg)
      res.alive ? toast.success(msg) : toast.error(msg)
    },
    onError: (e) => toast.error(String(e)),
  })

  const removeMutation = useMutation({
    mutationFn: () => workersApi.remove(name),
    onSuccess: (res) => {
      if (res.status === "error") { toast.error(res.message); return }
      toast.success(res.message)
      queryClient.invalidateQueries({ queryKey: ["workers"] })
      setDeleteOpen(false)
      onDeleted()
    },
    onError: (e) => toast.error(String(e)),
  })

  if (!worker) {
    return (
      <div className="flex-1 flex items-center justify-center border-t text-sm text-[var(--muted-foreground)]">
        {t("loading")}
      </div>
    )
  }

  const running = worker.status === "running"
  const stopped = worker.status === "stopped"
  const busy = actionMutation.isPending || removeMutation.isPending
  const st = worker.stats

  return (
    <>
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
              <InfoRow label={t("fieldName")}><span className="font-medium">{worker.name}</span></InfoRow>
              <InfoRow label={t("colStatus")}>
                <WorkerStatusBadge status={worker.status} label={t(`status_${worker.status}`)} spin={worker.status === "running" && st.jobs_running > 0} />
              </InfoRow>
              <InfoRow label={t("colHealth")}>
                <HealthDot health={worker.health} label={worker.health ? t(`health_${worker.health}`) : ""} />
              </InfoRow>
              <InfoRow label={t("fieldType")}>
                {worker.is_remote ? t("typeRemote") : worker.status === "potential" ? t("typePotential") : t("typeLocal")}
              </InfoRow>
              <InfoRow label={t("colModels")}>
                <span className="flex flex-wrap gap-1 justify-end">
                  {worker.models.length
                    ? worker.models.map((m) => <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>)
                    : "—"}
                </span>
              </InfoRow>
              <InfoRow label={t("fieldGpu")}>
                {worker.gpu_name
                  ? `${worker.gpu_name}${worker.gpu_vram_total_mb ? ` · ${Math.round(worker.gpu_vram_total_mb / 1024)} GB` : ""}${worker.gpu_count && worker.gpu_count > 1 ? ` ×${worker.gpu_count}` : ""}`
                  : t("noGpu")}
              </InfoRow>
              <InfoRow label={t("fieldService")}>{worker.service ?? "—"}</InfoRow>
              <InfoRow label={t("fieldContainer")}>
                <span className="font-mono text-xs">{worker.container_name ?? "—"}</span>
              </InfoRow>
            </TabsContent>

            {/* ── Statistics ── */}
            <TabsContent value="tab2" className="space-y-1 max-w-2xl mt-6 px-4">
              <InfoRow label={t("statUptime")}>{formatUptime(worker.uptime_s)}</InfoRow>
              <InfoRow label={t("statJobsInstance")}>
                {worker.status === "running" ? st.jobs_instance : "—"}
              </InfoRow>
              <InfoRow label={t("statJobsTotal")}>{st.jobs_total}</InfoRow>
              <InfoRow label={t("statJobsRunning")}>{st.jobs_running}</InfoRow>
              <InfoRow label={t("statJobsSuccess")}><span className="text-green-600">{st.jobs_success}</span></InfoRow>
              <InfoRow label={t("statJobsFailure")}><span className={st.jobs_failure > 0 ? "text-red-600" : ""}>{st.jobs_failure}</span></InfoRow>
              <InfoRow label={t("statLastJob")}>
                {st.last_job_at ? format(new Date(st.last_job_at), "MMM dd, yyyy HH:mm") : "—"}
              </InfoRow>
              <InfoRow label={t("statAvgCpu")}>{st.avg_cpu_time_s != null ? `${st.avg_cpu_time_s}s` : "—"}</InfoRow>
              <InfoRow label={t("statAvgMem")}>{st.avg_peak_memory_mb != null ? `${st.avg_peak_memory_mb} MB` : "—"}</InfoRow>
            </TabsContent>

            {/* ── Actions ── */}
            <TabsContent value="tab3" className="space-y-4 max-w-2xl mt-6 px-4">
              {/* Ping */}
              <div className="rounded-md border p-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{t("actionPing")}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {pingResult ?? t("actionPingDescription")}
                  </p>
                </div>
                <Button variant="secondary" size="sm" className="shrink-0 cursor-pointer" onClick={() => pingMutation.mutate()} disabled={pingMutation.isPending}>
                  <Radio className="h-3.5 w-3.5 mr-1.5" />
                  {t("actionPing")}
                </Button>
              </div>

              {/* Lifecycle controls — buttons on the right of the section,
                  stacked with Restart over Stop. */}
              <div className="rounded-md border p-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{t("actionLifecycle")}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{t("actionLifecycleDescription")}</p>
                  {!worker.controllable && (
                    <p className="text-xs text-[var(--muted-foreground)] italic pt-1">
                      {worker.is_remote ? t("remoteNotControllable") : t("potentialHint", { profile: worker.profile ?? worker.name })}
                    </p>
                  )}
                </div>
                {worker.controllable && (
                  <div className="flex flex-col items-stretch gap-2 shrink-0">
                    {stopped && (
                      <Button variant="default" size="sm" className="cursor-pointer" onClick={() => actionMutation.mutate("start")} disabled={busy}>
                        <Play className="h-3.5 w-3.5 mr-1.5" />{t("actionStart")}
                      </Button>
                    )}
                    {running && (
                      <Button variant="secondary" size="sm" className="cursor-pointer" onClick={() => actionMutation.mutate("restart")} disabled={busy}>
                        <RotateCw className="h-3.5 w-3.5 mr-1.5" />{t("actionRestart")}
                      </Button>
                    )}
                    {running && (
                      <Button variant="secondary" size="sm" className="cursor-pointer" onClick={() => actionMutation.mutate("stop")} disabled={busy}>
                        <Square className="h-3.5 w-3.5 mr-1.5" />{t("actionStop")}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Remove zone */}
              {worker.controllable && (
                <div className="rounded-md border border-destructive/30 p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-destructive">{t("removeTitle")}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{t("removeZoneDescription")}</p>
                  </div>
                  <Button variant="destructive" size="sm" className="shrink-0 cursor-pointer" onClick={() => { setDeleteUnderstood(false); setDeleteConfirmText(""); setDeleteOpen(true) }}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />{t("removeButton")}
                  </Button>
                </div>
              )}
            </TabsContent>

          </div>
        </Tabs>
      </div>

      {/* ── Remove confirm dialog ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("removeAbsoluteTitle", { name })}</DialogTitle>
            <DialogDescription>{t("removeAbsoluteDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("removeUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm")}</label>
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>{t("cancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={() => removeMutation.mutate()}
              disabled={!deleteUnderstood || deleteConfirmText !== t("deleteTypePlaceholder") || removeMutation.isPending}
            >
              {t("removeButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
