import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

/** The storefront opens on the catalog: "/" is Danh mục. */
export default async function HomePage() {
  redirect({ href: "/categories", locale: await getLocale() });
}
