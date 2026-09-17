import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { sellerMessages } from "@/i18n/client-messages";

/** Every seller route (console, apply, workbench) gets the seller namespaces
 *  on top of the storefront ones the root layout provides. */
export default async function SellerLayout({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider messages={sellerMessages(await getMessages())}>{children}</NextIntlClientProvider>;
}
