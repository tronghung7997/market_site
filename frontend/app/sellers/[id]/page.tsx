"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { Category, Product, SellerProfile } from "@/lib/types";
import { Card, Spinner, Tag } from "@/components/ui";
import { Check, ChevronRight, Package, Shield, Star, Verified } from "@/components/Icons";

function flattenCategories(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (list: Category[]) => list.forEach((c) => { out.push(c); walk(c.children ?? []); });
  walk(cats);
  return out;
}

export default function SellerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const sellerId = Number(id);
        const [s, p, c] = await Promise.all([
          api.sellerProfile(sellerId),
          api.productsBySeller(sellerId),
          api.categories().catch(() => []),
        ]);
        setSeller(s);
        setProducts(p);
        setCategories(c);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tìm thấy nhà bán");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const categoryNames = useMemo(() => {
    if (!categories.length || !products.length) return [];
    const flat = flattenCategories(categories);
    const ids = Array.from(new Set(products.map((p) => p.category_id)));
    return ids.map((cid) => flat.find((c) => c.id === cid)?.name).filter((n): n is string => !!n);
  }, [categories, products]);

  const totalSold = useMemo(() => products.reduce((sum, p) => sum + (p.sold_count ?? 0), 0), [products]);
  const minEscrow = useMemo(
    () => (products.length ? Math.min(...products.map((p) => p.escrow_days)) : null),
    [products],
  );

  if (loading) return <div className="w-full mx-auto max-w-[1200px] px-6 py-16"><Spinner /></div>;
  if (error || !seller) return <div className="w-full mx-auto max-w-[1200px] px-6 py-16"><Card className="p-6 text-bad text-sm">{error ?? "Không tìm thấy nhà bán"}</Card></div>;

  const displayName = seller.business_name ?? seller.email.split("@")[0];
  const hasLeftCol = !!seller.bio || categoryNames.length > 0;

  const stats: { label: string; value: string; icon: ReactNode }[] = [
    {
      label: seller.review_count > 0 ? `đánh giá (${seller.review_count})` : "đánh giá",
      value: seller.rating_avg != null ? seller.rating_avg.toFixed(1) : "—",
      icon: <Star size={11} className="text-warn fill-warn" />,
    },
    { label: "đơn hoàn tất", value: String(seller.completed_order_count), icon: <Check size={11} className="text-white/35" /> },
    { label: "sản phẩm đã bán", value: totalSold.toLocaleString("vi-VN"), icon: <Package size={11} className="text-white/35" /> },
    { label: "ký quỹ tối thiểu", value: minEscrow != null ? `${minEscrow}d` : "—", icon: <Shield size={11} className="text-white/35" /> },
  ];

  return (
    <div className="w-full flex flex-col">
      {/* ---- Trust band ---- */}
      <section className="w-full bg-ink-panel dotgrid-dark relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 70% at 12% 0%, rgba(129,140,248,0.16), transparent 60%), radial-gradient(45% 55% at 100% 100%, rgba(129,140,248,0.08), transparent 55%)",
          }}
        />
        <div className="relative w-full mx-auto max-w-[1200px] px-6 pt-6 pb-8">
          <nav className="flex items-center gap-1.5 text-[12.5px] text-white/40 mb-6">
            <Link href="/" className="hover:text-white/75 transition-colors">Chợ</Link>
            <ChevronRight size={12} className="text-white/25" />
            <span className="text-white/70 truncate max-w-[400px]">{displayName}</span>
          </nav>

          <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
            <div className="flex items-center gap-4">
              <div className="relative shrink-0 animate-seal">
                <span className="grid place-items-center h-[72px] w-[72px] rounded-full bg-white/[0.06] text-white font-serif text-[24px] font-semibold border-2 border-dashed border-iris-hi/45">
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
                <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center h-6 w-6 rounded-full bg-iris-hi text-white border-2 border-ink-panel">
                  <Verified size={11} />
                </span>
              </div>
              <div>
                <h1 className="font-serif text-[25px] font-semibold tracking-tight text-white leading-tight">{displayName}</h1>
                <div className="mt-2 flex items-center gap-2.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/85">
                    <Verified size={10} className="text-iris-hi" /> Đã xác minh
                  </span>
                  {seller.member_since && (
                    <span className="text-[12px] text-white/40">Thành viên từ {formatDate(seller.member_since)}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 min-w-[12px] hidden sm:block" />

            <div className="w-full sm:w-auto grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:items-stretch sm:gap-0 sm:divide-x sm:divide-white/10">
              {stats.map((s, i) => (
                <div key={s.label} className="sm:px-5 sm:first:pl-0 sm:last:pr-0 animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="font-mono text-[21px] font-semibold text-white tabular leading-none whitespace-nowrap">{s.value}</div>
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] text-white/45 whitespace-nowrap">{s.icon}{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Body ---- */}
      <div className="w-full mx-auto max-w-[1200px] px-6 py-6">
        <div className={hasLeftCol ? "grid gap-6 lg:grid-cols-[280px_1fr] items-start" : ""}>
          {hasLeftCol && (
            <div className="flex flex-col gap-4">
              {seller.bio && (
                <Card className="p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-faint mb-2">Giới thiệu</div>
                  <p className="text-[13.5px] text-muted leading-relaxed whitespace-pre-wrap">{seller.bio}</p>
                </Card>
              )}
              {categoryNames.length > 0 && (
                <Card className="p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-faint mb-2.5">Ngành hàng</div>
                  <div className="flex flex-wrap gap-1.5">
                    {categoryNames.map((name) => <Tag key={name} tone="neutral">{name}</Tag>)}
                  </div>
                </Card>
              )}
            </div>
          )}

          <div className="min-w-0">
            <h2 className="font-serif text-[18px] tracking-tight mb-4">Sản phẩm đang bán ({products.length})</h2>
            {products.length === 0 ? (
              <Card className="p-6 text-muted text-sm">Nhà bán này chưa có sản phẩm đang bán.</Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {products.map((p, i) => (
                  <Link key={p.id} href={`/products/${p.id}`} className="animate-rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    <Card interactive className="p-4 h-full">
                      <div className="flex items-start gap-3">
                        <span className="grid place-items-center h-10 w-10 shrink-0 rounded-lg bg-raised border border-line font-serif text-[15px] font-semibold text-iris">
                          {p.title.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-[14px] truncate">{p.title}</div>
                          <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted">
                            {p.rating_avg != null && p.rating_count > 0 && (
                              <span className="flex items-center gap-1">
                                <Star size={11} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}
                              </span>
                            )}
                            <Tag tone="neutral"><Shield size={11} /> {p.escrow_days}d</Tag>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
