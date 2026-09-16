import { Suspense } from "react";
import { permanentRedirect } from "@/i18n/navigation";
import { loadCategoryPage } from "@/features/catalog";
import { categoryPath } from "@/lib/routes";
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
    price: first(rawQuery.price),
    minVnd: first(rawQuery.min_vnd),
    maxVnd: first(rawQuery.max_vnd),
    sub: first(rawQuery.sub),
    page: first(rawQuery.page),
  });
  // Legacy `/categories/12` links resolve by id, then move to the slug URL.
  if (initial.category && initial.category.slug !== slug) {
    permanentRedirect({ href: categoryPath(initial.category), locale });
  }
  return (
    <Suspense>
      <CategoryBrowseView categoryId={initial.category?.id ?? 0} initial={initial} />
    </Suspense>
  );
}
