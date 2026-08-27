import { redirect } from "@/i18n/navigation";

export default async function SellerConversationRedirect({
  params,
}: {
  params: Promise<{ locale: string; conversationId: string }>;
}) {
  const { locale, conversationId } = await params;
  redirect({ href: `/messages/${conversationId}`, locale: locale as "en" | "vi" });
}
