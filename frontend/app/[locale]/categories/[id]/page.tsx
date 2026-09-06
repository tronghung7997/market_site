import { Suspense } from "react";
import { getLocale } from "next-intl/server";
import { loadCategoryPage } from "@/features/catalog";
import { CategoryBrowseView } from "./CategoryBrowseView";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawQuery = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const locale = await getLocale();
  const categoryId = Number(id);
  const initial = await loadCategoryPage(locale, categoryId, {
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
  return (
    <Suspense>
      <CategoryBrowseView categoryId={categoryId} initial={initial} />
    </Suspense>
  );
}
