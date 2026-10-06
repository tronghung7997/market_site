"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { useAuth } from "@/lib/auth";
import type { Order } from "@/lib/types";
import { Button, Spinner } from "@/components/ui";
import { Search } from "@/components/Icons";
import { HomeGuides } from "@/features/blog";
import { RecentOrders } from "@/components/home/CommunitySections";
import { CtaBanner, FaqSection, HowItWorks } from "@/components/home/StaticSections";
import { LatestReviews, SafeTrading } from "./HomeTrust";
import { PriceBoard } from "@/components/home/PriceBoard";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { CategoryStrip } from "./CategoryStrip";
import { HomeShelf } from "./HomeShelf";
import { ShopStrip } from "./ShopStrip";
import type { HomeCatalog } from "../data/load-public";

export function HomeCatalogView({ initial }: { initial: HomeCatalog }) {
  return (
    // The shell (header/footer) streams before this subtree finishes rendering;
    // reserve the viewport so the footer does not jump when the content lands.
    <Suspense fallback={<div className="flex min-h-[70vh] items-center justify-center"><Spinner /></div>}>
      <HomeInner initial={initial} />
    </Suspense>
  );
}

function HomeInner({ initial }: { initial: HomeCatalog }) {
  const t = useTranslations("home");
  const { account } = useAuth();
  const router = useRouter();
  const cats = initial.categories;
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const isSeller = !!account?.roles.includes("seller");

  useEffect(() => {
    if (!account) { setRecentOrders([]); return; }
    api.orders({ per_page: 5 }).then((res) => setRecentOrders(res.items)).catch(() => {});
  }, [account]);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const catName = (id: number) => flatCats.find((c) => c.id === id)?.name ?? "—";
  const branchRows = (categoryId: number) => {
    if (!initial.summary) return null;
    const category = flatCats.find((item) => item.id === categoryId);
    const ids = new Set(category ? subtreeIds(category) : [categoryId]);
    return initial.summary.category_counts.filter((row) => ids.has(row.category_id));
  };
  const categoryCount = (categoryId: number) => branchRows(categoryId)?.reduce((sum, row) => sum + row.count, 0) ?? null;
  const categoryPriceFrom = (categoryId: number) => {
    const prices = (branchRows(categoryId) ?? []).filter((row) => row.price_from != null).map((row) => row.price_from as number);
    return prices.length ? Math.min(...prices) : null;
  };

  const marketTotal = initial.summary ? initial.summary.category_counts.reduce((sum, row) => sum + row.count, 0) : initial.total;

  return (
    <div>
      {/* What the market sells and a search box, with the live price board beside it. */}
      <section className="aura border-b border-line">
        <div className="w-full mx-auto grid max-w-[1200px] items-center gap-8 px-4 sm:px-6 pt-6 pb-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-8 lg:pb-8">
          <div className="max-w-[720px]">
            <h1 className="font-serif text-[clamp(1.9rem,3.6vw,2.75rem)] leading-[1.08] tracking-tight">
              {t("heroTitle")}<br />
              <span className="italic text-iris">{t("heroEmphasis")}</span>
            </h1>
            <p className="mt-3 hidden max-w-xl text-[15px] leading-relaxed text-muted sm:block">{t("heroDescription")}</p>
            <form
              role="search"
              className="mt-4 flex max-w-lg gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const q = query.trim();
                router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
              }}
            >
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t("heroSearchLabel")}</span>
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  id="home-search"
                  name="q"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("heroSearchPlaceholder")}
                  className="h-11 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-3 text-[14px] text-fg placeholder:text-placeholder focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/20"
                />
              </label>
              <Button type="submit" size="lg" className="shrink-0">{t("heroSearchButton")}</Button>
            </form>
            <p className="mt-3 text-[13px] text-muted">
              {!account ? (
                <Link href="/register" className="font-medium text-iris hover:text-iris-hi">{t("openBusiness")} →</Link>
              ) : isSeller ? (
                <Link href="/seller" className="font-medium text-iris hover:text-iris-hi">{t("heroSellerWorkspace")} →</Link>
              ) : (
                <Link href="/sell" className="font-medium text-iris hover:text-iris-hi">{t("heroOpenShop")} →</Link>
              )}
            </p>
          </div>
          <PriceBoard products={initial.shelf?.items ?? []} catName={catName} minPrice={effectiveMinPrice} loading={false} />
        </div>
      </section>

      <CategoryStrip cats={cats} countFor={categoryCount} priceFor={categoryPriceFrom} />

      {initial.error ? (
        <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-6">
          <p className="rounded-card border border-line bg-surface p-6 text-center text-[13px] text-bad">{t("noProducts")}</p>
        </div>
      ) : (
        <HomeShelf
          cats={cats}
          countFor={categoryCount}
          total={marketTotal}
          seed={initial.shelf}
        />
      )}

      {initial.topSellers.length > 0 && (
        <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 pb-6 lg:pb-8">
          <ShopStrip
            query=""
            topShops={initial.topSellers}
            onPick={(ref) => router.push(`/categories?shop=${encodeURIComponent(ref)}`)}
            heading={{ title: t("shopsTitle"), sub: t("shopsSub") }}
            className=""
          />
        </div>
      )}
      {account && <RecentOrders orders={recentOrders} />}
      <HowItWorks />
      <HomeGuides />
      <LatestReviews reviews={initial.latestReviews} />
      <SafeTrading />
      <FaqSection />
      {!isSeller && <CtaBanner />}
    </div>
  );
}
