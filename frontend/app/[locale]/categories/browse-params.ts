import type { CategoryBrowseQuery } from "@/features/catalog";

/** The browse page's URL state, as the server loaders take it. */
export function browseQueryFromSearchParams(raw: Record<string, string | string[] | undefined>): CategoryBrowseQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return {
    q: first(raw.q),
    sort: first(raw.sort),
    stock: first(raw.stock),
    instant: first(raw.instant),
    kind: first(raw.kind),
    price: first(raw.price),
    minVnd: first(raw.min_vnd),
    maxVnd: first(raw.max_vnd),
    rating: first(raw.rating),
    sub: first(raw.sub),
    shop: first(raw.shop),
    page: first(raw.page),
  };
}
