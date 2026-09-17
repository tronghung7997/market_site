import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { AdminAuthFrame } from "@/features/admin-console";

export const metadata = PRIVATE_ROBOTS;

/** The admin console is internal: it gets the full catalog (the root layout
 *  scopes the storefront to non-seller/admin namespaces). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider messages={await getMessages()}>
      <AdminAuthFrame>{children}</AdminAuthFrame>
    </NextIntlClientProvider>
  );
}
