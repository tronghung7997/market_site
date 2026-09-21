export { HomeCatalogView } from "./ui/HomeCatalog";
export {
  loadCategoryHub,
  loadCategoryPage,
  loadHomeCatalog,
  loadProductPage,
  loadSellerPage,
} from "./data/load-public";
// Client components use `@/features/catalog/client`: this barrel carries the
// server loaders (`next/cache`, signed backend fetch) and must not reach the
// browser bundle.
export type { ProductListOpts, ProductListSort } from "./data/browse-query";
export type {
  CategoryHubCatalog,
  CategoryBrowseQuery,
  CategoryPageCatalog,
  CategoryShelfTotals,
  HomeCatalog,
  ProductPageCatalog,
  SellerPageCatalog,
} from "./data/load-public";
