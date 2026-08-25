import { getLocale } from "next-intl/server";
import { loadCategoryPage } from "@/features/catalog";
import { CategoryBrowseView } from "./CategoryBrowseView";

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const categoryId = Number(id);
  const initial = await loadCategoryPage(locale, categoryId);
  return <CategoryBrowseView categoryId={categoryId} initial={initial} />;
}
