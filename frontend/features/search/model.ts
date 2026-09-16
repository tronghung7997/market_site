/**
 * Pure search-domain logic shared by the command palette and the /search page.
 *
 * - `parseCommand()` turns raw palette input into a scope + term: Linear-style
 *   prefixes (`#` categories, `@` sellers, `>` commands) and direct references
 *   (an order code, a pasted same-origin path) are recognised here, never in JSX.
 * - `parseSearchFilters()` / `searchFiltersToQuery()` are the URL ⇄ state seam
 *   for the results page: unknown values fall back to defaults.
 * - Recent-search helpers are pure list operations; storage lives in the UI.
 * - `matchesLabel()` is the client-side matcher for quick actions.
 */

// Relative + extension so the pure model also runs under node --test (see seller-workbench/logic.ts).
import { normalizeOrderCode } from "../../lib/order-ref.ts";

export type SearchScope = "all" | "categories" | "sellers" | "actions";

export type DirectRef =
  | { kind: "order"; code: string; href: string }
  | { kind: "path"; href: string };

export type ParsedCommand = {
  scope: SearchScope;
  /** Query with the scope prefix removed and whitespace collapsed. */
  term: string;
  direct: DirectRef | null;
};

export const SEARCH_SCOPE_PREFIX: Record<Exclude<SearchScope, "all">, string> = {
  categories: "#",
  sellers: "@",
  actions: ">",
};

export const MAX_QUERY_LENGTH = 80;

export function normalizeTerm(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

/** Lower-case, diacritic-free text for client-side matching ("Tài khoản" → "tai khoan"). */
export function foldText(value: string): string {
  return value
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function directRef(term: string): DirectRef | null {
  if (!term) return null;
  // Bare eight-letter words ("facebook") are searches, not codes: without the
  // ORD-/# prefix a code must contain a digit to be treated as one.
  // (`#` is the category scope prefix in the palette, so only ORD- is explicit here.)
  const explicitCode = /^ord-/i.test(term);
  const code = normalizeOrderCode(term);
  if (code && (explicitCode || /\d/.test(term))) return { kind: "order", code, href: `/orders/${code}` };
  // A pasted absolute path (`/products/…`) or same-origin URL opens directly.
  // Only single-segment-safe paths are accepted: no scheme-relative or external hosts.
  if (term.startsWith("/") && !term.startsWith("//") && !/\s/.test(term)) {
    return { kind: "path", href: stripLocalePrefix(term) };
  }
  const url = parseSameOriginUrl(term);
  if (url) return { kind: "path", href: stripLocalePrefix(url) };
  return null;
}

function parseSameOriginUrl(term: string): string | null {
  if (!/^https?:\/\//i.test(term)) return null;
  try {
    const url = new URL(term);
    if (typeof window !== "undefined" && url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function stripLocalePrefix(path: string): string {
  return path.replace(/^\/(en|vi)(?=\/|$)/, "") || "/";
}

export function parseCommand(raw: string): ParsedCommand {
  const input = raw.replace(/^\s+/, "");
  const first = input.charAt(0);
  let scope: SearchScope = "all";
  let rest = input;
  if (first === SEARCH_SCOPE_PREFIX.categories) {
    scope = "categories";
    rest = input.slice(1);
  } else if (first === SEARCH_SCOPE_PREFIX.sellers) {
    scope = "sellers";
    rest = input.slice(1);
  } else if (first === SEARCH_SCOPE_PREFIX.actions) {
    scope = "actions";
    rest = input.slice(1);
  }
  const term = normalizeTerm(rest);
  return { scope, term, direct: scope === "all" ? directRef(term) : null };
}

/** True when `needle` matches `label` or any keyword: prefix, word start, substring or in-order subsequence. */
export function matchesLabel(needle: string, label: string, keywords: readonly string[] = []): boolean {
  const q = foldText(normalizeTerm(needle));
  if (!q) return true;
  const haystacks = [label, ...keywords].map(foldText);
  if (haystacks.some((h) => h.includes(q))) return true;
  // Subsequence match on the label only ("sdb" → "seller dashboard").
  const compact = q.replace(/\s+/g, "");
  if (compact.length < 2) return false;
  const label0 = foldText(label);
  let i = 0;
  for (const ch of label0) {
    if (ch === compact[i]) i += 1;
    if (i === compact.length) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Results page URL state
// ---------------------------------------------------------------------------

export const SEARCH_SORTS = ["relevance", "newest", "bestseller", "rating", "price_asc", "price_desc"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export type SearchFilters = {
  q: string;
  sort: SearchSort;
  inStock: boolean;
  instant: boolean;
  categoryId: number | null;
  page: number;
};

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  q: "",
  sort: "relevance",
  inStock: false,
  instant: false,
  categoryId: null,
  page: 1,
};

export const SEARCH_PAGE_SIZE = 24;

function first(value: string | string[] | null | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

export type RawSearchQuery = Record<string, string | string[] | undefined> | URLSearchParams;

function read(raw: RawSearchQuery, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  return first(raw[key]);
}

export function parseSearchFilters(raw: RawSearchQuery): SearchFilters {
  const sort = read(raw, "sort");
  const page = Number(read(raw, "page"));
  const categoryId = Number(read(raw, "cat"));
  return {
    q: normalizeTerm(read(raw, "q") ?? ""),
    sort: (SEARCH_SORTS as readonly string[]).includes(sort ?? "") ? (sort as SearchSort) : "relevance",
    inStock: read(raw, "stock") === "1",
    instant: read(raw, "instant") === "1",
    categoryId: Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Query string for the results page; defaults are omitted so URLs stay short. */
export function searchFiltersToQuery(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  if (filters.inStock) params.set("stock", "1");
  if (filters.instant) params.set("instant", "1");
  if (filters.categoryId) params.set("cat", String(filters.categoryId));
  if (filters.page > 1) params.set("page", String(filters.page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function searchPageHref(filters: Partial<SearchFilters> & { q: string }): string {
  return `/search${searchFiltersToQuery({ ...DEFAULT_SEARCH_FILTERS, ...filters })}`;
}

/** Backend query string for GET /search from the page filters. */
export function searchFiltersToApiQuery(filters: SearchFilters): string {
  const params = new URLSearchParams({ q: filters.q, page: String(filters.page), per_page: String(SEARCH_PAGE_SIZE) });
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  if (filters.inStock) params.set("in_stock", "true");
  if (filters.instant) params.set("fulfillment", "instant");
  if (filters.categoryId) params.set("category_id", String(filters.categoryId));
  return params.toString();
}

// ---------------------------------------------------------------------------
// Recent searches (pure list ops; the UI owns localStorage)
// ---------------------------------------------------------------------------

export const RECENT_SEARCHES_LIMIT = 6;

export function pushRecentSearch(list: readonly string[], term: string, limit = RECENT_SEARCHES_LIMIT): string[] {
  const value = normalizeTerm(term);
  if (!value) return [...list];
  const key = foldText(value);
  const rest = list.filter((item) => foldText(item) !== key);
  return [value, ...rest].slice(0, limit);
}

export function removeRecentSearch(list: readonly string[], term: string): string[] {
  const key = foldText(normalizeTerm(term));
  return list.filter((item) => foldText(item) !== key);
}

export function sanitizeRecentSearches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const term = normalizeTerm(item);
    if (term && !out.some((existing) => foldText(existing) === foldText(term))) out.push(term);
    if (out.length >= RECENT_SEARCHES_LIMIT) break;
  }
  return out;
}
