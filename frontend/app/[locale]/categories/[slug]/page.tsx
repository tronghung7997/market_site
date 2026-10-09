import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { loadCategoryPage } from "@/features/catalog";
import type { CategoryPageCatalog } from "@/features/catalog";
import { flattenCategories } from "@/lib/categories";
import { jsonLdHtml } from "@/lib/json-ld";
import { categoryPath, productPath } from "@/lib/routes";
import { localePath, siteOrigin } from "@/lib/seo";
import { categoryJsonLd, SITE_NAME, type Crumb } from "@/lib/structured-data";
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
  const jsonLd = await categoryStructuredData(locale, initial);
  // Unknown slugs (404), legacy id links and renamed slugs (308) are settled in layout.tsx.
  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />}
      <Suspense>
        <CategoryBrowseView categoryId={initial.category?.id ?? 0} initial={initial} />
      </Suspense>
    </>
  );
}

/** BreadcrumbList (home › categories › parent › this) and the ItemList of
 *  the offers the first page lists. */
async function categoryStructuredData(locale: string, initial: CategoryPageCatalog) {
  const category = initial.category;
  if (!category) return null;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const origin = siteOrigin();
  const abs = (path: string) => `${origin}${localePath(locale, path)}`;
  const flat = flattenCategories(initial.categories);
  const ancestors: typeof flat = [];
  for (let parent = flat.find((c) => c.id === category.parent_id); parent; parent = flat.find((c) => c.id === parent?.parent_id)) {
    if (ancestors.includes(parent)) break;
    ancestors.unshift(parent);
  }
  const crumbs: Crumb[] = [
    { name: SITE_NAME, url: abs("/") },
    { name: t("breadcrumbCategories"), url: abs("/categories") },
    ...[...ancestors, category].map((node) => ({ name: node.name, url: abs(categoryPath(node)) })),
  ];
  return categoryJsonLd({
    crumbs,
    name: category.name,
    url: abs(categoryPath(category)),
    items: (initial.result?.items ?? []).map((product) => ({ name: product.title, url: abs(productPath(product)) })),
  });
}
