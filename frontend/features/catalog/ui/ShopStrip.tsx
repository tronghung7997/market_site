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
import { ChevronRight, Star } from "@/components/Icons";
import { carouselFade, useCarousel } from "@/lib/hooks/useCarousel";
import { CarouselArrow } from "@/components/ui/CarouselArrow";
import { cn } from "@/lib/cn";

/** Shorter queries match too much to be worth a shop row. */
const MIN_SHOP_QUERY = 2;

export function ShopStrip({
  query,
  topShops,
  onPick,
  heading,
  className = "mt-4",
}: {
  query: string;
  topShops: SellerSummary[];
  onPick: (ref: string, name: string) => void;
  /** A page section's own heading (the home page) instead of the small label. */
  heading?: { title: string; sub: string };
  className?: string;
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
  const carousel = useCarousel<HTMLUListElement>();
  if (shops.length === 0) return null;
  const fade = carouselFade(carousel.canPrev, carousel.canNext);

  return (
    <section aria-labelledby="shop-strip-title" className={className}>
      <div className={cn("flex items-end justify-between gap-3", heading ? "mb-4" : "mb-2 items-center")}>
        {heading ? (
          <div>
            <h2 id="shop-strip-title" className="font-serif text-[22px] font-semibold leading-tight tracking-tight text-fg sm:text-[24px]">{heading.title}</h2>
            <p className="mt-1 text-[13px] text-muted">{heading.sub}</p>
          </div>
        ) : (
          <h2 id="shop-strip-title" className="text-[13px] font-semibold text-fg">
            {searching ? t("matching", { q: query }) : t("top")}
          </h2>
        )}
        {(carousel.canPrev || carousel.canNext) && (
          <div className="flex items-center gap-1.5">
            <CarouselArrow direction="prev" disabled={!carousel.canPrev} onClick={carousel.prev} label={t("scrollPrev")} />
            <CarouselArrow direction="next" disabled={!carousel.canNext} onClick={carousel.next} label={t("scrollNext")} />
          </div>
        )}
      </div>
      {/* One compact row per shop: the card narrows the grid to the shop, the
          arrow opens the shop page. Arrows glide a view at a time; a mouse can
          drag the row (touch scrolls natively). Edges fade while more is hidden
          that way; `scroll-px-4` keeps the phone gutter when the row snaps. */}
      <ul
        ref={carousel.ref}
        aria-labelledby="shop-strip-title"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
        className={cn(
          "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 py-1 sm:mx-0 sm:scroll-px-0 sm:px-0",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          (carousel.canPrev || carousel.canNext) && "sm:cursor-grab",
          carousel.dragging && "sm:cursor-grabbing select-none [&_*]:pointer-events-none",
        )}
      >
        {shops.map((shop) => {
          const ref = shop.handle ? `${shop.handle}-${shop.public_key}` : shop.public_key;
          const name = shop.display_name;
          const rated = shop.rating_avg != null && shop.review_count > 0;
          return (
            <li key={shop.public_key} className="relative w-[240px] shrink-0 snap-start">
              <button
                type="button"
                onClick={() => onPick(ref, name)}
                aria-label={t("showOffersOf", { name })}
                className="flex h-14 w-full items-center gap-2.5 rounded-card border border-line bg-card py-2 pl-2.5 pr-11 text-left shadow-card transition-colors hover:border-iris/40 hover:bg-iris-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris cursor-pointer"
              >
                {shop.logo ? (
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-raised">
                    <MediaImage image={shop.logo} alt="" className="h-full w-full" fallback={<Monogram text={name} className="h-full w-full rounded-full" />} />
                  </span>
                ) : (
                  <Monogram text={name} className="h-9 w-9 rounded-full" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-fg">{name}</span>
                  <span className="flex items-center gap-1.5 text-[12px] text-muted">
                    {rated && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star size={11} className="text-warn fill-warn" aria-hidden="true" />
                        <span className="font-medium text-fg">{shop.rating_avg!.toFixed(1)}</span>
                      </span>
                    )}
                    <span className="truncate">{t("orders", { count: shop.completed_order_count.toLocaleString(locale) })}</span>
                  </span>
                </span>
              </button>
              <Link
                href={sellerPath(shop)}
                aria-label={t("openShop", { name })}
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-faint transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
              >
                <ChevronRight size={15} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
