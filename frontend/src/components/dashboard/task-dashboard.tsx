"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { X, Loader2 } from "lucide-react"
import { AnimatedActivity, AnimatedFlask } from "@/components/icons/animated-icons"
import { useAnimation } from "motion/react"
import { formatDistanceToNow } from "date-fns"
import { tasksApi, customersApi, type TaskRecordResponse, type TaskStatus } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type BadgeVariant = "muted" | "info" | "success" | "destructive" | "warning"

const STATUS_BADGE: Record<TaskStatus, BadgeVariant> = {
  pending: "muted",
  started: "info",
  success: "success",
  failure: "destructive",
  revoked: "warning",
}

function TaskCard({ task, customerName }: { task: TaskRecordResponse; customerName?: string }) {
  const t = useTranslations("tasks")
  const queryClient = useQueryClient()
  const router = useRouter()

  // Tick every 30s so relative time strings recalculate even when task data is unchanged
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const isFinished = task.status === "success" || task.status === "failure" || task.status === "revoked"
  const completedRoute = task.type === "prediction"
    ? `/predictions/completed?task_id=${task.task_id}`
    : `/simulations/completed?task_id=${task.task_id}`

  function handleClick() {
    if (isFinished) router.push(completedRoute)
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
  const Icon = task.type === "prediction" ? AnimatedActivity : AnimatedFlask

  const timeRef = task.completed_at ?? task.started_at ?? task.created_at
  const timeStr = timeRef
    ? formatDistanceToNow(new Date(timeRef), { addSuffix: true })
    : null

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 hover:bg-[var(--accent)]/30 transition-colors",
        isFinished && "cursor-pointer"
      )}
      onClick={handleClick}
      onMouseEnter={() => iconControls.start("animate")}
      onMouseLeave={() => iconControls.start("normal")}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
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
          <Icon className="h-4 w-4" controls={iconControls} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {t(`type.${task.type}` as Parameters<typeof t>[0])}
          </span>
          <Badge variant={STATUS_BADGE[task.status]}>
            {t(`status.${task.status}` as Parameters<typeof t>[0])}
          </Badge>
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
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{timeStr}</p>
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
}: {
  title: string
  tasks: TaskRecordResponse[]
  emptyLabel: string
  customerMap: Record<string, string>
}) {
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
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function TaskDashboard() {
  const t = useTranslations("tasks")

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

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list(),
    staleTime: 5 * 60_000,
  })

  const customerMap: Record<string, string> = {}
  customers?.forEach((c) => {
    customerMap[c.id] = c.name
  })

  const COLUMN_LIMIT = 10

  const tasks = tasksData?.items ?? []
  const pending = tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => (b.created_at < a.created_at ? -1 : 1))
    .slice(0, COLUMN_LIMIT)
  const running = tasks
    .filter((t) => t.status === "started")
    .sort((a, b) =>
      (b.started_at ?? b.created_at) < (a.started_at ?? a.created_at) ? -1 : 1
    )
    .slice(0, COLUMN_LIMIT)
  const finished = tasks
    .filter((t) => ["success", "failure", "revoked"].includes(t.status))
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
        />
        <TaskSection
          title={t("pending")}
          tasks={pending}
          emptyLabel={t("noPendingTasks")}
          customerMap={customerMap}
        />
        <TaskSection
          title={t("finished")}
          tasks={finished}
          emptyLabel={t("noFinishedTasks")}
          customerMap={customerMap}
        />
      </div>
    </div>
  )
}
