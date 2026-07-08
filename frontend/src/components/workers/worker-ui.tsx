import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkerStatus } from "@/lib/api"

// Compact uptime like "3d 4h", "2h 5m", "45s".
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "—"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const STATUS_CLS: Record<WorkerStatus, string> = {
  running: "bg-green-100 text-green-800 border-green-200",
  stopped: "bg-gray-100 text-gray-700 border-gray-200",
  potential: "bg-blue-100 text-blue-800 border-blue-200",
}

export function WorkerStatusBadge({
  status,
  label,
  spin,
}: {
  status: WorkerStatus
  label: string
  spin?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_CLS[status] ?? STATUS_CLS.stopped,
      )}
    >
      {spin && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </span>
  )
}

const HEALTH_COLOR: Record<string, string> = {
  healthy: "bg-green-500",
  unhealthy: "bg-red-500",
  starting: "bg-amber-500",
  none: "bg-gray-400",
}

export function HealthDot({ health, label }: { health: string | null; label: string }) {
  if (!health) return <span className="text-[var(--muted-foreground)]">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn("h-2 w-2 rounded-full", HEALTH_COLOR[health] ?? "bg-gray-400")} />
      {label}
    </span>
  )
}
