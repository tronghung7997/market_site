"use client";

/** "Bán chạy nhất" in the hero: the five best-selling offers (the shelf's
 *  first page is sorted by purchases), each row a link with category, units
 *  sold, stock and price. Long names wrap in full on phones and glide to
 *  their end on hover/focus on desktop (MarqueeText). */

const TOP = 5;

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { parseCoverId } from "@/lib/product-covers";
import type { Product } from "@/lib/types";
import { productPath } from "@/lib/routes";
import { productStockCount, productStockState } from "@/lib/stock";
import { Card, Spinner } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";
import { MarqueeText } from "@/components/ui/MarqueeText";
import { StockCount } from "@/components/products/StockCount";

export function PriceBoard({ products, catName, minPrice, loading }: {
  products: Product[]; catName: (id: number) => string;
  minPrice: (p: Product) => number; loading: boolean;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const rows = products.slice(0, TOP);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-raised/60">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-bad/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-good/60" />
        </span>
        <h2 className="ml-1 text-[13px] font-semibold text-fg">{t("bestSellersTitle")}</h2>
        <span className="ml-auto text-[12px] font-medium text-muted">{t("bestSellersTop", { count: rows.length })}</span>
      </div>
      <ol className="divide-y divide-line">
        {loading && <li className="px-4 py-10"><Spinner /></li>}
        {!loading && rows.map((p) => {
          const state = productStockState(p.variants);
          const count = productStockCount(p.variants);
          return (
            <li key={p.id}>
              <Link href={productPath(p)} className="group flex items-start gap-3 px-4 py-3 hover:bg-raised transition-colors focus-visible:bg-raised focus-visible:outline-none">
                <ProductCover coverId={parseCoverId(p)} image={p.images?.cover} title={p.title} className="mt-0.5 h-8 w-8 shrink-0 rounded-md" />
                <span className="min-w-0 flex-1">
                  {/* Phones: the whole name wraps; desktop: one line that glides on hover/focus. */}
                  <MarqueeText text={p.title} touchLines="all" className="text-[13px] font-medium leading-5 text-fg" />
                  {/* Items spaced, no "·" separators: a wrap never leaves one dangling. */}
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
                    <span>{catName(p.category_id)}</span>
                    {p.sold_count > 0 && <span className="whitespace-nowrap">{tc("sold", { count: p.sold_count.toLocaleString(locale) })}</span>}
                    {count > 0 ? <StockCount count={count} low={state === "low"} />
                      : state === "in_stock" ? <span className="whitespace-nowrap font-medium text-good">● {t("inStockShort")}</span>
                      : state === "low" ? <span className="whitespace-nowrap font-medium text-warn">● {t("lowStock")}</span>
                      : <span className="whitespace-nowrap text-warn">{t("onRequest")}</span>}
                  </span>
                </span>
                <span className="shrink-0 pt-0.5 text-right font-mono text-[13.5px] font-semibold tabular text-fg">{formatBrowseMoney(minPrice(p), { locale })}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
