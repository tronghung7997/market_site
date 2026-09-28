import { Suspense, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";
import { loadCategoryShell } from "@/features/catalog";
import { CatalogShell } from "@/features/catalog/client";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return pageMetadata({
    title: t("categoriesTitle"),
    description: t("categoriesDescription"),
    locale,
    path: "/categories",
  });
}

/** Header + category rail for the hub and every category page. Being the
 *  layout above `[slug]`, it stays mounted when the buyer moves to another
 *  category; only the page (the product pane) is swapped. */
export default async function CategoriesLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const shell = await loadCategoryShell(locale);
  // Without the tree there is nothing to frame; the page shows its load error.
  if (shell.error && shell.categories.length === 0) return children;
  return (
    <Suspense>
      <CatalogShell data={shell}>{children}</CatalogShell>
    </Suspense>
  );
}
