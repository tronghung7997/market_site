"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import type { Product, SellerProfile } from "@/lib/types";
import { Card, Spinner, Tag } from "@/components/ui";
import { ChevronRight, Shield, Star, Verified } from "@/components/Icons";

export default function SellerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const sellerId = Number(id);
        const [s, p] = await Promise.all([
          api.sellerProfile(sellerId),
          api.productsBySeller(sellerId),
        ]);
        setSeller(s);
        setProducts(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tìm thấy nhà bán");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="w-full mx-auto max-w-[1200px] px-6 py-16"><Spinner /></div>;
  if (error || !seller) return <div className="w-full mx-auto max-w-[1200px] px-6 py-16"><Card className="p-6 text-bad text-sm">{error ?? "Không tìm thấy nhà bán"}</Card></div>;

  const displayName = seller.business_name ?? seller.email.split("@")[0];

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-6">
      <nav className="flex items-center gap-1.5 text-[12.5px] text-muted mb-3">
        <Link href="/" className="hover:text-fg transition-colors">Chợ</Link>
        <ChevronRight size={12} className="text-faint" />
        <span className="text-faint truncate max-w-[400px]">{displayName}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr] items-start">
        {/* ---- Seller info ---- */}
        <Card className="p-6">
          <span className="grid place-items-center h-14 w-14 rounded-full bg-iris-soft text-iris border border-iris/15 font-serif text-[18px] font-semibold">
            {displayName.slice(0, 2).toUpperCase()}
          </span>
          <h1 className="font-serif text-[19px] font-semibold tracking-tight mt-4">{displayName}</h1>
          <div className="mt-1.5"><Tag tone="good"><Verified size={10} /> Xác minh</Tag></div>

          <div className="mt-5 pt-4 border-t border-line grid grid-cols-2 gap-4">
            <div>
              <div className="font-mono text-[20px] font-semibold tabular">
                {seller.rating_avg != null ? seller.rating_avg.toFixed(1) : "—"}
              </div>
              <div className="text-[11.5px] text-faint mt-0.5 flex items-center gap-1">
                <Star size={11} className="text-warn fill-warn" /> {seller.review_count} đánh giá
              </div>
            </div>
            <div>
              <div className="font-mono text-[20px] font-semibold tabular">{seller.completed_order_count}</div>
              <div className="text-[11.5px] text-faint mt-0.5">đơn hoàn tất</div>
            </div>
          </div>
        </Card>

        {/* ---- Products ---- */}
        <div className="min-w-0">
          <h2 className="font-serif text-[18px] tracking-tight mb-4">Sản phẩm đang bán ({products.length})</h2>
          {products.length === 0 ? (
            <Card className="p-6 text-muted text-sm">Nhà bán này chưa có sản phẩm đang bán.</Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {products.map((p) => (
                <Link key={p.id} href={`/products/${p.id}`}>
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
  );
}
