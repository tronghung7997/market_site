/** Browser-safe public interface of the catalog feature. `./index` re-exports
 *  the server loaders (`next/cache`, signed backend fetch), so client
 *  components import from here instead. */
export { useCategoryProducts } from "./data/useCategoryProducts";
export { browseKind, browseQueryToListOpts, browsePage, BROWSE_PER_PAGE, BROWSE_SORTS, DEFAULT_BROWSE_SORT, DELIVERY_KINDS, RATING_FILTERS } from "./data/browse-query";
export type { CategoryBrowseQuery, ProductListOpts, ProductListSort } from "./data/browse-query";
export { CategoryRail } from "./ui/CategoryRail";
export type { CategoryRailTotals } from "./ui/CategoryRail";
export { CatalogShell } from "./ui/CatalogShell";
export { OfferCard } from "./ui/OfferCard";
export { OfferGridSkeleton } from "./ui/OfferGridSkeleton";
export type { CatalogShellData } from "./ui/CatalogShell";
