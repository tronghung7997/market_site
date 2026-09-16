export { SearchProvider, useSearchPalette } from "./ui/SearchProvider";
export { HeaderSearch } from "./ui/HeaderSearch";
export { SearchResultsView } from "./ui/SearchResultsView";
// Server-only: `./data/load-search-page` signs backend requests (node:crypto).
// It is deliberately not re-exported here because TopNav (a client component)
// imports this barrel; webpack would pull the Node module into the browser bundle.
export type { SearchPageData } from "./data/load-search-page";
export {
  DEFAULT_SEARCH_FILTERS,
  parseCommand,
  parseSearchFilters,
  searchFiltersToQuery,
  searchPageHref,
  type SearchFilters,
  type SearchScope,
} from "./model";
