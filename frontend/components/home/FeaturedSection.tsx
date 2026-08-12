"use client";

/** "Nổi bật tuần này" — 3 card kiểu bảng giá: header sản phẩm, 2–3 gói đầu
 *  kèm giá, footer "Chỉ từ". Page quyết định 3 sản phẩm nào (sort theo kho). */

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { Product } from "@/lib/types";
import { Card, Monogram } from "@/components/ui";
import { ArrowRight, Bolt, Shield, Verified } from "@/components/Icons";
import { SectionHead } from "./SectionHead";

export function FeaturedSection({ featured, catName, minPrice }: {
  featured: Product[];
  catName: (id: number) => string;
  minPrice: (p: Product) => number;
}) {
  const t = useTranslations("home");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  if (featured.length === 0) return null;
  return (
    <section className="border-y border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
        <SectionHead title={t("featuredTitle")} sub={t("featuredSubtitle")} />
        {/* [&>*]:min-w-0 — grid item mặc định min-width:auto, nên phần text
            `truncate` (nowrap) bên trong đẩy cả cột rộng ra thay vì bị cắt,
            kéo trang trôi ngang trên điện thoại. */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-5 lg:grid-cols-3 [&>*]:min-w-0">
          {featured.map((p) => {
            const mp = minPrice(p);
            const variants = p.variants ?? [];
            return (
              <Link key={p.id} href={`/products/${p.id}`} className="group">
                <Card className="p-0 flex flex-col h-full overflow-hidden transition-all duration-150 group-hover:shadow-card-lg group-hover:-translate-y-0.5">
                  {/* Header */}
                  <div className="px-3 pt-3 pb-2.5 sm:px-5 sm:pt-5 sm:pb-4">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Monogram
                        text={p.title}
                        className="h-8 w-8 sm:h-10 sm:w-10 bg-iris-soft border-iris/20 text-[12px] sm:text-[14px]"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-[13px] sm:text-[15px] truncate">{p.title}</div>
                        <div className="flex items-center gap-1.5 text-[11px] sm:text-[12px] text-faint">
                          {catName(p.category_id)}
                          <Verified size={11} className="text-iris hidden sm:inline" />
                          {p.sold_count > 0 && <span className="hidden sm:inline">· {p.sold_count} {t("soldSuffix")}</span>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Variant list — mobile chỉ hiện 2 gói đầu để card không quá cao,
                      desktop giữ 3 như cũ. */}
                  <div className="px-3 sm:px-5 flex-1">
                    <div className="border-t border-line pt-2 sm:pt-3 space-y-0">
                      {variants.slice(0, 3).map((v, vi) => (
                        <div key={v.id} className={cn("flex items-center gap-1.5 sm:gap-2 py-1.5 sm:py-2 text-[12px] sm:text-[13px]", vi >= 2 && "hidden sm:flex")}>
                          <span className="shrink-0 w-4 text-center">
                            {v.delivery_mode === "instant" ? <Bolt size={12} className="text-good" /> : <Shield size={12} className="text-faint" />}
                          </span>
                          <span className="text-muted truncate flex-1">{v.name}</span>
                          <span className="font-mono text-[11px] sm:text-[12px] font-medium tabular shrink-0 text-fg">
                            {v.price > 0 ? formatBrowseMoney(v.price, { locale }) : t("quote")}
                          </span>
                        </div>
                      ))}
                      {variants.length > 3 && (
                        <div className="text-[11.5px] text-faint pb-1 hidden sm:block">{t("morePackages", { count: variants.length - 3 })}</div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-3 py-2.5 sm:px-5 sm:py-4 bg-raised/50 border-t border-line flex items-center justify-between mt-auto">
                    <div>
                      <div className="text-[9.5px] sm:text-[10.5px] uppercase tracking-wide text-faint font-medium">{t("onlyFrom")}</div>
                      <div className="font-mono text-[15px] sm:text-[20px] font-semibold tabular leading-tight text-iris-hi">
                        {mp > 0 ? formatBrowseMoney(mp, { locale }) : t("quote")}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-[12.5px] font-medium text-iris group-hover:text-iris-hi transition-colors">
                      <span className="hidden sm:inline">{t("choosePackage")}</span> <ArrowRight size={14} />
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
