import { getLocale } from "next-intl/server";
import { fetchPublicJson } from "@/lib/seo";
import { productPath, type ProductRef } from "@/lib/routes";
import SolutionsView, { type SolutionKey } from "./SolutionsView";

/** The two service products this landing page sells. Ids are stable seed
 *  data; the storefront link is the product's slug-key URL, resolved here on
 *  the server so the HTML ships with the final address (and the legacy id
 *  still works as a fallback when the catalog is unreachable). */
const SOLUTION_PRODUCT_IDS: Record<SolutionKey, number> = {
  scraper: 39,
  takedown: 40,
};

export default async function SolutionsPage() {
  const locale = await getLocale();
  const entries = await Promise.all(
    (Object.entries(SOLUTION_PRODUCT_IDS) as [SolutionKey, number][]).map(async ([key, id]) => {
      const product = await fetchPublicJson<ProductRef>(`/products/${id}`, locale);
      return [key, productPath(product ?? { id })] as const;
    }),
  );
  const hrefs = Object.fromEntries(entries) as Record<SolutionKey, string>;
  return <SolutionsView hrefs={hrefs} />;
}
