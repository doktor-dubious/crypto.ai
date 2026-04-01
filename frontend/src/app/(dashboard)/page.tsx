import type { Metadata } from "next"
import { TaskDashboard } from "@/components/dashboard/task-dashboard"
import { InsightsPrompt } from "@/components/insights/insights-prompt"

export const metadata: Metadata = {
  title: "Home",
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <InsightsPrompt />
      <TaskDashboard />
    </div>
  )
}
