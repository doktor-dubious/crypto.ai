import type { Metadata } from "next"
import { InsightsAllChats } from "@/components/insights/insights-all-chats"

export const metadata: Metadata = {
  title: "All Chats",
}

export default function InsightsAllChatsPage() {
  return <InsightsAllChats />
}
