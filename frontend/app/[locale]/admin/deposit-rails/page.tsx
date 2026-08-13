import { redirect } from "@/i18n/navigation";

/** Legacy path after merge into /admin/display-settings (Tiền & nạp). */
export default async function LegacyDepositRailsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/admin/display-settings", locale: locale as "en" | "vi" });
}
