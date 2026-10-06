"use client";

/** Shops above the offer grid. While the buyer searches, the shops whose name
 *  matches the query; on "Tất cả" without a search, the shops buyers order
 *  from most. Each card narrows the grid to that shop or opens the shop. */

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { sellerPath } from "@/lib/routes";
import type { SellerSummary } from "@/lib/types";
import { Monogram } from "@/components/ui";
import { MediaImage } from "@/components/media/MediaImage";
import { Star } from "@/components/Icons";

/** Shorter queries match too much to be worth a shop row. */
const MIN_SHOP_QUERY = 2;

export function ShopStrip({
  query,
  topShops,
  onPick,
}: {
  query: string;
  topShops: SellerSummary[];
  onPick: (ref: string, name: string) => void;
}) {
  const t = useTranslations("categories.shops");
  const locale = useLocale();
  const searching = query.length >= MIN_SHOP_QUERY;
  const matches = useQuery({
    queryKey: queryKeys.searchSuggest(locale, query),
    queryFn: ({ signal }) => api.searchSuggest(query, { signal }),
    enabled: searching,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const shops = searching ? matches.data?.sellers ?? [] : topShops;
  if (shops.length === 0) return null;

  return (
    <section aria-labelledby="shop-strip-title" className="mt-4">
      <h2 id="shop-strip-title" className="mb-2 text-[13px] font-semibold text-fg">
        {searching ? t("matching", { q: query }) : t("top")}
      </h2>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:thin]">
        {shops.map((shop) => {
          const ref = shop.handle ? `${shop.handle}-${shop.public_key}` : shop.public_key;
          const name = shop.display_name;
          const rated = shop.rating_avg != null && shop.review_count > 0;
          return (
            <li key={shop.public_key} className="w-[260px] shrink-0 snap-start">
              <div className="flex h-full flex-col gap-3 rounded-card border border-line bg-card p-3.5 shadow-card">
                <div className="flex items-center gap-2.5 min-w-0">
                  {shop.logo ? (
                    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-line bg-raised">
                      <MediaImage image={shop.logo} alt="" className="h-full w-full" fallback={<Monogram text={name} className="h-full w-full rounded-full" />} />
                    </span>
                  ) : (
                    <Monogram text={name} className="h-10 w-10 rounded-full" />
                  )}
                  <div className="min-w-0">
                    <Link href={sellerPath(shop)} className="block truncate text-[14px] font-semibold text-fg hover:text-iris-hi">
                      {name}
                    </Link>
                    <div className="flex items-center gap-1.5 text-[12px] text-muted">
                      {rated && (
                        <span className="inline-flex items-center gap-0.5">
                          <Star size={11} className="text-warn fill-warn" aria-hidden="true" />
                          <span className="font-medium text-fg">{shop.rating_avg!.toFixed(1)}</span>
                          <span className="text-faint">({shop.review_count})</span>
                        </span>
                      )}
                      <span>{t("orders", { count: shop.completed_order_count.toLocaleString(locale) })}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onPick(ref, name)}
                  className="h-9 rounded-lg border border-line bg-surface text-[13px] font-medium text-fg transition-colors hover:border-iris/40 hover:bg-iris-soft hover:text-iris-hi cursor-pointer"
                >
                  {t("showOffers")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
