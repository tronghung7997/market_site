import { fetchPublicJson } from "@/lib/seo";
import { unstable_cache } from "next/cache";
import type { Category, PaginatedProducts, Product, ProductCatalogSummary, ProductDetail, SellerSummary } from "@/lib/types";

export type HomeCatalog = {
  categories: Category[];
  products: Product[];
  total: number;
  summary: ProductCatalogSummary | null;
  topSellers: SellerSummary[];
  error: string | null;
};

export type CategoryHubCatalog = {
  categories: Category[];
  products: Product[];
  total: number;
  error: string | null;
};

export type CategoryPageCatalog = {
  categories: Category[];
  products: Product[];
  total: number;
  page: number;
  perPage: number;
  error: string | null;
};

export type CategoryBrowseQuery = {
  q?: string;
  sort?: string;
  stock?: string;
  instant?: string;
  price?: string;
  minVnd?: string;
  maxVnd?: string;
  sub?: string;
  page?: string;
};

export type ProductPageCatalog = {
  product: ProductDetail | null;
  related: Product[];
  pricingStrategy: string;
  error: string | null;
};

const loadCachedCatalogSummary = unstable_cache(
  async (locale: string) => {
    const summary = await fetchPublicJson<ProductCatalogSummary>("/products/catalog-summary", locale);
    // Do not cache rollout/network failures as an all-zero advertising metric.
    if (!summary) throw new Error("Catalog summary is unavailable");
    return summary;
  },
  ["public-catalog-summary-v1"],
  { revalidate: 600, tags: ["public-catalog-summary"] },
);

export async function loadHomeCatalog(locale: string): Promise<HomeCatalog> {
  const [categories, products, summary, topSellers] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>("/products?page=1&per_page=24", locale),
    loadCachedCatalogSummary(locale).catch(() => null),
    fetchPublicJson<SellerSummary[]>("/sellers/top?limit=6", locale),
  ]);
  if (!categories || !products) {
    return { categories: categories ?? [], products: [], total: 0, summary: null, topSellers: topSellers ?? [], error: "load" };
  }
  return {
    categories,
    products: products.items,
    total: products.total,
    summary,
    topSellers: topSellers ?? [],
    error: null,
  };
}

export async function loadCategoryHub(locale: string): Promise<CategoryHubCatalog> {
  const [categories, products] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>("/products?page=1&per_page=100", locale),
  ]);
  if (!categories || !products) {
    return { categories: categories ?? [], products: [], total: 0, error: "load" };
  }
  return { categories, products: products.items, total: products.total, error: null };
}

export async function loadCategoryPage(
  locale: string,
  categoryId: number,
  query: CategoryBrowseQuery = {},
): Promise<CategoryPageCatalog> {
  const requestedPage = Number(query.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedSub = Number(query.sub);
  const effectiveCategoryId = Number.isInteger(requestedSub) && requestedSub > 0 ? requestedSub : categoryId;
  const params = new URLSearchParams({
    category_id: String(effectiveCategoryId),
    page: String(page),
    per_page: "24",
  });
  if (query.q?.trim()) params.set("search", query.q.trim());
  if (query.stock === "1") params.set("in_stock", "true");
  if (query.instant === "1") params.set("fulfillment", "instant");
  if (["bestseller", "rating", "price_asc", "price_desc"].includes(query.sort ?? "")) {
    params.set("sort", query.sort!);
  }
  if (query.price === "under1") params.set("max_price", "24999");
  if (query.price === "1to2") {
    params.set("min_price", "25000");
    params.set("max_price", "50000");
  }
  if (query.price === "above2") params.set("min_price", "50001");
  if (query.price === "custom") {
    const minVnd = Number(query.minVnd);
    const maxVnd = Number(query.maxVnd);
    if (Number.isFinite(minVnd) && minVnd >= 0) params.set("min_price", String(Math.round(minVnd)));
    if (Number.isFinite(maxVnd) && maxVnd >= 0) params.set("max_price", String(Math.round(maxVnd)));
  }
  const [categories, products] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>(`/products?${params}`, locale),
  ]);
  if (!categories || !products) {
    return { categories: categories ?? [], products: [], total: 0, page, perPage: 24, error: "load" };
  }
  return {
    categories,
    products: products.items,
    total: products.total,
    page: products.page,
    perPage: products.per_page,
    error: null,
  };
}

export async function loadProductPage(locale: string, productId: number): Promise<ProductPageCatalog> {
  const product = await fetchPublicJson<ProductDetail>(`/products/${productId}`, locale);
  if (!product) {
    return { product: null, related: [], pricingStrategy: "fixed", error: "missing" };
  }
  let related: Product[] = [];
  if (product.category_id) {
    const page1 = await fetchPublicJson<PaginatedProducts>(
      `/products?category_id=${product.category_id}&page=1&per_page=24`,
      locale,
    );
    const seen = new Set<string>();
    related = (page1?.items ?? []).filter((row) => {
      if (row.id === product.id) return false;
      if (row.title === product.title) return false;
      if (row.title.length < 3) return false;
      if (seen.has(row.title)) return false;
      seen.add(row.title);
      return true;
    }).slice(0, 3);
  }
  return {
    product,
    related,
    pricingStrategy: product.pricing_strategy ?? "fixed",
    error: null,
  };
}
