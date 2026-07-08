"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { X, Loader2, Info, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react"
import { AnimatedActivity, AnimatedFlask, AnimatedCookingPot, AnimatedSettings } from "@/components/icons/animated-icons"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { CloudDownload } from "@/components/animate-ui/icons/cloud-download"
import { Pickaxe } from "@/components/animate-ui/icons/pickaxe"
import { useAnimation } from "motion/react"
import { formatDistanceToNow } from "date-fns"
import { tasksApi, customersApi, configurationApi, type TaskRecordResponse, type TaskStatus, type WorkerInfo } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { TaskDetailModal } from "@/components/dashboard/task-detail-modal"
import { cn } from "@/lib/utils"

type BadgeVariant = "muted" | "info" | "success" | "destructive" | "warning"

const STATUS_BADGE: Record<TaskStatus, BadgeVariant> = {
  pending: "muted",
  started: "info",
  success: "success",
  failure: "destructive",
  revoked: "warning",
  continued: "muted",
  stopped: "warning",
}

function TaskCard({ task, customerName, activeTaskIds, onTaskClick }: { task: TaskRecordResponse; customerName?: string; activeTaskIds: Set<string>; onTaskClick: (task: TaskRecordResponse) => void }) {
  const t = useTranslations("tasks")
  const queryClient = useQueryClient()
  const router = useRouter()

  // Tick every 30s so relative time strings recalculate even when task data is unchanged
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  function handleClick() {
    onTaskClick(task)
  }

  const [confirmOpen, setConfirmOpen] = useState(false)

  const cancelMutation = useMutation({
    mutationFn: () => tasksApi.cancel(task.task_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      setConfirmOpen(false)
    },
  })

  const iconControls = useAnimation()
  const [hovered, setHovered] = useState(false)
  const Icon = task.type === "prediction" ? AnimatedActivity : task.type === "finetune" ? AnimatedCookingPot : task.type === "optimization" ? AnimatedSettings : AnimatedFlask
  // Import tasks use the animate-ui CloudDownload icon (its own `animate`
  // trigger); other types use the motion-controls animated-icons set.
  const renderIcon = (className: string) =>
    task.type === "import" ? (
      <CloudDownload className={className} animate={hovered} />
    ) : (
      <Icon className={className} controls={iconControls} />
    )

  const timeRef = task.completed_at ?? task.started_at ?? task.created_at
  const timeStr = timeRef
    ? formatDistanceToNow(new Date(timeRef), { addSuffix: true })
    : null

  // ETA: extrapolate from progress % and elapsed time since started
  let etaStr: string | null = null
  if (task.status === "started" && task.progress > 0 && task.progress < 100 && task.started_at) {
    const elapsedMs = Date.now() - new Date(task.started_at).getTime()
    const totalEstMs = elapsedMs / (task.progress / 100)
    const remainMs = totalEstMs - elapsedMs
    if (remainMs > 0) {
      const remainSec = Math.round(remainMs / 1000)
      if (remainSec < 60) etaStr = t("etaSeconds", { seconds: remainSec })
      else if (remainSec < 3600) etaStr = t("etaMinutes", { minutes: Math.round(remainSec / 60) })
      else etaStr = t("etaHours", { hours: (remainSec / 3600).toFixed(1) })
    }
  }

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 hover:bg-[var(--accent)]/30 transition-colors cursor-pointer"
      onClick={handleClick}
      onMouseEnter={() => { setHovered(true); iconControls.start("animate") }}
      onMouseLeave={() => { setHovered(false); iconControls.start("normal") }}
    >
      <div className="flex flex-col items-center gap-1.5 shrink-0">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md",
            task.status === "started"
              ? "bg-blue-500/15 text-blue-500"
              : task.status === "success"
              ? "bg-green-500/15 text-green-500"
              : task.status === "failure"
              ? "bg-red-500/15 text-red-500"
              : "bg-[var(--muted)] text-[var(--muted-foreground)]"
          )}
        >
          {task.status === "started" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            renderIcon("h-4 w-4")
          )}
        </div>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-default">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="min-w-[148px]">
              <div className="space-y-1">
                {task.status === "started" && (
                  <div className="flex items-center gap-1.5 pb-0.5 border-b border-[var(--border)]">
                    {activeTaskIds.has(task.task_id) ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                        <span className="text-green-500 font-medium">{t("workerConfirmed")}</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3 text-yellow-500 shrink-0" />
                        <span className="text-yellow-500 font-medium">{t("workerNotFound")}</span>
                      </>
                    )}
                  </div>
                )}
                {task.worker_name && (
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted-foreground)]">Worker</span>
                    <span className="font-medium">{task.worker_name}</span>
                  </div>
                )}
                {task.peak_memory_mb != null || task.cpu_time_s != null ? (
                  <div className="space-y-0.5">
                    {task.peak_memory_mb != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[var(--muted-foreground)]">{t("memory")}</span>
                        <span className="font-medium">{task.peak_memory_mb.toFixed(0)} MB</span>
                      </div>
                    )}
                    {task.cpu_time_s != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[var(--muted-foreground)]">{t("cpu")}</span>
                        <span className="font-medium">{task.cpu_time_s.toFixed(1)}s</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-[var(--muted-foreground)]">{t("noMetrics")}</span>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {t(`type.${task.type}` as Parameters<typeof t>[0])}
          </span>
          <Badge variant={STATUS_BADGE[task.status]}>
            {t(`status.${task.status}` as Parameters<typeof t>[0])}
          </Badge>
          {task.worker_name && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal text-[var(--muted-foreground)]">
              {task.worker_name}
            </Badge>
          )}
        </div>
        {customerName && (
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">
            {customerName}
          </p>
        )}
        {task.name && (
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">
            {task.name}
          </p>
        )}
        {timeStr && (
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {timeStr}{etaStr && <span className="ml-1.5 text-blue-400">{etaStr}</span>}
          </p>
        )}
        {task.status === "failure" && task.error && (
          <p className="text-xs text-[var(--destructive)] mt-1 break-words line-clamp-3">{task.error}</p>
        )}
        {task.status === "started" && task.progress > 0 && (
          <div className="mt-2">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-[var(--muted-foreground)] truncate">
                {task.progress_message ?? "Processing…"}
              </span>
              <span className="text-xs text-[var(--muted-foreground)] ml-2 shrink-0">{task.progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--muted)]">
              <div
                className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {(task.status === "pending" || task.status === "started") && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
          onClick={(e) => { e.stopPropagation(); setConfirmOpen(true) }}
          disabled={cancelMutation.isPending}
          aria-label={t("cancel")}
        >
          {cancelMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
        </Button>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("cancelConfirmDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>{t("cancelConfirmNo")}</Button>
            <Button
              variant="destructive" size="sm"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("cancelConfirmYes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TaskSection({
  title,
  tasks,
  emptyLabel,
  customerMap,
  activeTaskIds,
  workerAlert,
  onRestartWorkers,
  onTaskClick,
}: {
  title: string
  tasks: TaskRecordResponse[]
  emptyLabel: string
  customerMap: Record<string, string>
  activeTaskIds: Set<string>
  workerAlert?: "restarting" | "gone" | null
  onRestartWorkers?: () => void
  onTaskClick: (task: TaskRecordResponse) => void
}) {
  const t = useTranslations("tasks")
  return (
    <Card className="flex flex-col min-h-0 h-full">
      <CardHeader className="pb-3 shrink-0">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {title}
          {tasks.length > 0 && (
            <Badge variant="muted" className="text-xs">
              {tasks.length}
            </Badge>
          )}
        </CardTitle>
        {workerAlert === "restarting" && (
          <div className="flex items-center gap-1.5 rounded-md bg-orange-500/15 px-2.5 py-1.5 text-xs font-medium text-orange-600 dark:text-orange-400">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            {t("workersRestarting")}
          </div>
        )}
        {workerAlert === "gone" && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full gap-1.5 text-xs h-7"
            onClick={onRestartWorkers}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {t("workersGoneRestart")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto min-h-0">
        {tasks.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] italic py-2">{emptyLabel}</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                customerName={task.customer_id ? customerMap[task.customer_id] : undefined}
                activeTaskIds={activeTaskIds}
                onTaskClick={onTaskClick}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function WorkersSection({ workers }: { workers: WorkerInfo[] }) {
  const t = useTranslations("tasks")
  return (
    <Card className="flex flex-col min-h-0">
      <CardHeader className="pb-3 shrink-0">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {t("workers")}
          {workers.length > 0 && (
            <Badge variant="muted" className="text-xs">
              {workers.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {workers.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] italic py-2">{t("noWorkers")}</p>
        ) : (
          <div className="space-y-2">
            {workers.map((worker) => (
              <AnimateIcon key={worker.name} animateOnHover asChild>
              <div className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 hover:bg-[var(--accent)]/30 transition-colors cursor-default">
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-green-500/15 text-green-500">
                    <Pickaxe size={16} className="h-4 w-4" />
                  </div>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-default">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="min-w-[148px]">
                        <div className="space-y-1">
                          <div className="flex justify-between gap-4">
                            <span className="text-[var(--muted-foreground)]">{t("workerGpu")}</span>
                            <span className="font-medium">
                              {worker.gpu_name
                                ? `${worker.gpu_name}${worker.gpu_count ? ` (${worker.gpu_count})` : ""}`
                                : t("workerNoGpu")}
                            </span>
                          </div>
                          {worker.gpu_vram_total_mb != null && (
                            <div className="flex justify-between gap-4">
                              <span className="text-[var(--muted-foreground)]">{t("workerVram")}</span>
                              <span className="font-medium">
                                {worker.gpu_vram_total_mb >= 1024
                                  ? `${(worker.gpu_vram_total_mb / 1024).toFixed(1)} GB`
                                  : `${worker.gpu_vram_total_mb} MB`}
                              </span>
                            </div>
                          )}
                          {worker.uptime_s != null && (
                            <div className="flex justify-between gap-4">
                              <span className="text-[var(--muted-foreground)]">{t("workerUptime")}</span>
                              <span className="font-medium">{formatUptime(worker.uptime_s)}</span>
                            </div>
                          )}
                          <div className="flex justify-between gap-4">
                            <span className="text-[var(--muted-foreground)]">{t("workerModels")}</span>
                            {worker.models.length > 0 ? (
                              <div className="flex flex-wrap gap-1 justify-end">
                                {worker.models.map((model) => (
                                  <Badge key={model} variant="muted" className="text-[10px] px-1.5 py-0 h-4">
                                    {model}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[var(--muted-foreground)] italic">—</span>
                            )}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex-1 min-w-0 flex items-center h-8">
                  <span className="text-sm font-medium truncate">{worker.name}</span>
                </div>
              </div>
              </AnimateIcon>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function TaskDashboard() {
  const t = useTranslations("tasks")
  const queryClient = useQueryClient()
  const [selectedTask, setSelectedTask] = useState<TaskRecordResponse | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  function handleTaskClick(task: TaskRecordResponse) {
    setSelectedTask(task)
    setModalOpen(true)
  }

  // ── Config ───────────────────────────────────────────────────────────────
  const { data: config } = useQuery({
    queryKey: ["configuration"],
    queryFn: () => configurationApi.get(),
    staleTime: 5 * 60_000,
  })
  const checkIntervalMs = (config?.periodic_check_workers ?? 2) * 60_000
  const autoRestart = config?.auto_restart_workers ?? true

  // ── Worker health ────────────────────────────────────────────────────────
  const { data: pingData } = useQuery({
    queryKey: ["workers-ping"],
    queryFn: () => tasksApi.pingWorkers(),
    staleTime: 0,
    refetchInterval: (query) =>
      // Poll faster while we know workers are down
      query.state.data?.alive === false ? 5_000 : checkIntervalMs,
  })
  // Treat undefined (initial load) as alive to avoid false alerts on mount
  const workersAlive = pingData === undefined ? true : pingData.alive

  // Track restarting state, attempt count, and minimum badge timer
  const [restartState, setRestartState] = useState<"idle" | "restarting">("idle")
  const [restartedAt, setRestartedAt] = useState<number | null>(null)
  const [restartAttempts, setRestartAttempts] = useState(0)
  const MAX_AUTO_RESTARTS = 2

  const restartMutation = useMutation({
    mutationFn: () => tasksApi.restartWorkers(),
    onSuccess: () => {
      setRestartedAt(Date.now())
      queryClient.invalidateQueries({ queryKey: ["workers-ping"] })
    },
    onError: () => {
      // Restart call itself failed — go straight to "gone" state
      setRestartState("idle")
    },
  })

  // Auto-restart when workers go down (up to MAX_AUTO_RESTARTS attempts)
  useEffect(() => {
    if (
      !workersAlive &&
      autoRestart &&
      restartState === "idle" &&
      restartAttempts < MAX_AUTO_RESTARTS &&
      !restartMutation.isPending
    ) {
      setRestartState("restarting")
      setRestartAttempts((n) => n + 1)
      restartMutation.mutate()
    }
  }, [workersAlive, autoRestart, restartState, restartAttempts, restartMutation])

  // Timeout: if workers haven't come back within 30s of a restart, give up this attempt
  useEffect(() => {
    if (restartState === "restarting" && restartedAt !== null && !workersAlive) {
      const timer = setTimeout(() => {
        setRestartState("idle")
        setRestartedAt(null)
      }, 30_000)
      return () => clearTimeout(timer)
    }
  }, [restartState, restartedAt, workersAlive])

  // Clear restarting state once workers are back AND min 5s has passed
  useEffect(() => {
    if (workersAlive && restartState === "restarting" && restartedAt !== null) {
      const elapsed = Date.now() - restartedAt
      const remaining = Math.max(0, 5_000 - elapsed)
      const timer = setTimeout(() => {
        setRestartState("idle")
        setRestartedAt(null)
        setRestartAttempts(0)
      }, remaining)
      return () => clearTimeout(timer)
    }
  }, [workersAlive, restartState, restartedAt])

  function handleManualRestart() {
    setRestartState("restarting")
    setRestartAttempts(0) // Reset counter on manual restart
    restartMutation.mutate()
  }

  let workerAlert: "restarting" | "gone" | null = null
  if (restartState === "restarting") {
    workerAlert = "restarting"
  } else if (!workersAlive) {
    workerAlert = "gone"
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  const { data: tasksData, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list({ limit: 100 }),
    staleTime: 0,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? []
      const hasActive = items.some((t) => t.status === "started" || t.status === "pending")
      return hasActive ? 5_000 : 30_000
    },
  })

  // Running/Pending are fetched by status so they're never hidden by the
  // created_at-ordered 100-row window of the main list — a large backlog
  // pushes the (FIFO, oldest-created) running task out of that window.
  const { data: runningData } = useQuery({
    queryKey: ["tasks", "started"],
    queryFn: () => tasksApi.list({ status: "started", limit: 50 }),
    staleTime: 0,
    refetchInterval: 5_000,
  })
  const { data: pendingData } = useQuery({
    queryKey: ["tasks", "pending"],
    queryFn: () => tasksApi.list({ status: "pending", limit: 50 }),
    staleTime: 0,
    refetchInterval: (query) => ((query.state.data?.items?.length ?? 0) > 0 ? 5_000 : 30_000),
  })

  const { data: activeWorkerTasks } = useQuery({
    queryKey: ["tasks-active"],
    queryFn: () => tasksApi.active(),
    staleTime: 0,
    refetchInterval: 5_000,
  })

  const activeTaskIds = new Set((activeWorkerTasks ?? []).map((t) => t.task_id))

  const { data: workers } = useQuery({
    queryKey: ["workers-list"],
    queryFn: () => tasksApi.listWorkers(),
    staleTime: 0,
    refetchInterval: checkIntervalMs,
  })

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list(),
    staleTime: 5 * 60_000,
  })

  const customerMap: Record<string, string> = {}
  customers?.forEach((c) => { customerMap[c.id] = c.name })

  const COLUMN_LIMIT = 10
  const tasks = tasksData?.items ?? []
  const pending = (pendingData?.items ?? [])
    .filter((t) => t.status === "pending")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .slice(0, COLUMN_LIMIT)
  const running = (runningData?.items ?? [])
    .filter((t) => t.status === "started")
    .sort((a, b) =>
      (b.started_at ?? b.created_at) < (a.started_at ?? a.created_at) ? -1 : 1
    )
    .slice(0, COLUMN_LIMIT)
  const finished = tasks
    .filter((t) => ["success", "failure", "revoked", "continued", "stopped"].includes(t.status))
    .sort((a, b) =>
      (b.completed_at ?? b.updated_at) < (a.completed_at ?? a.updated_at) ? -1 : 1
    )
    .slice(0, COLUMN_LIMIT)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 grid gap-6 md:grid-cols-3">
        <TaskSection
          title={t("running")}
          tasks={running}
          emptyLabel={t("noRunningTasks")}
          customerMap={customerMap}
          activeTaskIds={activeTaskIds}
          onTaskClick={handleTaskClick}
        />
        <TaskSection
          title={t("pending")}
          tasks={pending}
          emptyLabel={t("noPendingTasks")}
          customerMap={customerMap}
          activeTaskIds={activeTaskIds}
          workerAlert={workerAlert}
          onRestartWorkers={handleManualRestart}
          onTaskClick={handleTaskClick}
        />
        <div className="flex flex-col gap-6 min-h-0">
          <WorkersSection workers={workers ?? []} />
          <TaskSection
            title={t("finished")}
            tasks={finished}
            emptyLabel={t("noFinishedTasks")}
            customerMap={customerMap}
            activeTaskIds={activeTaskIds}
            onTaskClick={handleTaskClick}
          />
        </div>
      </div>

      <TaskDetailModal
        task={selectedTask}
        customerName={selectedTask?.customer_id ? customerMap[selectedTask.customer_id] : undefined}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </div>
  )
}
