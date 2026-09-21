import { redirect } from "@/i18n/navigation";

/** Kept for old links and mails: security now lives on the account page. */
export default async function AccountSecurityPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const setup = sp.setup === "2fa" ? "&setup=2fa" : "";
  redirect({ href: `/account?tab=security${setup}`, locale });
}
