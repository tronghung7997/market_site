import { redirect } from "@/i18n/navigation";
import { AdminAccountsConsole } from "@/features/admin-accounts";

/** `?account=<id>` is the pre-profile deep link (alerts, logs, disputes, audit
 *  hrefs from the backend); it now lands on that account's own page. */
export default async function AdminAccountsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = (await searchParams).account;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (Number.isInteger(id) && id > 0) redirect({ href: `/admin/accounts/${id}`, locale });
  return <AdminAccountsConsole />;
}
