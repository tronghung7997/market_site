/** One mapping from the category page's URL state to the `/products` list
 *  call, shared by the server loader (first paint) and the client hook
 *  (every filter change after that) so the two can never drift. */

export const BROWSE_PER_PAGE = 24;

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

export type ProductListSort = "newest" | "bestseller" | "rating" | "price_asc" | "price_desc";

export type ProductListOpts = {
  categoryId: number;
  search?: string;
  inStock?: boolean;
  fulfillment?: "instant";
  minPrice?: number;
  maxPrice?: number;
  sort?: ProductListSort;
  page: number;
  perPage: number;
};

const SORTS: ProductListSort[] = ["bestseller", "rating", "price_asc", "price_desc"];

export function browsePage(raw: string | undefined): number {
  const requested = Number(raw);
  return Number.isInteger(requested) && requested > 0 ? requested : 1;
}

/** Price presets are VND tiers; a custom range arrives already converted to VND. */
export function browseQueryToListOpts(query: CategoryBrowseQuery, categoryId: number): ProductListOpts {
  const opts: ProductListOpts = { categoryId, page: browsePage(query.page), perPage: BROWSE_PER_PAGE };
  const search = query.q?.trim();
  if (search) opts.search = search;
  if (query.stock === "1") opts.inStock = true;
  if (query.instant === "1") opts.fulfillment = "instant";
  if (SORTS.includes(query.sort as ProductListSort)) opts.sort = query.sort as ProductListSort;
  if (query.price === "under1") opts.maxPrice = 24999;
  if (query.price === "1to2") {
    opts.minPrice = 25000;
    opts.maxPrice = 50000;
  }
  if (query.price === "above2") opts.minPrice = 50001;
  if (query.price === "custom") {
    const minVnd = Number(query.minVnd);
    const maxVnd = Number(query.maxVnd);
    if (Number.isFinite(minVnd) && minVnd >= 0 && query.minVnd) opts.minPrice = Math.round(minVnd);
    if (Number.isFinite(maxVnd) && maxVnd >= 0 && query.maxVnd) opts.maxPrice = Math.round(maxVnd);
  }
  return opts;
}

/** Query string for the backend `/products` endpoint (server-side loader). */
export function listOptsToSearchParams(opts: ProductListOpts): URLSearchParams {
  const params = new URLSearchParams({
    category_id: String(opts.categoryId),
    page: String(opts.page),
    per_page: String(opts.perPage),
  });
  if (opts.search) params.set("search", opts.search);
  if (opts.inStock) params.set("in_stock", "true");
  if (opts.fulfillment) params.set("fulfillment", opts.fulfillment);
  if (opts.minPrice != null) params.set("min_price", String(opts.minPrice));
  if (opts.maxPrice != null) params.set("max_price", String(opts.maxPrice));
  if (opts.sort) params.set("sort", opts.sort);
  return params;
}
