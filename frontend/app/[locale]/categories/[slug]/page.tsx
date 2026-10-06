import { Suspense } from "react";
import { loadCategoryPage } from "@/features/catalog";
import { CategoryBrowseView } from "./CategoryBrowseView";
import { browseQueryFromSearchParams } from "../browse-params";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  const initial = await loadCategoryPage(locale, slug, browseQueryFromSearchParams(await searchParams));
  // Unknown slugs (404) and legacy id links (308) are settled in layout.tsx.
  return (
    <Suspense>
      <CategoryBrowseView categoryId={initial.category?.id ?? 0} initial={initial} />
    </Suspense>
  );
}
