import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { permanentRedirect } from "@/i18n/navigation";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import { flattenCategories } from "@/lib/categories";
import { categoryPath, isLegacyNumericParam, matchCategoryParam } from "@/lib/routes";
import type { Category, CategoryContentPublic, CategoryShelvesResponse } from "@/lib/types";

/** Same path as the /categories layout's shell, so the call is a cache hit. */
const SHELVES_PATH = "/products/shelves?per_shelf=8";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const [tree, shelves] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<CategoryShelvesResponse>(SHELVES_PATH, locale),
  ]);
  const category = tree ? matchCategoryParam(slug, flattenCategories(tree)) : null;
  const content = category?.slug
    ? await fetchPublicJson<CategoryContentPublic>(`/categories/${encodeURIComponent(category.slug)}/content`, locale)
    : null;
  // An empty category is thin content: kept out of the index (and the
  // sitemap) until it lists a product. Unknown counts never noindex a page.
  const total = category && shelves ? shelves.category_totals?.[category.id] ?? 0 : null;
  // `categoriesTitle` already ends in "— GMMO": never wrap it in categoryTitle.
  return pageMetadata({
    title: category
      ? content?.seo_title || t("categoryTitle", { name: category.name })
      : t("categoryNotFoundTitle"),
    description: content?.seo_description
      || content?.description
      || t("categoryDescription", { name: category?.name ?? t("categoriesTitle") }),
    locale,
    path: category ? categoryPath(category) : `/categories/${slug}`,
    index: Boolean(category) && total !== 0,
  });
}

/** Resolves the slug before `loading.tsx` starts streaming, so an unknown
 *  category is a real 404, a legacy `/categories/12` a real 308 and a renamed
 *  slug (`category_redirects`, e.g. social → accounts) a real 308 to its new
 *  URL (inside the loading boundary all three would arrive as a 200). The
 *  tree is the same cached fetch the page makes; if it fails the page shows
 *  its load error. */
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
    if (!category) {
      const moved = isLegacyNumericParam(slug)
        ? null
        : await fetchPublicJson<{ slug: string }>(`/categories/${encodeURIComponent(slug)}/redirect`, locale);
      if (moved?.slug && moved.slug !== slug) {
        permanentRedirect({ href: `/categories/${encodeURIComponent(moved.slug)}`, locale });
      }
      notFound();
    }
    if (category.slug && category.slug !== slug) {
      permanentRedirect({ href: categoryPath(category), locale });
    }
  }
  return children;
}
