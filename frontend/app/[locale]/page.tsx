import { getLocale } from "next-intl/server";
import { HomeCatalogView, loadHomeCatalog } from "@/features/catalog";

export default async function HomePage() {
  const locale = await getLocale();
  const initial = await loadHomeCatalog(locale);
  return <HomeCatalogView initial={initial} />;
}
