import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { loadSearchPage, parseSearchFilters, SearchResultsView } from "@/features/search";
import { pageMetadata } from "@/lib/seo";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "search.page" });
  const { q } = parseSearchFilters(await searchParams);
  // Result pages are never indexed: they are query-shaped and change per visitor.
  return pageMetadata({
    title: q ? t("metaTitle", { q }) : t("title"),
    description: q ? t("metaDescription", { q }) : t("emptyQuery"),
    locale,
    path: "/search",
    index: false,
  });
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const locale = await getLocale();
  const initial = await loadSearchPage(locale, await searchParams);
  return <SearchResultsView initial={initial} />;
}
