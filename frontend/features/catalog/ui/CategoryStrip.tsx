"use client";

/** The home page's way into the catalog: one horizontal row of category
 *  tiles (each top-level branch, then its sub-categories), every tile one
 *  link with its offer count and lowest price, ending on "All categories".
 *  Arrows glide a view at a time and a mouse can drag it (`useCarousel`). */

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { categoryPath } from "@/lib/routes";
import { categoryCoverId } from "@/lib/product-covers";
import { carouselFade, useCarousel } from "@/lib/hooks/useCarousel";
import type { Category } from "@/lib/types";
import { CarouselArrow } from "@/components/ui/CarouselArrow";
import { ProductCover } from "@/components/products/ProductCover";
import { ArrowRight, Grid } from "@/components/Icons";

export function CategoryStrip({ cats, countFor, priceFor, className }: {
  /** Category tree (top level with `children`). */
  cats: Category[];
  /** Active offers in a category's branch; null when unknown. */
  countFor: (id: number) => number | null;
  /** Lowest storefront price in the branch; null when unknown. */
  priceFor: (id: number) => number | null;
  className?: string;
}) {
  const t = useTranslations("home");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const carousel = useCarousel<HTMLUListElement>();
  const stocked = (c: Category) => (countFor(c.id) ?? 1) > 0;
  const tiles = cats.filter(stocked).flatMap((parent) => [
    { cat: parent, child: false },
    ...(parent.children ?? []).filter(stocked).map((cat) => ({ cat, child: true })),
  ]);
  if (tiles.length === 0) return null;
  const fade = carouselFade(carousel.canPrev, carousel.canNext);

  return (
    <section aria-labelledby="home-categories" className={cn("w-full mx-auto max-w-[1200px] px-4 sm:px-6 pt-6", className)}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 id="home-categories" className="font-serif text-[22px] font-semibold leading-tight tracking-tight text-fg sm:text-[24px]">{t("categories")}</h2>
          <p className="mt-1 text-[13px] text-muted">{t("categoriesSub")}</p>
        </div>
        {(carousel.canPrev || carousel.canNext) && (
          <div className="flex shrink-0 items-center gap-1.5">
            <CarouselArrow direction="prev" disabled={!carousel.canPrev} onClick={carousel.prev} label={t("categoriesPrev")} />
            <CarouselArrow direction="next" disabled={!carousel.canNext} onClick={carousel.next} label={t("categoriesNext")} />
          </div>
        )}
      </div>
      <ul
        ref={carousel.ref}
        aria-labelledby="home-categories"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
        className={cn(
          "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 py-1 sm:mx-0 sm:scroll-px-0 sm:px-0",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          (carousel.canPrev || carousel.canNext) && "sm:cursor-grab",
          carousel.dragging && "sm:cursor-grabbing select-none [&_*]:pointer-events-none",
        )}
      >
        {tiles.map(({ cat, child }) => {
          const count = countFor(cat.id);
          const price = priceFor(cat.id);
          return (
            <li key={cat.id} className="w-[220px] shrink-0 snap-start">
              <Link
                href={categoryPath(cat)}
                draggable={false}
                className={cn(
                  "flex h-16 items-center gap-3 rounded-card border bg-card px-3 shadow-card transition-colors",
                  "hover:border-iris/40 hover:bg-iris-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                  child ? "border-line" : "border-line-2",
                )}
              >
                <ProductCover coverId={categoryCoverId(cat)} title={cat.name} className="h-10 w-10 shrink-0 rounded-xl" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-fg">{cat.name}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {count != null && t("categoryOffers", { count: count.toLocaleString(locale) })}
                    {count != null && price != null && " · "}
                    {price != null && t("priceFrom", { price: formatBrowseMoney(price, { locale }) })}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        <li className="w-[200px] shrink-0 snap-start">
          <Link
            href="/categories"
            draggable={false}
            className="flex h-16 items-center gap-3 rounded-card border border-dashed border-line-2 bg-surface px-3 text-fg transition-colors hover:border-iris/40 hover:bg-iris-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raised text-iris" aria-hidden="true"><Grid size={18} /></span>
            <span className="flex-1 text-[14px] font-semibold">{t("allCategories")}</span>
            <ArrowRight size={15} aria-hidden="true" className="text-faint" />
          </Link>
        </li>
      </ul>
    </section>
  );
}
