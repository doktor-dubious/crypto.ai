import type { Metadata } from "next"
import { SharedConversation } from "@/components/insights/shared-conversation"

export const metadata: Metadata = {
  title: "Shared Conversation — Gorm AI",
}

export default async function SharedConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SharedConversation sessionId={id} />
}
