import { getLocale } from "next-intl/server";
import { HomeCatalogView, loadHomeCatalog } from "@/features/catalog";

/** The landing page. ("/" can open the catalog instead: `CATALOG_IS_HOME` in proxy.ts.) */
export default async function HomePage() {
  const locale = await getLocale();
  const initial = await loadHomeCatalog(locale);
  return <HomeCatalogView initial={initial} />;
}
