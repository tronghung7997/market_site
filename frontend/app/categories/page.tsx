"use client";

/** Hub danh mục — dãy "NGĂN KỆ": mỗi danh mục một shelf, trái là định danh
 *  (icon ổn định + tên + meta + chip danh mục con), phải là 3 sản phẩm thật
 *  + ô "Xem tất cả →" trỏ sang /categories/[id]. Buyer thấy hàng ngay từ
 *  cấp danh mục thay vì phải click mù từng card như bản landing cũ.
 *  Danh mục chưa có hàng gom xuống một dòng cuối, không chiếm kệ. */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, vnd } from "@/lib/api";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { effectiveMinPrice } from "@/lib/pricing-display";
import type { Category, Product } from "@/lib/types";
import { Card, Spinner, Tag } from "@/components/ui";
import { ArrowRight, ChevronRight, Search } from "@/components/Icons";
import { categoryIcon } from "@/components/CategoryIcon";
import ProductTile from "@/components/ProductTile";

export default function CategoriesPage() {
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        // Không truyền page: hub cần đủ danh sách để chia kệ + đếm số mỗi kệ.
        const [c, p] = await Promise.all([api.categories(), api.products()]);
        setCats(c);
        setProducts(p.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được danh mục");
      } finally { setLoading(false); }
    })();
  }, []);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const topCats = cats.length > 0 ? cats : flatCats.filter((c) => c.parent_id == null);

  const productsOf = (c: Category) => {
    const ids = new Set(subtreeIds(c));
    return products.filter((p) => ids.has(p.category_id));
  };

  // Lọc theo cả tên danh mục CON — gõ "Telegram" phải ra kệ "Mạng xã hội".
  const matches = (c: Category) =>
    q === "" ||
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.children ?? []).some((s) => s.name.toLowerCase().includes(q.toLowerCase()));

  const shelves = topCats
    .map((c) => ({ c, items: productsOf(c) }))
    .filter(({ c, items }) => items.length > 0 && matches(c))
    .sort((a, b) => b.items.length - a.items.length);
  const empty = topCats.filter((c) => productsOf(c).length === 0);

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
      {/* Đầu trang gọn: đây là trang MUA SẮM, không phải landing */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-5">
        <div>
          <h1 className="font-serif text-[26px] sm:text-[28px] leading-tight tracking-tight font-semibold">Danh mục</h1>
          <p className="text-[13px] text-muted mt-1">
            {topCats.length} danh mục · {products.length} sản phẩm đang bán — chọn kệ hàng bạn cần.
          </p>
        </div>
        <div className="relative w-full sm:w-[280px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Lọc danh mục, vd Telegram…"
            className="h-9 w-full rounded-lg bg-surface border border-line pl-9 pr-3 text-[13px] placeholder:text-faint focus:border-iris transition-colors"
          />
        </div>
      </div>

      {loading && <Spinner label="Đang tải danh mục…" />}
      {error && !loading && <Card className="p-5 text-bad text-sm">{error}</Card>}
      {!loading && !error && shelves.length === 0 && (
        <Card className="p-8 text-center text-muted text-sm">Không có danh mục nào khớp &ldquo;{q}&rdquo;.</Card>
      )}

      {/* ============ CÁC NGĂN KỆ ============ */}
      <div className="space-y-4">
        {shelves.map(({ c, items }) => {
          const Icon = categoryIcon(c.name);
          const children = c.children ?? [];
          const minPrices = items.map((p) => effectiveMinPrice(p)).filter((v) => v > 0);
          const fromPrice = minPrices.length ? Math.min(...minPrices) : 0;
          const preview = items.slice(0, 3);
          return (
            <Card key={c.id} className="overflow-hidden">
              <div className="grid lg:grid-cols-[260px_minmax(0,1fr)]">
                {/* Định danh kệ */}
                <div className="p-5 lg:border-r border-b lg:border-b-0 border-line bg-raised/30 flex flex-col">
                  <Link href={`/categories/${c.id}`} className="group flex items-center gap-3">
                    <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-iris-soft text-iris border border-iris/15">
                      <Icon size={18} />
                    </span>
                    <div className="min-w-0">
                      <div className="font-serif text-[17px] leading-tight tracking-tight font-semibold group-hover:text-iris-hi transition-colors">
                        {c.name}
                      </div>
                      <div className="text-[12px] text-muted mt-0.5">
                        {items.length} sản phẩm{fromPrice > 0 && <> · từ <span className="font-mono tabular">{vnd(fromPrice)}</span></>}
                      </div>
                    </div>
                  </Link>

                  {children.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3.5">
                      {children.map((s) => (
                        <Link key={s.id} href={`/categories/${c.id}`}>
                          <Tag tone="neutral" className="hover:border-iris/40 hover:text-iris-hi transition-colors">{s.name}</Tag>
                        </Link>
                      ))}
                    </div>
                  )}

                  <Link
                    href={`/categories/${c.id}`}
                    className="mt-auto pt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-iris-hi hover:underline"
                  >
                    Vào danh mục <ArrowRight size={13} />
                  </Link>
                </div>

                {/* 3 sản phẩm đầu kệ + ô xem tất cả */}
                <div className="p-4 grid gap-3 grid-cols-2 lg:grid-cols-4 items-stretch">
                  {preview.map((p) => <ProductTile key={p.id} product={p} />)}
                  <Link href={`/categories/${c.id}`} className="h-full min-h-[120px]">
                    <div className="h-full rounded-card border border-dashed border-line-2 grid place-items-center text-center px-3 hover:border-iris/40 hover:bg-iris/4 transition-colors">
                      <span className="text-[13px] font-medium text-muted hover:text-iris-hi inline-flex items-center gap-1">
                        Xem tất cả {items.length} <ChevronRight size={14} />
                      </span>
                    </div>
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Danh mục chưa có hàng — một dòng, không chiếm kệ */}
      {!loading && !error && empty.length > 0 && (
        <p className="mt-5 text-[12.5px] text-faint">
          Sắp có hàng: {empty.map((c) => c.name).join(" · ")}
        </p>
      )}
    </div>
  );
}
