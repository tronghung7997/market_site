import type { MetadataRoute } from "next";
import { fetchPublicJson, isGoogleIndexingEnabled, localePath, siteOrigin } from "@/lib/seo";

type CategoryNode = { id: number; children?: CategoryNode[] };
type ProductPage = { items: { id: number }[]; total: number; page: number; per_page: number };

function flattenCategories(nodes: CategoryNode[]): number[] {
  const ids: number[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    if (node.children?.length) ids.push(...flattenCategories(node.children));
  }
  return ids;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isGoogleIndexingEnabled()) return [];

  const origin = siteOrigin();
  const locales = ["en", "vi"] as const;
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  const staticPaths = ["/", "/categories", "/legal/terms", "/legal/privacy", "/legal/escrow"];
  for (const locale of locales) {
    for (const path of staticPaths) {
      entries.push({
        url: `${origin}${localePath(locale, path)}`,
        lastModified: now,
        changeFrequency: path === "/" ? "daily" : "weekly",
        priority: path === "/" ? 1 : 0.6,
      });
    }
  }

  const categories = await fetchPublicJson<CategoryNode[]>("/categories", "vi");
  for (const id of flattenCategories(categories ?? [])) {
    for (const locale of locales) {
      entries.push({
        url: `${origin}${localePath(locale, `/categories/${id}`)}`,
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  }

  let page = 1;
  let total = 1;
  while ((page - 1) * 100 < total && page <= 50) {
    const batch = await fetchPublicJson<ProductPage>(`/products?page=${page}&per_page=100`, "vi");
    if (!batch) break;
    total = batch.total;
    for (const product of batch.items) {
      for (const locale of locales) {
        entries.push({
          url: `${origin}${localePath(locale, `/products/${product.id}`)}`,
          lastModified: now,
          changeFrequency: "daily",
          priority: 0.8,
        });
      }
    }
    page += 1;
    if (batch.items.length === 0) break;
  }

  return entries;
}
