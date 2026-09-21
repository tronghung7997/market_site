"use client";

import { Link } from "@/i18n/navigation";
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
import { ArrowRight, Check } from "@/components/Icons";
import { PriceBoard } from "@/components/home/PriceBoard";
import { MarketSection } from "@/components/home/MarketSection";
import { FeaturedSection } from "@/components/home/FeaturedSection";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { RecentOrders, TrustedSellers } from "@/components/home/CommunitySections";
import { CtaBanner, FaqSection, HowItWorks, Testimonials, WhyUs } from "@/components/home/StaticSections";
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

  // Most available first, then best sellers — no exact stock numbers on the storefront.
  const featured = [...products]
    .sort((a, b) => stockRank(b.variants) - stockRank(a.variants) || b.sold_count - a.sold_count)
    .slice(0, 3);

  return (
    <div>
      <section className="aura border-b border-line">
        <div className="w-full mx-auto max-w-[1200px] px-6 pt-8 pb-9 lg:pt-10 lg:pb-11 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-muted shadow-card">
              <span className="text-warn">★★★★★</span> {t("heroRating")}
            </div>
            <h1 className="font-serif text-[clamp(2.2rem,4.4vw,3.4rem)] leading-[1.06] tracking-tight mt-5">
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
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="#market"><Button size="lg">{t("explore")} <ArrowRight size={16} /></Button></Link>
              <Link href="/register"><Button size="lg" variant="secondary">{t("openBusiness")}</Button></Link>
            </div>
          </div>

          <PriceBoard products={products} catName={catName} minPrice={minPrice} loading={loading} />
        </div>
      </section>

      <FeaturedSection featured={featured} catName={catName} minPrice={minPrice} />

      <CategoriesSection
        cats={cats}
        countFor={categoryCount}
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
      <WhyUs />
      <Testimonials />
      <FaqSection />
      <CtaBanner />
    </div>
  );
}
