import { Suspense } from "react";
import { getLocale } from "next-intl/server";
import { loadCatalogAll } from "@/features/catalog";
import { CategoryBrowseView } from "../[slug]/CategoryBrowseView";
import { browseQueryFromSearchParams } from "../browse-params";

/** "Tất cả": every offer in one grid, with the same toolbar as a category. */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getLocale();
  const initial = await loadCatalogAll(locale, browseQueryFromSearchParams(await searchParams));
  return (
    <Suspense>
      <CategoryBrowseView categoryId={null} initial={initial} />
    </Suspense>
  );
}
