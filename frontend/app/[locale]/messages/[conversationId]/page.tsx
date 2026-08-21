import InboxWorkbench from "@/components/chat/InboxWorkbench";

export default async function BuyerConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <InboxWorkbench perspective="buyer" initialConversationId={conversationId} />;
}
