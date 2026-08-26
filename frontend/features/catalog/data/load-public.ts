import { fetchPublicJson } from "@/lib/seo";
import type { Category, PaginatedProducts, Product, ProductDetail, SellerSummary } from "@/lib/types";

export type HomeCatalog = {
  categories: Category[];
  products: Product[];
  topSellers: SellerSummary[];
  error: string | null;
};

export type CategoryHubCatalog = {
  categories: Category[];
  products: Product[];
  error: string | null;
};

export type CategoryPageCatalog = {
  categories: Category[];
  products: Product[];
  error: string | null;
};

export type ProductPageCatalog = {
  product: ProductDetail | null;
  related: Product[];
  pricingStrategy: string;
  error: string | null;
};

export async function loadHomeCatalog(locale: string): Promise<HomeCatalog> {
  const [categories, products, topSellers] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>("/products?page=1&per_page=100", locale),
    fetchPublicJson<SellerSummary[]>("/sellers/top?limit=6", locale),
  ]);
  if (!categories || !products) {
    return { categories: categories ?? [], products: [], topSellers: topSellers ?? [], error: "load" };
  }
  return {
    categories,
    products: products.items,
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
    return { categories: categories ?? [], products: [], error: "load" };
  }
  return { categories, products: products.items, error: null };
}

export async function loadCategoryPage(locale: string, categoryId: number): Promise<CategoryPageCatalog> {
  const [categories, products] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>(`/products?category_id=${categoryId}&page=1&per_page=100`, locale),
  ]);
  if (!categories || !products) {
    return { categories: categories ?? [], products: [], error: "load" };
  }
  return { categories, products: products.items, error: null };
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
