"use client";

/** Trang chủ — MỤC LỤC + dữ liệu: một request /products (đã kèm variants,
 *  hết cảnh gọi chi tiết từng sản phẩm), categories, top sellers, đơn gần đây.
 *  Section nằm ở components/home/*: PriceBoard · MarketSection ·
 *  FeaturedSection · CommunitySections · StaticSections. */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { useAuth } from "@/lib/auth";
import type { Category, Order, Product, SellerSummary } from "@/lib/types";
import { Button, Card, Spinner } from "@/components/ui";
import { ArrowRight, Check } from "@/components/Icons";
import { categoryIcon } from "@/components/CategoryIcon";
import { PriceBoard } from "@/components/home/PriceBoard";
import { MarketSection } from "@/components/home/MarketSection";
import { FeaturedSection } from "@/components/home/FeaturedSection";
import { RecentOrders, TrustedSellers } from "@/components/home/CommunitySections";
import { CtaBanner, FaqSection, HowItWorks, Testimonials, WhyUs } from "@/components/home/StaticSections";
import { SectionHead } from "@/components/home/SectionHead";

export default function Home() {
  return (
    <Suspense fallback={<Spinner label="Đang tải…" />}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const { account } = useAuth();
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [topSellers, setTopSellers] = useState<SellerSummary[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);

  useEffect(() => {
    (async () => {
      try {
        // /products đã trả kèm variants (gói + tồn kho) — trước đây chỗ này
        // gọi thêm api.product(id) cho TỪNG sản phẩm (~35 request mỗi lần mở
        // trang chủ) chỉ để lấy đúng hai con số đó. Không truyền page: trang
        // chủ đếm tổng (stats, số sản phẩm mỗi danh mục) nên cần đủ danh sách.
        const [c, list] = await Promise.all([api.categories(), api.products()]);
        setCats(c);
        setProducts(list.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được dữ liệu");
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    api.topSellers(6).then(setTopSellers).catch(() => {});
  }, []);

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
  const stock = (p: Product) => (p.variants ?? []).reduce((s, v) => s + (v.stock_count ?? 0), 0);
  // Giá "Chỉ từ" phải là số tiền thật rẻ nhất — với strategy config,
  // base_price chỉ là mỏ neo công thức (key xoay 24h: base 120.000 nhưng giá
  // thật 4.000đ). effectiveMinPrice quy đổi đúng theo mult + kỳ hạn ngắn nhất.
  const minPrice = (p: Product) => effectiveMinPrice(p);
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
      {/* ============ HERO ============ */}
      <section className="aura border-b border-line">
        <div className="w-full mx-auto max-w-[1200px] px-6 pt-8 pb-9 lg:pt-10 lg:pb-11 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-muted shadow-card">
              <span className="text-warn">★★★★★</span> 4.9/5 từ 1.200+ doanh nghiệp
            </div>
            <h1 className="font-serif text-[clamp(2.2rem,4.4vw,3.4rem)] leading-[1.06] tracking-tight mt-5">
              Tài khoản &amp; dữ liệu số,<br />
              <span className="italic text-iris">cấp nhanh cho doanh nghiệp.</span>
            </h1>
            <p className="mt-5 max-w-lg text-[15px] text-muted leading-relaxed">
              Nguồn tài khoản mạng xã hội, proxy và dữ liệu số từ nhà bán đã xác minh — giao ngay, ký quỹ bảo vệ, hoá đơn minh bạch.
            </p>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {["Giao ngay tự động", "Ký quỹ bảo vệ người mua", "Hỗ trợ 24/7"].map((f) => (
                <span key={f} className="flex items-center gap-1.5 text-[13.5px] text-fg">
                  <Check size={15} className="text-good" /> {f}
                </span>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="#market"><Button size="lg">Khám phá chợ <ArrowRight size={16} /></Button></Link>
              <Link href="/register"><Button size="lg" variant="secondary">Mở tài khoản doanh nghiệp</Button></Link>
            </div>
          </div>

          <PriceBoard products={products} catName={catName} stock={stock} minPrice={minPrice} loading={loading} />
        </div>
      </section>

      {/* ============ STATS ============ */}
      <section className="border-b border-line bg-surface">
        <div className="w-full mx-auto max-w-[1200px] px-6 grid grid-cols-2 md:grid-cols-4 divide-x divide-line">
          {[
            ["Sản phẩm đang bán", `${products.length}`],
            ["Gói / biến thể", `${variantCount}`],
            ["Hàng sẵn trong kho", `${totalStock}`],
            ["Thời gian ký quỹ", "3 ngày"],
          ].map(([label, val], i) => (
            <div key={i} className="px-5 py-4">
              <div className="font-mono text-[26px] font-semibold tabular">{val}</div>
              <div className="text-[12.5px] text-muted mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ CATEGORIES ============ */}
      {cats.length > 0 && (
        <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
          <SectionHead title="Danh mục" sub="Chọn nhóm sản phẩm bạn cần" />
          <div className="grid gap-2.5 sm:gap-4 grid-cols-2 sm:[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {flatCats
              .map((c) => ({ c, count: products.filter((p) => subtreeIds(c).includes(p.category_id)).length }))
              .filter((x) => x.count > 0)
              .map(({ c, count }) => {
                const Icon = categoryIcon(c.name);
                return (
                  // Vào danh mục = sang TRANG danh mục (URL bền) — nhất quán với
                  // hub /categories; pills ở section Market bên dưới vẫn là filter
                  // tại chỗ cho ai muốn lọc nhanh.
                  <Link key={c.id} href={`/categories/${c.id}`} className="block">
                    <Card interactive className="p-3 sm:p-5 h-full">
                      <span className="grid place-items-center h-8 w-8 sm:h-10 sm:w-10 rounded-lg bg-iris-soft text-iris border border-iris/15">
                        <Icon size={15} />
                      </span>
                      <div className="mt-2.5 sm:mt-4 font-medium text-[13.5px] sm:text-[15px]">{c.name}</div>
                      <div className="text-[11.5px] sm:text-[12.5px] text-muted mt-0.5">{count} sản phẩm</div>
                    </Card>
                  </Link>
                );
              })}
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
      <TrustedSellers sellers={topSellers} />
      {account && <RecentOrders orders={recentOrders} />}
      <HowItWorks />
      <WhyUs />
      <Testimonials />
      <FaqSection />
      <CtaBanner />
    </div>
  );
}
