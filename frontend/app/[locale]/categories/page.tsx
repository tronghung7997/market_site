import { getLocale } from "next-intl/server";
import { loadCategoryHub } from "@/features/catalog";
import { CategoryHubView } from "./CategoryHubView";

export default async function CategoriesPage() {
  const locale = await getLocale();
  const initial = await loadCategoryHub(locale);
  return <CategoryHubView initial={initial} />;
}
