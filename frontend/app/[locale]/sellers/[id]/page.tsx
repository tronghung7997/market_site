"use client";

import { Link } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { effectiveMinPrice, isAdapterFulfilled } from "@/lib/pricing-display";
import { flattenCategories } from "@/lib/categories";
import { formatDate } from "@/lib/utils";
import type { Category, Product, SellerProfile } from "@/lib/types";
import { Card, Spinner, Tag } from "@/components/ui";
import { Check, ChevronRight, Package, Shield, Star, Verified, X } from "@/components/Icons";
import StartSellerInquiryDialog from "@/components/chat/StartSellerInquiryDialog";

function stock(p: Product): number {
  return (p.variants ?? []).reduce((s, v) => s + (v.stock_count ?? 0), 0);
}

type StockState = "in_stock" | "manual" | "out_of_stock" | "auto";

function stockState(p: Product): StockState {
  // Adapter-fulfilled products have no variant stock — counting variants would
  // wrongly show "Out of stock" for every provider product.
  if (isAdapterFulfilled(p)) return "auto";
  const variants = p.variants ?? [];
  const hasInstantStock = variants.some((v) => v.delivery_mode === "instant" && v.stock_count > 0);
  if (hasInstantStock) return "in_stock";
  const hasManual = variants.some((v) => v.delivery_mode === "manual" && v.is_active);
  if (hasManual) return "manual";
  return "out_of_stock";
}

const STOCK_BADGE_CLASS: Record<StockState, string> = {
  in_stock: "bg-good text-white",
  auto: "bg-good text-white",
  manual: "bg-warn text-white",
  out_of_stock: "bg-bad text-white",
};

const TILE_ACCENTS = [
  "bg-iris-soft text-iris border-iris/20",
  "bg-good-soft text-good border-good/20",
  "bg-warn-soft text-warn border-warn/20",
  "bg-bad-soft text-bad border-bad/20",
];
function tileAccent(id: number): string {
  return TILE_ACCENTS[id % TILE_ACCENTS.length];
}

const TIER_KEYS = ["new", "verified", "trusted", "enterprise"] as const;

export default function SellerProfilePage() {
  const t = useTranslations("sellers");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const numberLocale = locale === "vi" ? "vi-VN" : "en-US";
  const { id } = useParams<{ id: string }>();
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stockLabel = (state: StockState) => {
    switch (state) {
      case "in_stock":
        return t("stockInStock");
      case "auto":
        return t("stockAuto");
      case "manual":
        return t("stockManual");
      default:
        return t("stockOut");
    }
  };

  const tierLabel = (tier: string | null | undefined) => {
    const key = tier && (TIER_KEYS as readonly string[]).includes(tier) ? tier : "new";
    return t(`tier_${key}` as "tier_new");
  };

  useEffect(() => {
    (async () => {
      try {
        const sellerId = Number(id);
        const [s, list, c] = await Promise.all([
          api.sellerProfile(sellerId),
          api.productsBySeller(sellerId),
          api.categories().catch(() => []),
        ]);
        setSeller(s);
        setCategories(c);
        setProducts(list.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("notFound"));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, t]);

  const sellerCategories = useMemo(() => {
    if (!categories.length || !products.length) return [];
    const flat = flattenCategories(categories);
    const counts = new Map<number, number>();
    products.forEach((p) => counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([catId, count]) => ({ id: catId, name: flat.find((c) => c.id === catId)?.name, count }))
      .filter((c): c is { id: number; name: string; count: number } => !!c.name)
      .sort((a, b) => b.count - a.count);
  }, [categories, products]);

  const visibleProducts = useMemo(
    () => (activeCategory == null ? products : products.filter((p) => p.category_id === activeCategory)),
    [products, activeCategory],
  );

  const totalSold = useMemo(() => products.reduce((sum, p) => sum + (p.sold_count ?? 0), 0), [products]);
  const minEscrow = useMemo(
    () => (products.length ? Math.min(...products.map((p) => p.escrow_days)) : null),
    [products],
  );

  if (loading) {
    return (
      <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
        <Spinner />
      </div>
    );
  }
  if (error || !seller) {
    return (
      <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
        <Card className="p-6 text-bad text-sm">{error ?? t("notFound")}</Card>
      </div>
    );
  }

  const displayName = seller.display_name;
  const hasLeftCol = !!seller.bio || sellerCategories.length > 0;

  const stats: { label: string; value: string; icon: ReactNode }[] = [
    {
      label: seller.review_count > 0 ? t("reviewsWithCount", { count: seller.review_count }) : t("reviews"),
      value: seller.rating_avg != null ? seller.rating_avg.toFixed(1) : "—",
      icon: <Star size={11} className="text-warn fill-warn" />,
    },
    {
      label: t("completedOrders"),
      value: String(seller.completed_order_count),
      icon: <Check size={11} className="text-good" />,
    },
    {
      label: t("productsSold"),
      value: totalSold.toLocaleString(numberLocale),
      icon: <Package size={11} className="text-iris" />,
    },
    {
      label: t("minEscrow"),
      value: minEscrow != null ? t("escrowDays", { days: minEscrow }) : "—",
      icon: <Shield size={11} className="text-faint" />,
    },
  ];

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-6">
      <nav className="flex items-center gap-1.5 text-[12.5px] text-faint mb-4">
        <Link href="/" className="hover:text-fg transition-colors">
          {t("marketplace")}
        </Link>
        <ChevronRight size={12} className="text-line-2" />
        <span className="text-muted truncate max-w-[400px]">{displayName}</span>
      </nav>

      <Card className="aura relative overflow-hidden p-6 sm:p-8">
        <div className="relative flex flex-wrap items-end gap-x-8 gap-y-6">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0 animate-seal">
              <span className="grid place-items-center h-[64px] w-[64px] rounded-full bg-iris-soft text-iris font-serif text-[22px] font-semibold border-2 border-dashed border-iris/40">
                {displayName.slice(0, 2).toUpperCase()}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center h-6 w-6 rounded-full bg-iris text-white border-2 border-card">
                <Verified size={11} />
              </span>
            </div>
            <div>
              <h1 className="font-serif text-[24px] font-semibold tracking-tight text-fg leading-tight">{displayName}</h1>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 rounded-full border border-iris/25 bg-iris-soft px-2 py-0.5 text-[11px] font-medium text-iris-hi">
                  <Verified size={10} /> {tierLabel(seller.seller_tier)}
                </span>
                {seller.member_since && (
                  <span className="text-[12px] text-faint">{t("memberSince", { date: formatDate(seller.member_since) })}</span>
                )}
              </div>
              <div className="mt-3">
                <StartSellerInquiryDialog sellerId={seller.account_id} sellerName={displayName} products={products} />
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-[12px] hidden sm:block" />

          <div className="w-full sm:w-auto grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:items-stretch sm:gap-0 sm:divide-x sm:divide-line">
            {stats.map((s, i) => (
              <div key={s.label} className="sm:px-5 sm:first:pl-0 sm:last:pr-0 animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="font-mono text-[20px] font-semibold text-fg tabular leading-none whitespace-nowrap">{s.value}</div>
                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-faint whitespace-nowrap">
                  {s.icon}
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <div className={hasLeftCol ? "grid gap-6 lg:grid-cols-[240px_1fr] items-start" : ""}>
          {hasLeftCol && (
            <div className="flex flex-col gap-4">
              {seller.bio && (
                <Card className="p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-faint mb-2">{t("about")}</div>
                  <p className="text-[13.5px] text-muted leading-relaxed whitespace-pre-wrap">{seller.bio}</p>
                </Card>
              )}
              {sellerCategories.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{t("categories")}</div>
                    {activeCategory != null && (
                      <button
                        onClick={() => setActiveCategory(null)}
                        className="flex items-center gap-0.5 text-[11px] text-iris hover:text-iris-hi transition-colors cursor-pointer"
                      >
                        <X size={11} /> {t("clearFilter")}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sellerCategories.map((c) => {
                      const active = activeCategory === c.id;
                      return (
                        <button
                          key={c.id}
                          onClick={() => setActiveCategory(active ? null : c.id)}
                          className={
                            active
                              ? "inline-flex items-center gap-1 rounded-full border border-iris bg-iris px-2.5 py-1 text-[12px] font-medium text-white transition-colors cursor-pointer"
                              : "inline-flex items-center gap-1 rounded-full border border-line bg-raised px-2.5 py-1 text-[12px] font-medium text-muted hover:border-iris/40 hover:text-fg transition-colors cursor-pointer"
                          }
                        >
                          {c.name} <span className={active ? "text-white/70" : "text-faint"}>({c.count})</span>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              )}
            </div>
          )}

          <div className="min-w-0">
            <h2 className="font-serif text-[18px] tracking-tight mb-4">{t("productsForSale", { count: visibleProducts.length })}</h2>
            {visibleProducts.length === 0 ? (
              <Card className="p-6 text-muted text-sm">
                {products.length === 0 ? t("noProducts") : t("noProductsInCategory")}
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleProducts.map((p, i) => {
                  const state = stockState(p);
                  const price = effectiveMinPrice(p);
                  const units = stock(p);
                  return (
                    <Link
                      key={p.id}
                      href={`/products/${p.id}`}
                      className="group animate-rise"
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    >
                      <Card className="p-0 flex flex-col h-full overflow-hidden transition-all duration-150 group-hover:shadow-card-lg group-hover:-translate-y-0.5">
                        <div className="relative px-5 pt-5 pb-4">
                          <span
                            className={`absolute top-3 right-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STOCK_BADGE_CLASS[state]}`}
                          >
                            {stockLabel(state)}
                          </span>
                          <span
                            className={`grid place-items-center h-11 w-11 shrink-0 rounded-lg border font-serif text-[15px] font-semibold ${tileAccent(p.id)}`}
                          >
                            {p.title.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="mt-3 min-w-0 pr-16">
                            <div className="font-medium text-[14px] leading-snug line-clamp-2">{p.title}</div>
                          </div>
                          <div className="mt-2.5 flex items-center gap-2.5 text-[11.5px] text-muted flex-wrap">
                            {p.rating_count > 0 && p.rating_avg != null && (
                              <span className="flex items-center gap-1">
                                <Star size={11} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}
                                <span className="text-faint">({p.rating_count})</span>
                              </span>
                            )}
                            {p.sold_count > 0 && <span>{t("sold", { count: p.sold_count })}</span>}
                            {state === "in_stock" && <span>{t("stockCount", { count: units })}</span>}
                          </div>
                        </div>
                        <div className="px-5 py-3.5 bg-raised/50 border-t border-line flex items-center justify-between mt-auto">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-faint font-medium">{t("fromPrice")}</div>
                            <div className="font-mono text-[17px] font-semibold tabular leading-tight text-iris-hi">
                              {price > 0 ? formatBrowseMoney(price, { locale }) : t("quote")}
                            </div>
                          </div>
                          <Tag tone="neutral">
                            <Shield size={11} /> {t("escrowDays", { days: p.escrow_days })}
                          </Tag>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
