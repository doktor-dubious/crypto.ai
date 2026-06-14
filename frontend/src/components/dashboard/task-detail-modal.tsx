"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  BarChart3,
  Brain,
  Clock,
  Cpu,
  ExternalLink,
  Loader2,
  MemoryStick,
  Play,
  Server,
  Square,
  User,
} from "lucide-react"
import { format, formatDistanceStrict } from "date-fns"
import {
  tasksApi,
  simulationsApi,
  optimizationApi,
  finetuneApi,
  type TaskRecordResponse,
  type TaskType,
} from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCustomer } from "@/components/providers/customer-provider"
import { AnimatedActivity, AnimatedFlask, AnimatedCookingPot, AnimatedSettings } from "@/components/icons/animated-icons"
import { cn } from "@/lib/utils"

type BadgeVariant = "muted" | "info" | "success" | "destructive" | "warning"

const STATUS_BADGE: Record<string, BadgeVariant> = {
  pending: "muted",
  started: "info",
  success: "success",
  failure: "destructive",
  revoked: "warning",
  continued: "muted",
  stopped: "warning",
}

const TASK_TYPE_ICON: Record<TaskType, typeof Activity> = {
  prediction: Activity,
  simulation: BarChart3,
  kline_simulation: BarChart3,
  import: Activity,
  finetune: Brain,
  optimization: Brain,
}

function getRedirectPath(task: TaskRecordResponse): string | null {
  switch (task.type) {
    case "prediction":
      return `/predictions/completed?task_id=${task.task_id}`
    case "simulation":
      return `/simulations/completed?task_id=${task.task_id}`
    case "finetune":
      return `/ai-models?task_id=${task.task_id}`
    case "optimization":
      return `/configuration?task_id=${task.task_id}`
    default:
      return null
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt) return null
  const start = new Date(startedAt)
  const end = completedAt ? new Date(completedAt) : new Date()
  return formatDistanceStrict(start, end)
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-[var(--muted-foreground)] shrink-0">{label}</span>
      <span className="text-sm font-medium text-right truncate">{children}</span>
    </div>
  )
}

export function TaskDetailModal({
  task,
  customerName,
  open,
  onOpenChange,
}: {
  task: TaskRecordResponse | null
  customerName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("tasks")
  const router = useRouter()
  const queryClient = useQueryClient()
  const { activeCustomer } = useCustomer()

  const [confirmStop, setConfirmStop] = useState(false)

  const isCurrentCustomer = task?.customer_id === activeCustomer?.id
  const isRunning = task?.status === "started"
  const canStop = isRunning && task && ["finetune", "simulation", "optimization"].includes(task.type)
  const canResume = task?.status === "stopped" || task?.status === "failure" || task?.status === "revoked"
  const redirectPath = task ? getRedirectPath(task) : null

  // Stop mutation
  const stopMutation = useMutation({
    mutationFn: () => tasksApi.stop(task!.task_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      setConfirmStop(false)
      onOpenChange(false)
    },
  })

  // Resume mutation
  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!task) return
      switch (task.type) {
        case "simulation":
          return simulationsApi.resume(task.id)
        case "optimization":
          return optimizationApi.resume(task.id)
        case "finetune":
          return finetuneApi.resume(task.id)
        default:
          throw new Error(`Resume not supported for ${task.type}`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      onOpenChange(false)
    },
  })

  if (!task) return null

  const duration = formatDuration(task.started_at, task.completed_at)
  const Icon = task.type === "prediction"
    ? AnimatedActivity
    : task.type === "finetune"
    ? AnimatedCookingPot
    : task.type === "optimization"
    ? AnimatedSettings
    : AnimatedFlask

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
                task.status === "started"
                  ? "bg-blue-500/15 text-blue-500"
                  : task.status === "success"
                  ? "bg-green-500/15 text-green-500"
                  : task.status === "failure"
                  ? "bg-red-500/15 text-red-500"
                  : task.status === "stopped"
                  ? "bg-orange-500/15 text-orange-500"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]"
              )}
            >
              {task.status === "started" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Icon className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                {t(`type.${task.type}` as Parameters<typeof t>[0])}
                <Badge variant={STATUS_BADGE[task.status] ?? "muted"}>
                  {t(`status.${task.status}` as Parameters<typeof t>[0])}
                </Badge>
              </DialogTitle>
              {task.name && (
                <DialogDescription className="mt-0.5 truncate">
                  {task.name}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="divide-y divide-[var(--border)]">
          {/* Customer */}
          {customerName && (
            <InfoRow label={t("detail.customer")}>
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                {customerName}
              </span>
            </InfoRow>
          )}

          {/* Time */}
          {task.started_at && (
            <InfoRow label={t("detail.startTime")}>
              {format(new Date(task.started_at), "MMM d, HH:mm:ss")}
            </InfoRow>
          )}
          {task.completed_at && (
            <InfoRow label={t("detail.endTime")}>
              {format(new Date(task.completed_at), "MMM d, HH:mm:ss")}
            </InfoRow>
          )}
          {duration && (
            <InfoRow label={t("detail.duration")}>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                {duration}
              </span>
            </InfoRow>
          )}

          {/* Worker */}
          {task.worker_name && (
            <InfoRow label={t("detail.worker")}>
              <span className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                {task.worker_name}
              </span>
            </InfoRow>
          )}

          {/* Resources */}
          {task.peak_memory_mb != null && (
            <InfoRow label={t("memory")}>
              <span className="flex items-center gap-1.5">
                <MemoryStick className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                {task.peak_memory_mb.toFixed(0)} MB
              </span>
            </InfoRow>
          )}
          {task.cpu_time_s != null && (
            <InfoRow label={t("cpu")}>
              <span className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                {task.cpu_time_s.toFixed(1)}s
              </span>
            </InfoRow>
          )}

          {/* Progress bar for stopped/failed tasks */}
          {canResume && task.progress > 0 && (
            <div className="py-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-[var(--muted-foreground)]">
                  {task.progress_message ?? t("detail.progressLabel")}
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">{task.progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--muted)]">
                <div
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-500",
                    task.status === "stopped" ? "bg-orange-500" : "bg-red-400",
                  )}
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Running progress */}
          {task.status === "started" && task.progress > 0 && (
            <div className="py-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-[var(--muted-foreground)]">
                  {task.progress_message ?? "Processing..."}
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">{task.progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--muted)]">
                <div
                  className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {task.status === "failure" && task.error && (
            <div className="py-2">
              <p className="text-xs font-medium text-[var(--destructive)] mb-1">{t("detail.error")}</p>
              <p className="text-xs text-[var(--destructive)]/80 break-words bg-[var(--destructive)]/5 rounded p-2">
                {task.error}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {/* Stop confirmation */}
          {canStop && confirmStop ? (
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-sm text-[var(--muted-foreground)]">{t("detail.stopConfirm")}</span>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmStop(false)}
                >
                  {t("cancelConfirmNo")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => stopMutation.mutate()}
                  disabled={stopMutation.isPending}
                >
                  {stopMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    t("detail.stopYes")
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Redirect link for current customer */}
              {isCurrentCustomer && redirectPath && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    router.push(redirectPath)
                    onOpenChange(false)
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("detail.viewDetails")}
                </Button>
              )}

              {/* Stop button */}
              {canStop && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setConfirmStop(true)}
                >
                  <Square className="h-3.5 w-3.5" />
                  {t("detail.stop")}
                </Button>
              )}
            </>
          )}

          {/* Resume button */}
          {canResume && ["finetune", "simulation", "optimization"].includes(task.type) && (
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  {t("detail.resume")}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
