import { getLocale, getTranslations } from "next-intl/server";
import { HomeCatalogView, loadHomeCatalog } from "@/features/catalog";
import { jsonLdHtml } from "@/lib/json-ld";
import { localePath, siteOrigin } from "@/lib/seo";
import { siteJsonLd } from "@/lib/structured-data";

/** The landing page. ("/" can open the catalog instead: `CATALOG_IS_HOME` in proxy.ts.) */
export default async function HomePage() {
  const locale = await getLocale();
  const [initial, t] = await Promise.all([loadHomeCatalog(locale), getTranslations({ locale, namespace: "metadata" })]);
  const origin = siteOrigin();
  // Organization + WebSite with the sitelinks search box on the real search page.
  const jsonLd = siteJsonLd({
    origin,
    homeUrl: `${origin}${localePath(locale)}`,
    searchUrl: `${origin}${localePath(locale, "/search")}?q={search_term_string}`,
    logoUrl: `${origin}/brand/gmmo-mark.svg`,
    description: t("description"),
  });
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <HomeCatalogView initial={initial} />
    </>
  );
}
