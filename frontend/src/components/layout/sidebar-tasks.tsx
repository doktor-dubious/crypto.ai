"use client"

import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Activity, BarChart3, X } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { tasksApi, type TaskRecordResponse, type TaskStatus } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

type BadgeVariant = "muted" | "info" | "success" | "destructive" | "warning"

const STATUS_BADGE: Record<TaskStatus, BadgeVariant> = {
  pending: "muted",
  started: "info",
  success: "success",
  failure: "destructive",
  revoked: "warning",
}

function TaskItem({ task }: { task: TaskRecordResponse }) {
  const t = useTranslations("tasks")
  const queryClient = useQueryClient()
  const { state } = useSidebar()
  const isExpanded = state === "expanded"

  const cancelMutation = useMutation({
    mutationFn: () => tasksApi.cancel(task.task_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    },
  })

  const Icon = task.type === "prediction" ? Activity : BarChart3
  const timeStr = (task.started_at ?? task.created_at)
    ? formatDistanceToNow(new Date(task.started_at ?? task.created_at), {
        addSuffix: true,
      })
    : null

  if (!isExpanded) {
    return (
      <li className="flex items-center justify-center py-1">
        <div className="relative">
          <Icon className="h-4 w-4 text-[var(--sidebar-foreground)]/70" />
          <span
            className={cn(
              "absolute -right-1 -top-1 h-2 w-2 rounded-full",
              task.status === "started" && "bg-blue-500 animate-pulse",
              task.status === "pending" && "bg-yellow-500",
              task.status === "success" && "bg-green-500",
              task.status === "failure" && "bg-red-500",
              task.status === "revoked" && "bg-orange-500"
            )}
          />
        </div>
      </li>
    )
  }

  return (
    <li className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--sidebar-accent)] transition-colors">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--sidebar-foreground)]/60" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--sidebar-foreground)] truncate">
            {t(`type.${task.type}` as Parameters<typeof t>[0])}
          </span>
          <Badge variant={STATUS_BADGE[task.status]} className="text-[10px] px-1.5 py-0 h-4">
            {t(`status.${task.status}` as Parameters<typeof t>[0])}
          </Badge>
        </div>
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
          className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--sidebar-foreground)]/50 hover:text-[var(--destructive)]"
          onClick={(e) => {
            e.stopPropagation()
            cancelMutation.mutate()
          }}
          disabled={cancelMutation.isPending}
          aria-label={t("cancel")}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </li>
  )
}

function TaskGroup({
  label,
  tasks,
  emptyLabel,
}: {
  label: string
  tasks: TaskRecordResponse[]
  emptyLabel: string
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
            <TaskItem key={task.id} task={task} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function SidebarTasks() {
  const t = useTranslations("tasks")

  const { data } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list({ limit: 100 }),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? []
      const hasActive = items.some((t) => t.status === "started" || t.status === "pending")
      return hasActive ? 5_000 : 30_000
    },
  })

  const tasks = data?.items ?? []

  const pending = tasks.filter((t) => t.status === "pending")
  const running = tasks
    .filter((t) => t.status === "started")
    .sort((a, b) =>
      (a.started_at ?? a.created_at) < (b.started_at ?? b.created_at) ? -1 : 1
    )
  const finished = tasks
    .filter((t) => ["success", "failure", "revoked"].includes(t.status))
    .sort((a, b) =>
      (b.completed_at ?? b.updated_at) < (a.completed_at ?? a.updated_at) ? -1 : 1
    )

  return (
    <div className="space-y-3">
      <TaskGroup
        label={t("running")}
        tasks={running}
        emptyLabel={t("noRunningTasks")}
      />
      <TaskGroup
        label={t("pending")}
        tasks={pending}
        emptyLabel={t("noPendingTasks")}
      />
      <TaskGroup
        label={t("finished")}
        tasks={finished}
        emptyLabel={t("noFinishedTasks")}
      />
    </div>
  )
}
