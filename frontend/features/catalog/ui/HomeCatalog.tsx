"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { useAuth } from "@/lib/auth";
import type { Order } from "@/lib/types";
import { stockRank } from "@/lib/stock";
import { Button, Spinner } from "@/components/ui";
import { ArrowRight, Check, Search } from "@/components/Icons";
import { HomeGuides } from "@/features/blog";
import { categoryPath } from "@/lib/routes";
import { PriceBoard } from "@/components/home/PriceBoard";
import { MarketSection } from "@/components/home/MarketSection";
import { FeaturedSection } from "@/components/home/FeaturedSection";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { RecentOrders, TrustedSellers } from "@/components/home/CommunitySections";
import { CtaBanner, FaqSection, HowItWorks } from "@/components/home/StaticSections";
import { AwaitingOrdersBanner, LatestReviews, SafeTrading } from "./HomeTrust";
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
  const common = useTranslations("common");
  const searchParams = useSearchParams();
  const { account } = useAuth();
  const cats = initial.categories;
  const products = initial.products;
  const loading = false;
  const error = initial.error ? common("errorGeneric") : null;
  const [active, setActive] = useState<number | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const isSeller = !!account?.roles.includes("seller");

  useEffect(() => {
    if (!account) { setRecentOrders([]); return; }
    api.orders({ per_page: 5 }).then((res) => setRecentOrders(res.items)).catch(() => {});
  }, [account]);

  useEffect(() => {
    const catParam = searchParams.get("category");
    if (catParam) setActive(Number(catParam));
  }, [searchParams]);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const catName = (id: number) => flatCats.find((c) => c.id === id)?.name ?? "—";
  const minPrice = (p: typeof products[number]) => effectiveMinPrice(p);
  const categoryCount = (categoryId: number) => {
    if (!initial.summary) return null;
    const category = flatCats.find((item) => item.id === categoryId);
    const ids = new Set(category ? subtreeIds(category) : [categoryId]);
    return initial.summary.category_counts.reduce(
      (sum, row) => sum + (ids.has(row.category_id) ? row.count : 0),
      0,
    );
  };

  const categoryPriceFrom = (categoryId: number) => {
    if (!initial.summary) return null;
    const category = flatCats.find((item) => item.id === categoryId);
    const ids = new Set(category ? subtreeIds(category) : [categoryId]);
    const prices = initial.summary.category_counts
      .filter((row) => ids.has(row.category_id) && row.price_from != null)
      .map((row) => row.price_from as number);
    return prices.length ? Math.min(...prices) : null;
  };

  // Most available first, then best sellers — no exact stock numbers on the storefront.
  const featured = [...products]
    .sort((a, b) => stockRank(b.variants) - stockRank(a.variants) || b.sold_count - a.sold_count)
    .slice(0, 3);

  // The busiest categories double as "people look for" shortcuts under the search.
  const popular = [...flatCats]
    .filter((c) => c.parent_id == null)
    .map((c) => ({ c, count: categoryCount(c.id) ?? 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((x) => x.c);

  return (
    <div>
      <AwaitingOrdersBanner />
      <section className="aura border-b border-line">
        <div className="w-full mx-auto max-w-[1200px] px-6 pt-8 pb-9 lg:pt-10 lg:pb-11 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 items-center">
          <div>
            <h1 className="font-serif text-[clamp(2.2rem,4.4vw,3.4rem)] leading-[1.06] tracking-tight">
              {t("heroTitle")}<br />
              <span className="italic text-iris">{t("heroEmphasis")}</span>
            </h1>
            <p className="mt-5 max-w-lg text-[15px] text-muted leading-relaxed">
              {t("heroDescription")}
            </p>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {[t("instant"), t("escrow"), t("support")].map((f) => (
                <span key={f} className="flex items-center gap-1.5 text-[13.5px] text-fg">
                  <Check size={15} className="text-good" /> {f}
                </span>
              ))}
            </div>
            <form
              role="search"
              className="mt-6 flex max-w-lg gap-2"
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
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("heroSearchPlaceholder")}
                  className="h-11 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-3 text-[14px] text-fg placeholder:text-placeholder focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/20"
                />
              </label>
              <Button type="submit" size="lg" className="shrink-0">{t("heroSearchButton")}</Button>
            </form>
            {popular.length > 0 && (
              <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-muted">
                <span>{t("heroPopular")}</span>
                {popular.map((c) => (
                  <Link key={c.id} href={categoryPath(c)} className="rounded-md border border-line bg-surface px-2 py-0.5 text-fg hover:border-iris/40 hover:text-iris-hi">
                    {c.name}
                  </Link>
                ))}
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="#market"><Button size="lg">{t("explore")} <ArrowRight size={16} /></Button></Link>
              {!account ? (
                <Link href="/register"><Button size="lg" variant="secondary">{t("openBusiness")}</Button></Link>
              ) : isSeller ? (
                <Link href="/seller"><Button size="lg" variant="secondary">{t("heroSellerWorkspace")}</Button></Link>
              ) : (
                <Link href="/sell"><Button size="lg" variant="secondary">{t("heroOpenShop")}</Button></Link>
              )}
            </div>
          </div>

          <PriceBoard products={products} catName={catName} minPrice={minPrice} loading={loading} />
        </div>
      </section>

      <FeaturedSection featured={featured} catName={catName} minPrice={minPrice} />

      <CategoriesSection
        cats={cats}
        countFor={categoryCount}
        priceFor={categoryPriceFrom}
        onBrowse={(id) => {
          setActive(id);
          document.getElementById("market")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      <MarketSection
        products={products}
        initialTotal={initial.total}
        cats={cats}
        flatCats={flatCats}
        active={active}
        setActive={setActive}
        catName={catName}
        minPrice={minPrice}
        loading={loading}
        error={error}
        summary={initial.summary ? { variants: initial.summary.variants, categoryCount } : null}
      />

      <TrustedSellers sellers={initial.topSellers} />
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
