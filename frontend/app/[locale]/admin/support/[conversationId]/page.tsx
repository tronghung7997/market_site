"use client";

import InboxWorkbench from "@/components/chat/InboxWorkbench";
import { use } from "react";

export default function AdminSupportConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = use(params);
  return <InboxWorkbench variant="admin-support" initialConversationId={conversationId} />;
}
