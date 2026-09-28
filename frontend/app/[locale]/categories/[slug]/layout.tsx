import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { permanentRedirect } from "@/i18n/navigation";
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
  // `categoriesTitle` already ends in "— GMMO": never wrap it in categoryTitle.
  return pageMetadata({
    title: category ? t("categoryTitle", { name: category.name }) : t("categoryNotFoundTitle"),
    description: t("categoryDescription", { name: category?.name ?? t("categoriesTitle") }),
    locale,
    path: category ? categoryPath(category) : `/categories/${slug}`,
    index: Boolean(category),
  });
}

/** Resolves the slug before `loading.tsx` starts streaming, so an unknown
 *  category is a real 404 and a legacy `/categories/12` a real 308 (inside
 *  the loading boundary both would arrive as a 200). The tree is the same
 *  cached fetch the page makes; if it fails the page shows its load error. */
export default async function CategorySlugLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const tree = await fetchPublicJson<Category[]>("/categories", locale);
  if (tree) {
    const category = matchCategoryParam(slug, flattenCategories(tree));
    if (!category) notFound();
    if (category.slug && category.slug !== slug) {
      permanentRedirect({ href: categoryPath(category), locale });
    }
  }
  return children;
}
