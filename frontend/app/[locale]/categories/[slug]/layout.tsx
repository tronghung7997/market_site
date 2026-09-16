import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import { flattenCategories } from "@/lib/categories";
import { categoryPath, matchCategoryParam } from "@/lib/routes";
import type { Category } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const tree = await fetchPublicJson<Category[]>("/categories", locale);
  const category = tree ? matchCategoryParam(slug, flattenCategories(tree)) : null;
  const name = category?.name ?? t("categoriesTitle");
  return pageMetadata({
    title: t("categoryTitle", { name }),
    description: t("categoryDescription", { name }),
    locale,
    path: category ? categoryPath(category) : `/categories/${slug}`,
    index: Boolean(category),
  });
}

export default function CategorySlugLayout({ children }: { children: ReactNode }) {
  return children;
}
