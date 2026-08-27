import { redirect } from "@/i18n/navigation";

export default async function SellerMessagesRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/messages", locale: locale as "en" | "vi" });
}
