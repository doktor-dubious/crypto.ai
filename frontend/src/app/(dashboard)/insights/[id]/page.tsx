import type { Metadata } from "next"
import { InsightsPage } from "@/components/insights/insights-page"

export const metadata: Metadata = {
  title: "Insights",
}

export default async function InsightsConversationRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <InsightsPage initialSessionId={id} />
}
