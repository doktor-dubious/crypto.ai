import type { Metadata } from "next"
import { TaskDashboard } from "@/components/dashboard/task-dashboard"

export const metadata: Metadata = {
  title: "Home",
}

export default function DashboardPage() {
  return <TaskDashboard />
}
