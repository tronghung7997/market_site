import { Suspense } from "react";
import { loadCategoryPage } from "@/features/catalog";
import { CategoryBrowseView } from "./CategoryBrowseView";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  const rawQuery = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const initial = await loadCategoryPage(locale, slug, {
    q: first(rawQuery.q),
    sort: first(rawQuery.sort),
    stock: first(rawQuery.stock),
    instant: first(rawQuery.instant),
    kind: first(rawQuery.kind),
    price: first(rawQuery.price),
    minVnd: first(rawQuery.min_vnd),
    maxVnd: first(rawQuery.max_vnd),
    rating: first(rawQuery.rating),
    sub: first(rawQuery.sub),
    page: first(rawQuery.page),
  });
  // Unknown slugs (404) and legacy id links (308) are settled in layout.tsx.
  return (
    <Suspense>
      <CategoryBrowseView categoryId={initial.category?.id ?? 0} initial={initial} />
    </Suspense>
  );
}
