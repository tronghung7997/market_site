"use client";

/** A first-order nudge: the marketplace's best sellers right now. */

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { productPath } from "@/lib/routes";
import { parseCoverId, ProductCover } from "@/features/product-covers";

export function SuggestedProducts() {
  const t = useTranslations("buyerOrders");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const products = useQuery({
    queryKey: ["products", "bestseller", 4],
    queryFn: () => api.products({ sort: "bestseller", perPage: 4 }),
    staleTime: 5 * 60_000,
  });
  const items = products.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="orders-suggest" className="border-t border-line px-4 py-5 text-left sm:px-5">
      <h3 id="orders-suggest" className="text-[13px] font-semibold text-fg">{t("suggestTitle")}</h3>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((product) => {
          const price = effectiveMinPrice(product);
          return (
            <li key={product.id}>
              <Link href={productPath(product)} className="flex items-center gap-2.5 rounded-lg border border-line bg-surface p-2.5 hover:border-line-2">
                <ProductCover coverId={parseCoverId(product)} image={product.images?.cover} title={product.title} className="h-9 w-9 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-fg">{product.title}</span>
                  {price != null && (
                    <span className="block font-mono text-[11.5px] text-muted">{t("suggestFrom", { price: formatBrowseMoney(price, { locale }) })}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
