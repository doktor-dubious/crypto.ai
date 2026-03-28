"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { AnimatedActivity, AnimatedFlask, AnimatedCookingPot, AnimatedSettings } from "@/components/icons/animated-icons"
import { useAnimation } from "motion/react"
import { formatDistanceToNow } from "date-fns"
import { tasksApi, customersApi, type TaskRecordResponse, type TaskStatus } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { useSidebar } from "@/components/ui/sidebar"
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

function TaskItem({ task, onTaskClick }: { task: TaskRecordResponse; onTaskClick: (task: TaskRecordResponse) => void }) {
  const t = useTranslations("tasks")
  const queryClient = useQueryClient()
  const { state } = useSidebar()
  const isExpanded = state === "expanded"

  const [confirmOpen, setConfirmOpen] = useState(false)

  const cancelMutation = useMutation({
    mutationFn: () => tasksApi.cancel(task.task_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      setConfirmOpen(false)
    },
  })

  // Tick every 30s so relative time strings recalculate even when task data is unchanged
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const iconControls = useAnimation()
  const Icon = task.type === "prediction" ? AnimatedActivity : task.type === "finetune" ? AnimatedCookingPot : task.type === "optimization" ? AnimatedSettings : AnimatedFlask
  const timeStr = (task.started_at ?? task.created_at)
    ? formatDistanceToNow(new Date(task.started_at ?? task.created_at), {
        addSuffix: true,
      })
    : null

  if (!isExpanded) {
    return (
      <li
        className="flex items-center justify-center py-1 cursor-pointer"
        onClick={() => onTaskClick(task)}
        onMouseEnter={() => iconControls.start("animate")}
        onMouseLeave={() => iconControls.start("normal")}
      >
        <div className="relative">
          <Icon className="h-4 w-4 text-[var(--sidebar-foreground)]/70" controls={iconControls} />
          <span
            className={cn(
              "absolute -right-1 -top-1 h-2 w-2 rounded-full",
              task.status === "started" && "bg-blue-500 animate-pulse",
              task.status === "pending" && "bg-yellow-500",
              task.status === "success" && "bg-green-500",
              task.status === "failure" && "bg-red-500",
              task.status === "revoked" && "bg-orange-500",
              task.status === "continued" && "bg-neutral-400",
              task.status === "stopped" && "bg-orange-500"
            )}
          />
        </div>
      </li>
    )
  }

  return (
    <li
      className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--sidebar-accent)] transition-colors cursor-pointer"
      onClick={() => onTaskClick(task)}
      onMouseEnter={() => iconControls.start("animate")}
      onMouseLeave={() => iconControls.start("normal")}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--sidebar-foreground)]/60" controls={iconControls} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--sidebar-foreground)] truncate">
            {t(`type.${task.type}` as Parameters<typeof t>[0])}
          </span>
          <Badge variant={STATUS_BADGE[task.status]} className="text-[10px] px-1.5 py-0 h-4">
            {t(`status.${task.status}` as Parameters<typeof t>[0])}
          </Badge>
        </div>
        {task.name && (
          <p className="text-[10px] text-[var(--sidebar-foreground)]/70 mt-0.5 truncate font-medium">{task.name}</p>
        )}
        {timeStr && (
          <p className="text-[10px] text-[var(--sidebar-foreground)]/50 mt-0.5">{timeStr}</p>
        )}
        {task.status === "failure" && task.error && (
          <p className="text-[10px] text-[var(--destructive)]/80 mt-0.5 truncate" title={task.error}>
            {task.error}
          </p>
        )}
        {task.status === "started" && task.progress > 0 && (
          <div className="mt-1.5">
            <div className="h-1 w-full rounded-full bg-[var(--sidebar-foreground)]/10">
              <div
                className="h-1 rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            {task.progress_message && (
              <p className="text-[9px] text-[var(--sidebar-foreground)]/40 mt-0.5 truncate">
                {task.progress_message}
              </p>
            )}
          </div>
        )}
      </div>
      {(task.status === "pending" || task.status === "started") && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[var(--sidebar-foreground)]/50 hover:text-[var(--destructive)]"
          onClick={(e) => { e.stopPropagation(); setConfirmOpen(true) }}
          disabled={cancelMutation.isPending}
          aria-label={t("cancel")}
        >
          <X className="h-3 w-3" />
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
              {t("cancelConfirmYes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}

function TaskGroup({
  label,
  tasks,
  emptyLabel,
  onTaskClick,
}: {
  label: string
  tasks: TaskRecordResponse[]
  emptyLabel: string
  onTaskClick: (task: TaskRecordResponse) => void
}) {
  const { state } = useSidebar()
  const isExpanded = state === "expanded"

  if (!isExpanded && tasks.length === 0) return null

  return (
    <div className="space-y-0.5">
      {isExpanded && (
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-foreground)]/50">
          {label}
        </p>
      )}
      {tasks.length === 0 && isExpanded ? (
        <p className="px-2 py-1 text-xs text-[var(--sidebar-foreground)]/40 italic">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} onTaskClick={onTaskClick} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function SidebarTasks() {
  const t = useTranslations("tasks")
  const [selectedTask, setSelectedTask] = useState<TaskRecordResponse | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list({ limit: 100 }),
    staleTime: 0,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? []
      const hasActive = items.some((t) => t.status === "started" || t.status === "pending")
      return hasActive ? 5_000 : 30_000
    },
  })

  // Fetch customers for the modal to show customer names
  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list(),
    staleTime: 5 * 60_000,
  })
  const customerMap: Record<string, string> = {}
  customers?.forEach((c) => { customerMap[c.id] = c.name })

  const SIDEBAR_LIMIT = 10

  const tasks = data?.items ?? []

  const running = tasks
    .filter((t) => t.status === "started")
    .sort((a, b) =>
      (a.started_at ?? a.created_at) < (b.started_at ?? b.created_at) ? -1 : 1
    )
  const pending = tasks.filter((t) => t.status === "pending")
  const finished = tasks
    .filter((t) => ["success", "failure", "revoked", "continued", "stopped"].includes(t.status))
    .sort((a, b) =>
      (b.completed_at ?? b.updated_at) < (a.completed_at ?? a.updated_at) ? -1 : 1
    )

  // Fill up to SIDEBAR_LIMIT: running first, then pending, then finished
  const runningSlice = running.slice(0, SIDEBAR_LIMIT)
  const remaining1 = SIDEBAR_LIMIT - runningSlice.length
  const pendingSlice = pending.slice(0, remaining1)
  const remaining2 = remaining1 - pendingSlice.length
  const finishedSlice = finished.slice(0, remaining2)

  function handleTaskClick(task: TaskRecordResponse) {
    setSelectedTask(task)
    setModalOpen(true)
  }

  return (
    <>
      <div className="space-y-3">
        <TaskGroup
          label={t("running")}
          tasks={runningSlice}
          emptyLabel={t("noRunningTasks")}
          onTaskClick={handleTaskClick}
        />
        <TaskGroup
          label={t("pending")}
          tasks={pendingSlice}
          emptyLabel={t("noPendingTasks")}
          onTaskClick={handleTaskClick}
        />
        <TaskGroup
          label={t("finished")}
          tasks={finishedSlice}
          emptyLabel={t("noFinishedTasks")}
          onTaskClick={handleTaskClick}
        />
      </div>

      <TaskDetailModal
        task={selectedTask}
        customerName={selectedTask?.customer_id ? customerMap[selectedTask.customer_id] : undefined}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  )
}
