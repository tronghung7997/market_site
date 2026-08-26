import InboxWorkbench from "@/components/chat/InboxWorkbench";

export default async function SellerConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <InboxWorkbench perspective="seller" initialConversationId={conversationId} />;
}
