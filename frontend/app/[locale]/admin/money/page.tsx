import { redirect } from "@/i18n/navigation";

/**
 * Legacy path after rename → /admin/display-settings.
 * Prefer next.config redirects for reliability; this is a belt-and-suspenders
 * App Router redirect using next-intl so locale stays correct.
 */
export default async function LegacyMoneySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/admin/display-settings", locale: locale as "en" | "vi" });
}
