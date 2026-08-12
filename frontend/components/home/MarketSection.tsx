"use client";

/** Section "Toàn bộ sản phẩm": pill danh mục, tìm kiếm, lọc còn hàng, đổi
 *  bảng/lưới, thu gọn 8 dòng đầu. State trình bày (q, view, còn hàng, xem
 *  tất cả) sống ở đây; danh mục đang chọn (active) dùng chung với section
 *  Danh mục nên nhận từ page. */

import { Link } from "@/i18n/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { Category, Product } from "@/lib/types";
import { Button, Card, Monogram, Spinner, Tag } from "@/components/ui";
import { Grid, Rows, Search, Shield, Star, Verified } from "@/components/Icons";
import { SectionHead } from "./SectionHead";

const COLLAPSED_LIMIT = 8;

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors",
        active ? "bg-fg text-surface border-fg" : "bg-surface text-muted border-line hover:text-fg hover:border-line-2")}>
      {children}
    </button>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round"
      className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function MarketSection({ products, flatCats, active, activeIds, setActive, catName, stock, minPrice, loading, error }: {
  products: Product[];
  flatCats: Category[];
  active: number | null;
  /** id danh mục đang chọn + toàn bộ nhánh con — null = không lọc danh mục. */
  activeIds: Set<number> | null;
  setActive: (id: number | null) => void;
  catName: (id: number) => string;
  stock: (p: Product) => number;
  minPrice: (p: Product) => number;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations("home");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const [q, setQ] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [view, setView] = useState<"table" | "grid">("table");
  const [showAll, setShowAll] = useState(false);

  const filtered = products.filter((p) =>
    (activeIds == null || activeIds.has(p.category_id)) &&
    (q === "" || p.title.toLowerCase().includes(q.toLowerCase())) &&
    (!inStockOnly || stock(p) > 0));
  const hasMore = filtered.length > COLLAPSED_LIMIT;
  const isFiltering = active != null || q !== "" || inStockOnly;
  const visible = (showAll || isFiltering) ? filtered : filtered.slice(0, COLLAPSED_LIMIT);

  return (
    <section id="market" className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8 scroll-mt-20">
      <SectionHead title={t("allProducts")} sub={t("marketSubtitle")} />

      {flatCats.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Pill active={active == null} onClick={() => setActive(null)}>{t("all")}</Pill>
          {flatCats.map((c) => <Pill key={c.id} active={active === c.id} onClick={() => setActive(c.id)}>{c.name}</Pill>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchProducts")}
            className="h-9 w-full rounded-lg bg-surface border border-line pl-9 pr-3 text-[13px] placeholder:text-faint focus:border-iris transition-colors" />
        </div>
        <button onClick={() => setInStockOnly((v) => !v)}
          className={cn("flex items-center gap-2 h-9 px-3 rounded-lg border text-[13px] font-medium transition-colors",
            inStockOnly ? "border-good/40 bg-good-soft text-good" : "border-line bg-surface text-muted hover:text-fg")}>
          <span className={cn("h-3.5 w-6 rounded-full relative transition-colors", inStockOnly ? "bg-good" : "bg-line-2")}>
            <span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-all", inStockOnly ? "left-3" : "left-0.5")} />
          </span>
          {t("inStockOnly")}
        </button>
        <div className="flex items-center rounded-lg border border-line bg-surface p-0.5">
          {([["table", Rows], ["grid", Grid]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v)}
              className={cn("grid place-items-center h-8 w-8 rounded-md transition-colors", view === v ? "bg-raised text-fg" : "text-faint hover:text-muted")}>
              <Icon size={16} />
            </button>
          ))}
        </div>
      </div>

      {loading && <Spinner label={t("loadingMarket")} />}
      {error && !loading && <Card className="p-5 text-bad text-sm">{error}</Card>}
      {!loading && !error && filtered.length === 0 && <Card className="p-6 text-muted text-sm">{t("noProducts")}</Card>}

      {!loading && visible.length > 0 && (view === "table" ? (
        <Card className="overflow-hidden">
          {/* Bảng rộng hơn màn điện thoại; Card overflow-hidden thì cắt mất phần
              thừa và không cuộn tới được. Cho nó cuộn ngang trong chính nó. */}
          <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[12px] text-faint border-b border-line">
                <th className="font-medium px-5 py-3">{t("product")}</th>
                <th className="font-medium px-3 py-3 hidden sm:table-cell">{t("category")}</th>
                <th className="font-medium px-3 py-3">{t("stock")}</th>
                <th className="font-medium px-3 py-3 hidden md:table-cell">{t("escrowLabel")}</th>
                <th className="font-medium px-3 py-3 text-right">{t("fromPrice")}</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const inStock = stock(p) > 0;
                const hasPackages = (p.variants?.length ?? 0) > 0;
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-raised transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/products/${p.id}`} className="flex items-center gap-3">
                        <Monogram text={p.title} />
                        <span className="min-w-0">
                          <span className="block font-medium text-[13.5px] truncate">{p.title}</span>
                          <span className="flex items-center gap-1.5 text-[12px] text-faint">
                            {hasPackages ? t("packageCount", { count: p.variants?.length ?? 0 }) : t("configuredToOrder")} <Verified size={11} className="text-iris" />
                            {p.rating_avg != null && p.rating_avg > 0 && <><Star size={11} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}</>}
                            {p.sold_count > 0 && <span>· {t("sold", { count: p.sold_count })}</span>}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-muted hidden sm:table-cell">{catName(p.category_id)}</td>
                    <td className="px-3 py-3">{inStock ? <Tag tone="good">● {stock(p)}</Tag> : <Tag tone="warn">{t("onRequest")}</Tag>}</td>
                    <td className="px-3 py-3 text-[13px] text-muted hidden md:table-cell">{t("days", { count: p.escrow_days })}</td>
                    <td className="px-3 py-3 text-right font-mono text-[13.5px] font-semibold tabular">{formatBrowseMoney(minPrice(p), { locale })}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/products/${p.id}`}><Button size="sm" variant="secondary">{t("view")}</Button></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      ) : (
        <div className="grid gap-2.5 sm:gap-4 grid-cols-2 sm:[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {visible.map((p, i) => {
            const inStock = stock(p) > 0;
            const hasPackages = (p.variants?.length ?? 0) > 0;
            return (
              <Link key={p.id} href={`/products/${p.id}`} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
                <Card interactive className="p-3 sm:p-4 h-full">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <Monogram text={p.title} className="h-8 w-8 sm:h-10 sm:w-10 text-[12px] sm:text-[15px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1 sm:gap-2">
                        <div className="font-medium text-[12.5px] sm:text-[14px] truncate">{p.title}</div>
                      </div>
                      <div className="font-mono text-[12px] sm:text-[13.5px] font-semibold tabular">{formatBrowseMoney(minPrice(p), { locale })}</div>
                      <div className="text-[11px] sm:text-[12px] text-faint mt-0.5 truncate">{catName(p.category_id)}</div>
                      <div className="mt-2 sm:mt-3 flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        {inStock ? <Tag tone="good">● {t("inStock", { count: stock(p) })}</Tag> : <Tag tone="warn">{hasPackages ? t("outOfStock") : t("onRequest")}</Tag>}
                        <Tag tone="neutral"><Shield size={11} /> {p.escrow_days}d</Tag>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      ))}

      {hasMore && !isFiltering && (
        <div className="text-center mt-4">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-iris hover:text-iris-hi transition-colors"
          >
            {showAll ? t("collapse") : t("viewAllProducts", { count: filtered.length })}
            <ChevronIcon open={showAll} />
          </button>
        </div>
      )}
    </section>
  );
}
