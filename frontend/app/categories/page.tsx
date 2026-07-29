"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import type { Category, Product } from "@/lib/types";
import { Card, Spinner, Button } from "@/components/ui";
import {
  ArrowRight, Bolt, Check, Grid, Package, Search, Shield, Star, Store, Users, Verified, Wallet,
} from "@/components/Icons";

const ICONS = [Store, Package, Wallet, Shield, Bolt, Users, Star, Grid, Verified, Check];
function iconFor(index: number) {
  return ICONS[index % ICONS.length];
}

export default function CategoriesPage() {
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [c, p] = await Promise.all([api.categories(), api.products()]);
        setCats(c);
        setProducts(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được danh mục");
      } finally { setLoading(false); }
    })();
  }, []);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const topCats = cats.length > 0 ? cats : flatCats.filter((c) => c.parent_id == null);
  const countFor = (c: Category) => products.filter((p) => subtreeIds(c).includes(p.category_id)).length;

  const filtered = topCats.filter((c) => q === "" || c.name.toLowerCase().includes(q.toLowerCase()));
  const totalProducts = products.length;
  const sortedByCount = [...topCats].map((c) => ({ c, count: countFor(c) })).sort((a, b) => b.count - a.count);
  const busiest = sortedByCount.slice(0, 3);

  return (
    <div>
      {/* ============ HERO ============ */}
      <section className="aura border-b border-line">
        <div className="w-full mx-auto max-w-[1200px] px-6 pt-14 pb-12 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-muted shadow-card">
            <Grid size={13} className="text-iris" /> {topCats.length} danh mục · {totalProducts} sản phẩm đang bán
          </div>
          <h1 className="font-serif text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.08] tracking-tight mt-5">
            Khám phá mọi <span className="italic text-iris">danh mục sản phẩm</span>
          </h1>
          <p className="mt-4 max-w-xl mx-auto text-[15px] text-muted leading-relaxed">
            Từ tài khoản mạng xã hội đến proxy và dữ liệu số — mọi danh mục đều có nhà bán đã xác minh, giao ngay và được bảo vệ bằng ký quỹ.
          </p>
          <div className="mt-7 relative max-w-md mx-auto">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm danh mục…"
              className="h-11 w-full rounded-full bg-surface border border-line pl-10 pr-4 text-[14px] placeholder:text-faint focus:border-iris transition-colors shadow-card" />
          </div>
        </div>
      </section>

      {loading && <Spinner label="Đang tải danh mục…" />}
      {error && !loading && <Card className="mx-6 my-8 max-w-[1200px] md:mx-auto p-5 text-bad text-sm">{error}</Card>}

      {!loading && !error && (
        <>
          {/* ============ BUSIEST CATEGORIES ============ */}
          {busiest.some((b) => b.count > 0) && (
            <section className="border-b border-line bg-surface">
              <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
                <SectionHead title="Được tìm nhiều nhất" sub="Danh mục có nhiều sản phẩm và giao dịch nhất" />
                <div className="grid gap-5 md:grid-cols-3">
                  {busiest.map(({ c, count }, i) => {
                    const Icon = iconFor(i);
                    return (
                      <Link key={c.id} href={`/?category=${c.id}#market`} className="group">
                        <Card interactive className="p-6 h-full relative overflow-hidden">
                          <span className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-iris-soft opacity-40 group-hover:opacity-70 transition-opacity" />
                          <span className="relative grid place-items-center h-12 w-12 rounded-xl bg-iris-soft text-iris border border-iris/15">
                            <Icon size={22} />
                          </span>
                          <div className="relative mt-4 font-serif text-[19px] tracking-tight">{c.name}</div>
                          <div className="relative text-[13px] text-muted mt-1">{count} sản phẩm đang bán</div>
                          <span className="relative mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-iris group-hover:text-iris-hi transition-colors">
                            Xem sản phẩm <ArrowRight size={14} />
                          </span>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ============ ALL CATEGORIES ============ */}
          <section className="w-full mx-auto max-w-[1200px] px-6 py-12">
            <SectionHead title="Tất cả danh mục" sub="Chọn danh mục để xem toàn bộ sản phẩm liên quan" />
            {filtered.length === 0 ? (
              <Card className="p-8 text-center text-muted text-sm">Không tìm thấy danh mục phù hợp với &ldquo;{q}&rdquo;.</Card>
            ) : (
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
                {filtered.map((c, i) => {
                  const Icon = iconFor(i + 3);
                  const count = countFor(c);
                  const subCount = (c.children ?? []).length;
                  return (
                    <Link key={c.id} href={`/?category=${c.id}#market`} className="group animate-rise" style={{ animationDelay: `${i * 30}ms` }}>
                      <Card interactive className="p-5 h-full flex flex-col">
                        <span className="grid place-items-center h-11 w-11 rounded-lg bg-raised border border-line text-iris group-hover:bg-iris-soft group-hover:border-iris/20 transition-colors">
                          <Icon size={19} />
                        </span>
                        <div className="mt-4 font-medium text-[15px]">{c.name}</div>
                        <div className="text-[12.5px] text-muted mt-0.5 flex-1">
                          {count} sản phẩm{subCount > 0 && ` · ${subCount} danh mục con`}
                        </div>
                        <span className={cn("mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium transition-colors",
                          count > 0 ? "text-iris group-hover:text-iris-hi" : "text-faint")}>
                          {count > 0 ? "Khám phá" : "Sắp có hàng"} <ArrowRight size={13} />
                        </span>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* ============ WHY BROWSE BY CATEGORY ============ */}
          <section className="border-y border-line bg-surface">
            <div className="w-full mx-auto max-w-[1200px] px-6 py-12">
              <SectionHead title="Vì sao nên duyệt theo danh mục" sub="Tìm đúng thứ bạn cần nhanh hơn" />
              <div className="grid gap-5 sm:grid-cols-3">
                {[
                  { icon: <Search size={20} />, title: "Lọc chính xác", desc: "Mỗi danh mục gom đúng nhóm sản phẩm, giúp bạn so sánh giá và gói dễ dàng hơn." },
                  { icon: <Shield size={20} />, title: "Ký quỹ mọi giao dịch", desc: "Dù chọn danh mục nào, mọi đơn hàng đều được bảo vệ bằng ký quỹ minh bạch." },
                  { icon: <Bolt size={20} />, title: "Giao ngay tự động", desc: "Nhiều sản phẩm trong từng danh mục hỗ trợ giao hàng tức thì sau thanh toán." },
                ].map((item) => (
                  <Card key={item.title} className="p-5">
                    <span className="grid place-items-center h-10 w-10 rounded-lg bg-iris-soft text-iris border border-iris/15">
                      {item.icon}
                    </span>
                    <div className="mt-4 font-medium text-[15px]">{item.title}</div>
                    <p className="mt-1 text-[13px] text-muted leading-relaxed">{item.desc}</p>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          {/* ============ CTA ============ */}
          <section className="border-t border-line aura">
            <div className="w-full mx-auto max-w-[1200px] px-6 py-16 text-center">
              <h2 className="font-serif text-[clamp(1.5rem,2.8vw,2.2rem)] tracking-tight">
                Không tìm thấy danh mục bạn cần?
              </h2>
              <p className="mt-3 text-[14px] text-muted max-w-md mx-auto leading-relaxed">
                Xem toàn bộ chợ hoặc trở thành nhà bán và mở danh mục mới cho sản phẩm của riêng bạn.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Link href="/#market"><Button size="lg">Xem toàn bộ chợ <ArrowRight size={16} /></Button></Link>
                <Link href="/register"><Button size="lg" variant="secondary">Trở thành nhà bán</Button></Link>
              </div>
            </div>
          </section>
        </>
      )}
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
