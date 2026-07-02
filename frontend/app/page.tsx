"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Category, ProductDetail } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { ArrowRight, Bolt, Check, Clock, Grid, Rows, Search, Shield, Star, Store, Verified } from "@/components/Icons";

function flatten(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (l: Category[]) => l.forEach((c) => { out.push(c); walk(c.children ?? []); });
  walk(cats);
  return out;
}
function subtreeIds(cat: Category): number[] {
  return [cat.id, ...(cat.children ?? []).flatMap(subtreeIds)];
}

export default function Home() {
  return (
    <Suspense fallback={<Spinner label="Đang tải…" />}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [view, setView] = useState<"table" | "grid">("table");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, list] = await Promise.all([api.categories(), api.products()]);
        setCats(c);
        const detailed = await Promise.all(list.map((p) => api.product(p.id).catch(() => null)));
        setProducts(detailed.filter(Boolean) as ProductDetail[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được dữ liệu");
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    const catParam = searchParams.get("category");
    if (catParam) setActive(Number(catParam));
  }, [searchParams]);

  const flatCats = useMemo(() => flatten(cats), [cats]);
  const catName = (id: number) => flatCats.find((c) => c.id === id)?.name ?? "—";
  const stock = (p: ProductDetail) => p.variants.reduce((s, v) => s + (v.stock_count ?? 0), 0);
  const minPrice = (p: ProductDetail) => {
    const priced = p.variants.filter((v) => v.price > 0);
    if (priced.length) return Math.min(...priced.map((v) => v.price));
    const params = p.pricing_params as Record<string, unknown> | null;
    return (params?.base_price as number) || (params?.credit_price as number) || 0;
  };
  const variantCount = products.reduce((s, p) => s + p.variants.length, 0);
  const totalStock = products.reduce((s, p) => s + stock(p), 0);

  const COLLAPSED_LIMIT = 8;
  const activeIds = useMemo(() => {
    if (active == null) return null;
    const cat = flatCats.find((c) => c.id === active);
    return cat ? new Set(subtreeIds(cat)) : new Set([active]);
  }, [active, flatCats]);
  const filtered = products.filter((p) =>
    (activeIds == null || activeIds.has(p.category_id)) &&
    (q === "" || p.title.toLowerCase().includes(q.toLowerCase())) &&
    (!inStockOnly || stock(p) > 0));
  const hasMore = filtered.length > COLLAPSED_LIMIT;
  const isFiltering = active != null || q !== "" || inStockOnly;
  const visible = (showAll || isFiltering) ? filtered : filtered.slice(0, COLLAPSED_LIMIT);

  const featured = [...products].sort((a, b) => stock(b) - stock(a)).slice(0, 3);

  return (
    <div>
      {/* ============ HERO ============ */}
      <section className="aura border-b border-line">
        <div className="w-full mx-auto max-w-[1200px] px-6 pt-12 pb-14 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
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

          {/* Live price board */}
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
            <div key={i} className="px-5 py-6">
              <div className="font-mono text-[26px] font-semibold tabular">{val}</div>
              <div className="text-[12.5px] text-muted mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ CATEGORIES ============ */}
      {cats.length > 0 && (
        <section className="w-full mx-auto max-w-[1200px] px-6 py-12">
          <SectionHead title="Danh mục" sub="Chọn nhóm sản phẩm bạn cần" />
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {flatCats
              .map((c) => ({ c, count: products.filter((p) => subtreeIds(c).includes(p.category_id)).length }))
              .filter((x) => x.count > 0)
              .map(({ c, count }) => (
                <button key={c.id} onClick={() => { setActive(c.id); document.getElementById("market")?.scrollIntoView({ behavior: "smooth" }); }}
                  className="text-left">
                  <Card interactive className="p-5 h-full">
                    <span className="grid place-items-center h-10 w-10 rounded-lg bg-iris-soft text-iris border border-iris/15">
                      <Store size={18} />
                    </span>
                    <div className="mt-4 font-medium text-[15px]">{c.name}</div>
                    <div className="text-[12.5px] text-muted mt-0.5">{count} sản phẩm</div>
                  </Card>
                </button>
              ))}
          </div>
        </section>
      )}

      {/* ============ FEATURED (pricing cards) ============ */}
      {featured.length > 0 && (
        <section className="border-y border-line bg-surface">
          <div className="w-full mx-auto max-w-[1200px] px-6 py-12">
            <SectionHead title="Nổi bật tuần này" sub="Hàng sẵn kho, giao ngay" />
            <div className="grid gap-5 md:grid-cols-3">
              {featured.map((p) => {
                const mp = minPrice(p);
                return (
                  <Link key={p.id} href={`/products/${p.id}`} className="group">
                    <Card className="p-0 flex flex-col h-full overflow-hidden transition-all duration-150 group-hover:shadow-card-lg group-hover:-translate-y-0.5">
                      {/* Header */}
                      <div className="px-5 pt-5 pb-4">
                        <div className="flex items-center gap-3">
                          <span className="grid place-items-center h-10 w-10 shrink-0 rounded-lg bg-iris-soft border border-iris/20 font-serif text-[14px] font-semibold text-iris">
                            {p.title.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-[15px] truncate">{p.title}</div>
                            <div className="flex items-center gap-1.5 text-[12px] text-faint">
                              {catName(p.category_id)}
                              <Verified size={11} className="text-iris" />
                              {p.sold_count > 0 && <span>· {p.sold_count} đã bán</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Variant list */}
                      <div className="px-5 flex-1">
                        <div className="border-t border-line pt-3 space-y-0">
                          {p.variants.slice(0, 3).map((v) => (
                            <div key={v.id} className="flex items-center gap-2 py-2 text-[13px]">
                              <span className="shrink-0 w-4 text-center">
                                {v.delivery_mode === "instant" ? <Bolt size={12} className="text-good" /> : <Shield size={12} className="text-faint" />}
                              </span>
                              <span className="text-muted truncate flex-1">{v.name}</span>
                              <span className="font-mono text-[12px] font-medium tabular shrink-0 text-fg">
                                {v.price > 0 ? vnd(v.price) : "Báo giá"}
                              </span>
                            </div>
                          ))}
                          {p.variants.length > 3 && (
                            <div className="text-[11.5px] text-faint pb-1">+{p.variants.length - 3} gói khác</div>
                          )}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="px-5 py-4 bg-raised/50 border-t border-line flex items-center justify-between mt-auto">
                        <div>
                          <div className="text-[10.5px] uppercase tracking-wide text-faint font-medium">Chỉ từ</div>
                          <div className="font-mono text-[20px] font-semibold tabular leading-tight text-iris-hi">
                            {mp > 0 ? vnd(mp) : "Báo giá"}
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-iris group-hover:text-iris-hi transition-colors">
                          Chọn gói <ArrowRight size={14} />
                        </span>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ============ MARKET (full listing) ============ */}
      <section id="market" className="w-full mx-auto max-w-[1200px] px-6 py-12 scroll-mt-20">
        <SectionHead title="Toàn bộ sản phẩm" sub="Lọc, tìm kiếm và mua ngay" />

        {flatCats.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Pill active={active == null} onClick={() => setActive(null)}>Tất cả</Pill>
            {flatCats.map((c) => <Pill key={c.id} active={active === c.id} onClick={() => setActive(c.id)}>{c.name}</Pill>)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm sản phẩm…"
              className="h-9 w-full rounded-lg bg-surface border border-line pl-9 pr-3 text-[13px] placeholder:text-faint focus:border-iris transition-colors" />
          </div>
          <button onClick={() => setInStockOnly((v) => !v)}
            className={cn("flex items-center gap-2 h-9 px-3 rounded-lg border text-[13px] font-medium transition-colors",
              inStockOnly ? "border-good/40 bg-good-soft text-good" : "border-line bg-surface text-muted hover:text-fg")}>
            <span className={cn("h-3.5 w-6 rounded-full relative transition-colors", inStockOnly ? "bg-good" : "bg-line-2")}>
              <span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-all", inStockOnly ? "left-3" : "left-0.5")} />
            </span>
            Chỉ còn hàng
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

        {loading && <Spinner label="Đang tải chợ…" />}
        {error && !loading && <Card className="p-5 text-bad text-sm">{error}</Card>}
        {!loading && !error && filtered.length === 0 && <Card className="p-6 text-muted text-sm">Không có sản phẩm phù hợp.</Card>}

        {!loading && visible.length > 0 && (view === "table" ? (
          <Card className="overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[12px] text-faint border-b border-line">
                  <th className="font-medium px-5 py-3">Sản phẩm</th>
                  <th className="font-medium px-3 py-3 hidden sm:table-cell">Danh mục</th>
                  <th className="font-medium px-3 py-3">Tồn kho</th>
                  <th className="font-medium px-3 py-3 hidden md:table-cell">Ký quỹ</th>
                  <th className="font-medium px-3 py-3 text-right">Giá từ</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const inStock = stock(p) > 0;
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-raised transition-colors">
                      <td className="px-5 py-3">
                        <Link href={`/products/${p.id}`} className="flex items-center gap-3">
                          <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-raised border border-line font-serif text-[13px] font-semibold text-iris">{p.title.slice(0, 2).toUpperCase()}</span>
                          <span className="min-w-0">
                            <span className="block font-medium text-[13.5px] truncate">{p.title}</span>
                            <span className="flex items-center gap-1.5 text-[12px] text-faint">
                              {p.variants.length} gói <Verified size={11} className="text-iris" />
                              {p.rating_avg != null && p.rating_avg > 0 && <><Star size={11} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}</>}
                              {p.sold_count > 0 && <span>· {p.sold_count} đã bán</span>}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-muted hidden sm:table-cell">{catName(p.category_id)}</td>
                      <td className="px-3 py-3">{inStock ? <Tag tone="good">● {stock(p)}</Tag> : <Tag tone="warn">Theo yêu cầu</Tag>}</td>
                      <td className="px-3 py-3 text-[13px] text-muted hidden md:table-cell">{p.escrow_days} ngày</td>
                      <td className="px-3 py-3 text-right font-mono text-[13.5px] font-semibold tabular">{vnd(minPrice(p))}</td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/products/${p.id}`}><Button size="sm" variant="secondary">Xem</Button></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {visible.map((p, i) => {
              const inStock = stock(p) > 0;
              return (
                <Link key={p.id} href={`/products/${p.id}`} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
                  <Card interactive className="p-4 h-full">
                    <div className="flex items-start gap-3">
                      <span className="grid place-items-center h-10 w-10 shrink-0 rounded-lg bg-raised border border-line font-serif text-[15px] font-semibold text-iris">{p.title.slice(0, 2).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-[14px] truncate">{p.title}</div>
                          <div className="font-mono text-[13.5px] font-semibold tabular shrink-0">{vnd(minPrice(p))}</div>
                        </div>
                        <div className="text-[12px] text-faint mt-0.5">{catName(p.category_id)}</div>
                        <div className="mt-3 flex items-center gap-2">
                          {inStock ? <Tag tone="good">● Còn {stock(p)}</Tag> : <Tag tone="warn">Theo yêu cầu</Tag>}
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
              {showAll ? "Thu gọn" : `Xem tất cả ${filtered.length} sản phẩm`}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={cn("transition-transform", showAll && "rotate-180")}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        )}
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="border-t border-line bg-surface">
        <div className="w-full mx-auto max-w-[1200px] px-6 py-12">
          <SectionHead title="Cách hoạt động" sub="Chỉ 3 bước để nhận hàng an toàn" />
          <div className="grid gap-5 md:grid-cols-3">
            {[
              { step: "1", icon: <Search size={22} />, title: "Chọn sản phẩm", desc: "Duyệt danh mục, so sánh giá và chọn gói phù hợp nhu cầu." },
              { step: "2", icon: <Shield size={22} />, title: "Thanh toán ký quỹ", desc: "Tiền được giữ an toàn trong tài khoản ký quỹ cho đến khi bạn xác nhận nhận hàng." },
              { step: "3", icon: <Check size={22} />, title: "Nhận hàng & xác nhận", desc: "Kiểm tra sản phẩm, xác nhận hoàn tất — tiền chuyển cho nhà bán." },
            ].map((item) => (
              <Card key={item.step} className="p-6 relative">
                <span className="absolute top-4 right-5 font-mono text-[40px] font-bold text-faint">{item.step}</span>
                <span className="grid place-items-center h-11 w-11 rounded-lg bg-iris-soft text-iris border border-iris/15">
                  {item.icon}
                </span>
                <div className="mt-4 font-medium text-[15px]">{item.title}</div>
                <p className="mt-1.5 text-[13px] text-muted leading-relaxed">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WHY US ============ */}
      <section className="w-full mx-auto max-w-[1200px] px-6 py-12">
        <SectionHead title="Tại sao chọn chúng tôi" sub="Nền tảng được thiết kế cho sự tin cậy" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: <Shield size={20} />, title: "Ký quỹ bảo vệ", desc: "Tiền được giữ an toàn, chỉ giải ngân khi người mua xác nhận." },
            { icon: <Bolt size={20} />, title: "Giao ngay tự động", desc: "Sản phẩm giao tức thì sau thanh toán, không cần chờ đợi." },
            { icon: <Verified size={20} />, title: "Nhà bán xác minh", desc: "Mọi nhà bán đều được xác minh danh tính và chất lượng hàng hoá." },
            { icon: <Clock size={20} />, title: "Hỗ trợ 24/7", desc: "Đội ngũ hỗ trợ luôn sẵn sàng giải quyết mọi vấn đề." },
          ].map((item) => (
            <Card key={item.title} interactive className="p-5">
              <span className="grid place-items-center h-10 w-10 rounded-lg bg-iris-soft text-iris border border-iris/15">
                {item.icon}
              </span>
              <div className="mt-4 font-medium text-[15px]">{item.title}</div>
              <p className="mt-1 text-[13px] text-muted leading-relaxed">{item.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ============ TESTIMONIALS ============ */}
      <section className="border-y border-line bg-surface">
        <div className="w-full mx-auto max-w-[1200px] px-6 py-12">
          <SectionHead title="Khách hàng nói gì" sub="Đánh giá từ người dùng thực tế" />
          <div className="grid gap-5 md:grid-cols-3">
            {[
              { name: "Minh Tuấn", role: "Chủ agency marketing", initials: "MT", quote: "Mua proxy số lượng lớn rất nhanh, ký quỹ giúp yên tâm. Đã dùng hơn 6 tháng, chưa gặp vấn đề gì.", rating: 5 },
              { name: "Thu Hà", role: "Freelancer", initials: "TH", quote: "Tài khoản giao đúng mô tả, hỗ trợ phản hồi cực nhanh. Giá cả cạnh tranh hơn nhiều chỗ khác.", rating: 5 },
              { name: "Đức Anh", role: "Quản lý TMĐT", initials: "ĐA", quote: "Hệ thống ký quỹ minh bạch, giải quyết tranh chấp công bằng. Đội ngũ support rất chuyên nghiệp.", rating: 4 },
            ].map((t) => (
              <Card key={t.name} className="p-6">
                <div className="flex items-center gap-1 text-warn text-[14px]" aria-label={`${t.rating} trên 5 sao`}>
                  {Array.from({ length: t.rating }, (_, i) => <Star key={i} size={14} className="fill-warn" />)}
                  {Array.from({ length: 5 - t.rating }, (_, i) => <Star key={`e${i}`} size={14} className="text-line-2" />)}
                </div>
                <p className="mt-3 text-[13.5px] text-muted leading-relaxed italic">&ldquo;{t.quote}&rdquo;</p>
                <div className="mt-4 flex items-center gap-3">
                  <span className="grid place-items-center h-9 w-9 rounded-full bg-iris-soft text-iris text-[13px] font-semibold border border-iris/15">{t.initials}</span>
                  <div>
                    <div className="text-[13.5px] font-medium">{t.name}</div>
                    <div className="text-[12px] text-faint">{t.role}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <FaqSection />

      {/* ============ CTA BANNER ============ */}
      <section className="border-t border-line aura">
        <div className="w-full mx-auto max-w-[1200px] px-6 py-16 text-center">
          <h2 className="font-serif text-[clamp(1.6rem,3vw,2.4rem)] tracking-tight">
            Bắt đầu bán hàng trên <span className="text-iris italic">Proxora</span>
          </h2>
          <p className="mt-3 text-[14px] text-muted max-w-md mx-auto leading-relaxed">
            Đăng ký tài khoản nhà bán, đăng sản phẩm và bắt đầu kiếm thu nhập từ hàng hoá số của bạn.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/register"><Button size="lg">Đăng ký bán hàng <ArrowRight size={16} /></Button></Link>
            <Link href="#market"><Button size="lg" variant="secondary">Xem chợ</Button></Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-serif text-[24px] tracking-tight">{title}</h2>
      <p className="text-[13.5px] text-muted mt-1">{sub}</p>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors",
        active ? "bg-fg text-surface border-fg" : "bg-surface text-muted border-line hover:text-fg hover:border-line-2")}>
      {children}
    </button>
  );
}

const FAQ_ITEMS = [
  { q: "Ký quỹ (escrow) hoạt động như thế nào?", a: "Khi bạn thanh toán, tiền được giữ trong tài khoản ký quỹ. Nhà bán giao hàng, bạn kiểm tra và xác nhận — lúc đó tiền mới chuyển cho nhà bán. Nếu có vấn đề, bạn mở tranh chấp trong thời gian ký quỹ." },
  { q: "Tôi có thể yêu cầu hoàn tiền không?", a: "Có. Trong thời gian ký quỹ (thường 3 ngày), nếu sản phẩm không đúng mô tả, bạn có thể mở tranh chấp. Đội ngũ hỗ trợ sẽ xem xét và hoàn tiền nếu nhà bán vi phạm." },
  { q: "Sản phẩm giao ngay tự động là gì?", a: "Một số sản phẩm được cấu hình giao tự động — ngay sau khi thanh toán thành công, bạn nhận được thông tin tài khoản hoặc dữ liệu mà không cần chờ nhà bán xử lý thủ công." },
  { q: "Làm sao để trở thành nhà bán?", a: "Đăng ký tài khoản, hoàn tất xác minh danh tính (KYC), sau đó bạn có thể đăng sản phẩm và bắt đầu bán. Quy trình xác minh thường mất 1-2 ngày làm việc." },
  { q: "Phương thức thanh toán nào được hỗ trợ?", a: "Chúng tôi hỗ trợ chuyển khoản ngân hàng nội địa, ví điện tử (Momo, ZaloPay), và USDT. Số dư ví trên nền tảng có thể dùng để mua hàng trực tiếp." },
  { q: "Dữ liệu cá nhân của tôi có an toàn không?", a: "Mọi dữ liệu được mã hoá và lưu trữ theo tiêu chuẩn bảo mật. Chúng tôi không chia sẻ thông tin cá nhân với bên thứ ba ngoài mục đích vận hành nền tảng." },
  { q: "Thời gian giao hàng trung bình là bao lâu?", a: "Sản phẩm tự động giao ngay sau khi thanh toán. Với sản phẩm thủ công, nhà bán thường xử lý trong vòng 1–12 giờ tuỳ loại sản phẩm và múi giờ." },
  { q: "Tôi có thể mua số lượng lớn (bulk) không?", a: "Có. Nhiều sản phẩm hỗ trợ mua bulk với giá chiết khấu. Chọn số lượng khi đặt hàng — hệ thống sẽ tự tính giá theo bậc nếu nhà bán đã cấu hình." },
  { q: "Nhà bán có bị giữ tiền không?", a: "Tiền được giữ trong ký quỹ cho đến khi người mua xác nhận nhận hàng hoặc hết thời gian ký quỹ. Sau đó tiền tự động chuyển vào ví nhà bán." },
  { q: "Proxy và tài khoản có bảo hành không?", a: "Tuỳ từng nhà bán và sản phẩm. Thông tin bảo hành được ghi rõ trên trang sản phẩm. Nếu sản phẩm lỗi trong thời gian bảo hành, bạn có thể mở tranh chấp." },
  { q: "Làm sao để liên hệ hỗ trợ?", a: "Bạn có thể mở tranh chấp trực tiếp trên đơn hàng, hoặc liên hệ qua email support@proxora.vn. Đội ngũ hỗ trợ phản hồi trong vòng 24 giờ làm việc." },
  { q: "Tài khoản bị khoá thì phải làm sao?", a: "Liên hệ hỗ trợ kèm email đăng ký để được xác minh và mở khoá. Tài khoản thường bị khoá khi vi phạm điều khoản sử dụng hoặc phát hiện hoạt động bất thường." },
];

function FaqSection() {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const mid = Math.ceil(FAQ_ITEMS.length / 2);
  const left = FAQ_ITEMS.slice(0, mid);
  const right = FAQ_ITEMS.slice(mid);

  const renderItem = (item: (typeof FAQ_ITEMS)[number], i: number) => (
    <Card key={i} className="overflow-hidden">
      <button
        onClick={() => toggle(i)}
        className="flex items-center justify-between w-full px-5 py-4 text-left"
      >
        <span className="font-medium text-[14px] pr-4">{item.q}</span>
        <ChevronIcon open={openSet.has(i)} />
      </button>
      {openSet.has(i) && (
        <div className="px-5 pb-4 text-[13px] text-muted leading-relaxed border-t border-line pt-3">
          {item.a}
        </div>
      )}
    </Card>
  );

  return (
    <section className="w-full mx-auto max-w-[1200px] px-6 py-12">
      <SectionHead title="Câu hỏi thường gặp" sub="Giải đáp nhanh các thắc mắc phổ biến" />
      <div className="grid gap-2 md:grid-cols-2 md:gap-x-5 md:gap-y-2 items-start">
        <div className="space-y-2">
          {left.map((item, i) => renderItem(item, i))}
        </div>
        <div className="space-y-2">
          {right.map((item, i) => renderItem(item, mid + i))}
        </div>
      </div>
    </section>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round"
      className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PriceBoard({ products, catName, stock, minPrice, loading }: {
  products: ProductDetail[]; catName: (id: number) => string;
  stock: (p: ProductDetail) => number; minPrice: (p: ProductDetail) => number; loading: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-raised/60">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-bad/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-good/60" />
        </span>
        <span className="text-[12.5px] font-medium text-muted ml-1">Bảng giá trực tiếp</span>
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-good"><span className="h-1.5 w-1.5 rounded-full bg-good animate-pulse" /> trực tuyến</span>
      </div>
      <div className="divide-y divide-line">
        {loading && <div className="px-4 py-10"><Spinner /></div>}
        {!loading && products.slice(0, 5).map((p) => (
          <Link key={p.id} href={`/products/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised transition-colors">
            <span className="grid place-items-center h-8 w-8 rounded-md bg-raised border border-line font-serif text-[12px] font-semibold text-iris">{p.title.slice(0, 2).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium truncate">{p.title}</span>
              <span className="block text-[11.5px] text-faint">{catName(p.category_id)}</span>
            </span>
            {stock(p) > 0 ? <span className="text-[11px] text-good font-medium">● {stock(p)}</span> : <span className="text-[11px] text-faint">đặt</span>}
            <span className="font-mono text-[13px] font-semibold tabular w-[92px] text-right">{vnd(minPrice(p))}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
