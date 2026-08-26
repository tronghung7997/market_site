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
import { Button, Card, Spinner } from "@/components/ui";
import { ArrowRight, Check } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import { PriceBoard } from "@/components/home/PriceBoard";
import { MarketSection } from "@/components/home/MarketSection";
import { FeaturedSection } from "@/components/home/FeaturedSection";
import { RecentOrders, TrustedSellers } from "@/components/home/CommunitySections";
import { CtaBanner, FaqSection, HowItWorks, Testimonials, WhyUs } from "@/components/home/StaticSections";
import { SectionHead } from "@/components/home/SectionHead";
import type { HomeCatalog } from "../data/load-public";

export function HomeCatalogView({ initial }: { initial: HomeCatalog }) {
  return (
    <Suspense fallback={<Spinner />}>
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
  const stock = (p: typeof products[number]) => (p.variants ?? []).reduce((s, v) => s + (v.stock_count ?? 0), 0);
  const minPrice = (p: typeof products[number]) => effectiveMinPrice(p);
  const variantCount = products.reduce((s, p) => s + (p.variants?.length ?? 0), 0);
  const totalStock = products.reduce((s, p) => s + stock(p), 0);

  const activeIds = useMemo(() => {
    if (active == null) return null;
    const cat = flatCats.find((c) => c.id === active);
    return cat ? new Set(subtreeIds(cat)) : new Set([active]);
  }, [active, flatCats]);

  const featured = [...products].sort((a, b) => stock(b) - stock(a)).slice(0, 3);

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

          <PriceBoard products={products} catName={catName} stock={stock} minPrice={minPrice} loading={loading} />
        </div>
      </section>

      <section className="border-b border-line bg-surface">
        <div className="w-full mx-auto max-w-[1200px] px-6 grid grid-cols-2 md:grid-cols-4 divide-x divide-line">
          {[[t("activeProducts"), `${products.length}`], [t("packages"), `${variantCount}`], [t("availableStock"), `${totalStock}`], [t("escrowTime"), t("days", { count: 3 })]].map(([label, val], i) => (
            <div key={i} className="px-5 py-4">
              <div className="font-mono text-[26px] font-semibold tabular">{val}</div>
              <div className="text-[12.5px] text-muted mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {cats.length > 0 && (
        <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
          <SectionHead title={t("categories")} sub={t("categoriesSub")} />
          <div className="grid gap-2.5 sm:gap-4 grid-cols-2 sm:[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {flatCats
              .map((c) => ({ c, count: products.filter((p) => subtreeIds(c).includes(p.category_id)).length }))
              .filter((x) => x.count > 0)
              .map(({ c, count }) => (
                <Link key={c.id} href={`/categories/${c.id}`} className="block">
                  <Card interactive className="p-3 sm:p-5 h-full">
                    <ProductCover
                      coverId={categoryCoverId(c)}
                      title={c.name}
                      className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg"
                    />
                    <div className="mt-2.5 sm:mt-4 font-medium text-[13.5px] sm:text-[15px]">{c.name}</div>
                    <div className="text-[11.5px] sm:text-[12.5px] text-muted mt-0.5">{common("products", { count })}</div>
                  </Card>
                </Link>
              ))}
          </div>
        </section>
      )}

      <MarketSection
        products={products}
        flatCats={flatCats}
        active={active}
        activeIds={activeIds}
        setActive={setActive}
        catName={catName}
        stock={stock}
        minPrice={minPrice}
        loading={loading}
        error={error}
      />

      <FeaturedSection featured={featured} catName={catName} minPrice={minPrice} />
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
