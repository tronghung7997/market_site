/** One mapping from the category page's URL state to the `/products` list
 *  call, shared by the server loader (first paint) and the client hook
 *  (every filter change after that) so the two can never drift. */

export const BROWSE_PER_PAGE = 24;

export type CategoryBrowseQuery = {
  q?: string;
  sort?: string;
  stock?: string;
  /** Legacy `instant=1` links; same as `kind=instant`. */
  instant?: string;
  /** Delivery kind the cards are tagged with: instant, sla, api, task, proxy. */
  kind?: string;
  price?: string;
  minVnd?: string;
  maxVnd?: string;
  /** Minimum average stars, "3" or "4"; anything else is ignored. */
  rating?: string;
  sub?: string;
  /** One shop's offers only: the seller's `{handle}-{key}` or bare key. */
  shop?: string;
  page?: string;
};

export type ProductListSort =
  | "newest" | "bestseller" | "rating" | "price_asc" | "price_desc" | "shop_sales" | "shop_rating";

export type ProductListOpts = {
  /** Category branch; none = the whole catalog ("Tất cả"). */
  categoryId?: number;
  seller?: string;
  search?: string;
  inStock?: boolean;
  fulfillment?: DeliveryKind;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  sort?: ProductListSort;
  page: number;
  perPage: number;
};

/** Delivery kinds a buyer can filter by — the same tags the cards show. */
export const DELIVERY_KINDS = ["instant", "sla", "api", "proxy", "task"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

/** Star filters the category page offers. */
export const RATING_FILTERS = ["4", "3"] as const;

export const BROWSE_SORTS: ProductListSort[] = ["bestseller", "shop_sales", "shop_rating", "rating", "newest", "price_asc", "price_desc"];

/** A shop ref as the API takes it: `{handle}-{key}` or a bare 8-char key. */
const SHOP_REF = /^[a-z0-9-]{1,80}$/;

/** Best sellers first unless the buyer picks another order (same as the home page). */
export const DEFAULT_BROWSE_SORT: ProductListSort = "bestseller";

/** `kind`, or the legacy `instant=1` flag; unknown values mean no filter. */
export function browseKind(query: Pick<CategoryBrowseQuery, "kind" | "instant">): DeliveryKind | null {
  if ((DELIVERY_KINDS as readonly string[]).includes(query.kind ?? "")) return query.kind as DeliveryKind;
  return query.instant === "1" ? "instant" : null;
}

export function browsePage(raw: string | undefined): number {
  const requested = Number(raw);
  return Number.isInteger(requested) && requested > 0 ? requested : 1;
}

/** Price presets are VND tiers; a custom range arrives already converted to VND. */
export function browseQueryToListOpts(query: CategoryBrowseQuery, categoryId: number | null): ProductListOpts {
  const opts: ProductListOpts = { page: browsePage(query.page), perPage: BROWSE_PER_PAGE };
  if (categoryId) opts.categoryId = categoryId;
  const shop = query.shop?.trim().toLowerCase();
  if (shop && SHOP_REF.test(shop)) opts.seller = shop;
  const search = query.q?.trim();
  if (search) opts.search = search;
  if (query.stock === "1") opts.inStock = true;
  const kind = browseKind(query);
  if (kind) opts.fulfillment = kind;
  opts.sort = BROWSE_SORTS.includes(query.sort as ProductListSort) ? query.sort as ProductListSort : DEFAULT_BROWSE_SORT;
  if (query.price === "under1") opts.maxPrice = 24999;
  if (query.price === "1to2") {
    opts.minPrice = 25000;
    opts.maxPrice = 50000;
  }
  if (query.price === "above2") opts.minPrice = 50001;
  if ((RATING_FILTERS as readonly string[]).includes(query.rating ?? "")) opts.minRating = Number(query.rating);
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
  const params = new URLSearchParams({ page: String(opts.page), per_page: String(opts.perPage) });
  if (opts.categoryId) params.set("category_id", String(opts.categoryId));
  if (opts.seller) params.set("seller", opts.seller);
  if (opts.search) params.set("search", opts.search);
  if (opts.inStock) params.set("in_stock", "true");
  if (opts.fulfillment) params.set("fulfillment", opts.fulfillment);
  if (opts.minPrice != null) params.set("min_price", String(opts.minPrice));
  if (opts.maxPrice != null) params.set("max_price", String(opts.maxPrice));
  if (opts.minRating) params.set("min_rating", String(opts.minRating));
  if (opts.sort) params.set("sort", opts.sort);
  return params;
}
