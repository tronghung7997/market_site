import type { MetadataRoute } from "next";
import { fetchPublicJson, isGoogleIndexingEnabled, localePath, siteOrigin } from "@/lib/seo";
import { categoryPath, productPath, sellerPath } from "@/lib/routes";

type CategoryNode = { id: number; slug: string; children?: CategoryNode[] };
type ProductRow = { id: number; slug: string; public_key: string; canonical_path?: string | null };
type ProductPage = { items: ProductRow[]; total: number; page: number; per_page: number };

function flattenCategories(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.children?.length) out.push(...flattenCategories(node.children));
  }
  return out;
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
  for (const category of flattenCategories(categories ?? [])) {
    for (const locale of locales) {
      entries.push({
        url: `${origin}${localePath(locale, categoryPath(category))}`,
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
          url: `${origin}${localePath(locale, productPath(product))}`,
          lastModified: now,
          changeFrequency: "daily",
          priority: 0.8,
        });
      }
    }
    page += 1;
    if (batch.items.length === 0) break;
  }

  const sellers = await fetchPublicJson<{ public_key: string; handle: string | null; canonical_path: string }[]>("/sellers/top?limit=20", "vi");
  for (const seller of sellers ?? []) {
    for (const locale of locales) {
      entries.push({
        url: `${origin}${localePath(locale, sellerPath(seller))}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  }

  return entries;
}
