/** Browser-safe public interface of the catalog feature. `./index` re-exports
 *  the server loaders (`next/cache`, signed backend fetch), so client
 *  components import from here instead. */
export { useCategoryProducts } from "./data/useCategoryProducts";
export { browseQueryToListOpts, browsePage, BROWSE_PER_PAGE } from "./data/browse-query";
export type { CategoryBrowseQuery, ProductListOpts, ProductListSort } from "./data/browse-query";
export { CategoryRail } from "./ui/CategoryRail";
export type { CategoryRailTotals } from "./ui/CategoryRail";
