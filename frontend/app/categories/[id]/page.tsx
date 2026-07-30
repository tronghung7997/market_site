"use client";

/** Trang MỘT danh mục — URL bền để duyệt/share/quay lại từ breadcrumb:
 *  breadcrumb → tên + meta (N sản phẩm · từ Xđ) → chip danh mục con (bấm =
 *  lọc theo nhánh con) → toolbar (còn hàng · sắp xếp) → lưới ProductTile.
 *  Dữ liệu: /categories + /products?category_id=... — server lọc theo cả
 *  nhánh (cùng ngữ nghĩa subtreeIds), client chỉ còn lọc con/sắp xếp trên
 *  tập đã đúng; cùng bảng nguồn với hub nên hai trang không lệch số. */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { effectiveMinPrice } from "@/lib/pricing-display";
import type { Category, Product } from "@/lib/types";
import { Card, Spinner } from "@/components/ui";
import { ChevronRight } from "@/components/Icons";
import { categoryIcon } from "@/components/CategoryIcon";
import ProductTile from "@/components/ProductTile";

const SORT_OPTIONS = [
  { value: "newest", label: "Mới nhất" },
  { value: "bestseller", label: "Bán chạy" },
  { value: "price_asc", label: "Giá thấp → cao" },
  { value: "price_desc", label: "Giá cao → thấp" },
] as const;

export default function CategoryPage() {
  const { id } = useParams<{ id: string }>();
  const categoryId = Number(id);
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subFilter, setSubFilter] = useState<number | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState<string>("newest");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Lọc theo danh mục ngay tại server (đúng ngữ nghĩa subtree như client
        // từng lọc tay) — khỏi tải cả chợ về chỉ để xem một danh mục. Đổi
        // categoryId (điều hướng giữa các trang con) thì tải lại đúng nhánh đó.
        const [c, p] = await Promise.all([api.categories(), api.products({ categoryId })]);
        setCats(c);
        setProducts(p.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được danh mục");
      } finally { setLoading(false); }
    })();
  }, [categoryId]);

  // Đổi danh mục (điều hướng giữa các trang con) → bỏ bộ lọc con đang chọn.
  useEffect(() => { setSubFilter(null); }, [categoryId]);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const category = flatCats.find((c) => c.id === categoryId) ?? null;
  const parent = category?.parent_id != null ? flatCats.find((c) => c.id === category.parent_id) ?? null : null;
  const children = category?.children ?? [];

  const stock = (p: Product) => (p.variants ?? []).reduce((s, v) => s + (v.stock_count ?? 0), 0);

  const inCategory = useMemo(() => {
    if (!category) return [];
    const ids = new Set(subtreeIds(category));
    return products.filter((p) => ids.has(p.category_id));
  }, [category, products]);

  const countFor = (c: Category) => {
    const ids = new Set(subtreeIds(c));
    return products.filter((p) => ids.has(p.category_id)).length;
  };

  const shown = useMemo(() => {
    let list = inCategory;
    if (subFilter != null) {
      const sub = flatCats.find((c) => c.id === subFilter);
      const ids = sub ? new Set(subtreeIds(sub)) : new Set([subFilter]);
      list = list.filter((p) => ids.has(p.category_id));
    }
    if (inStockOnly) list = list.filter((p) => stock(p) > 0);
    const sorted = [...list];
    switch (sort) {
      case "bestseller": sorted.sort((a, b) => b.sold_count - a.sold_count); break;
      case "price_asc": sorted.sort((a, b) => (effectiveMinPrice(a) || Infinity) - (effectiveMinPrice(b) || Infinity)); break;
      case "price_desc": sorted.sort((a, b) => effectiveMinPrice(b) - effectiveMinPrice(a)); break;
      // "newest": giữ thứ tự API (created_at desc)
    }
    return sorted;
  }, [inCategory, subFilter, inStockOnly, sort, flatCats]);

  const minPrices = inCategory.map((p) => effectiveMinPrice(p)).filter((v) => v > 0);
  const fromPrice = minPrices.length ? Math.min(...minPrices) : 0;

  if (loading) return <div className="w-full mx-auto max-w-[1200px] px-6 py-20"><Spinner label="Đang tải danh mục…" /></div>;
  if (error || !category) return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
      <Card className="p-6 text-sm">
        <p className="text-bad">{error ?? "Không tìm thấy danh mục này."}</p>
        <Link href="/categories" className="inline-block mt-3 text-iris-hi hover:underline text-[13px]">← Tất cả danh mục</Link>
      </Card>
    </div>
  );

  const Icon = categoryIcon(category.name);

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] text-muted mb-4">
        <Link href="/" className="hover:text-fg transition-colors shrink-0">Chợ</Link>
        <ChevronRight size={12} className="text-faint shrink-0" />
        <Link href="/categories" className="hover:text-fg transition-colors shrink-0">Danh mục</Link>
        {parent && (
          <>
            <ChevronRight size={12} className="text-faint shrink-0" />
            <Link href={`/categories/${parent.id}`} className="hover:text-fg transition-colors shrink-0">{parent.name}</Link>
          </>
        )}
        <ChevronRight size={12} className="text-faint shrink-0" />
        <span className="text-faint truncate">{category.name}</span>
      </nav>

      {/* Định danh danh mục */}
      <div className="flex items-center gap-3.5">
        <span className="grid place-items-center h-11 w-11 shrink-0 rounded-xl bg-iris-soft text-iris border border-iris/15">
          <Icon size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-serif text-[24px] sm:text-[26px] leading-tight tracking-tight font-semibold">{category.name}</h1>
          <p className="text-[12.5px] text-muted mt-0.5">
            {inCategory.length} sản phẩm đang bán{fromPrice > 0 && <> · từ <span className="font-mono tabular font-medium text-fg">{vnd(fromPrice)}</span></>}
          </p>
        </div>
      </div>

      {/* Chip danh mục con — bấm để lọc theo nhánh */}
      {children.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={() => setSubFilter(null)}
            className={cn("h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors",
              subFilter == null ? "bg-fg text-surface border-fg" : "bg-surface text-muted border-line hover:text-fg hover:border-line-2")}
          >
            Tất cả · {inCategory.length}
          </button>
          {children.map((c) => (
            <button
              key={c.id}
              onClick={() => setSubFilter(subFilter === c.id ? null : c.id)}
              className={cn("h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors",
                subFilter === c.id ? "bg-fg text-surface border-fg" : "bg-surface text-muted border-line hover:text-fg hover:border-line-2")}
            >
              {c.name} · {countFor(c)}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mt-4 mb-5">
        <button onClick={() => setInStockOnly((v) => !v)}
          className={cn("flex items-center gap-2 h-9 px-3 rounded-lg border text-[13px] font-medium transition-colors",
            inStockOnly ? "border-good/40 bg-good-soft text-good" : "border-line bg-surface text-muted hover:text-fg")}>
          <span className={cn("h-3.5 w-6 rounded-full relative transition-colors", inStockOnly ? "bg-good" : "bg-line-2")}>
            <span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-all", inStockOnly ? "left-3" : "left-0.5")} />
          </span>
          Chỉ còn hàng
        </button>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sắp xếp"
          className="ml-auto h-9 rounded-lg bg-surface border border-line px-2.5 text-[12.5px] text-muted focus:border-iris focus:outline-none cursor-pointer"
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Lưới sản phẩm */}
      {shown.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[13px] text-muted">
            {inCategory.length === 0
              ? "Danh mục này chưa có sản phẩm — nhà bán sẽ sớm mở hàng."
              : "Không có sản phẩm khớp bộ lọc — thử bỏ “Chỉ còn hàng” hoặc chọn nhánh khác."}
          </p>
          <Link href="/categories" className="inline-block mt-3 text-[13px] text-iris-hi hover:underline">← Xem danh mục khác</Link>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {shown.map((p) => <ProductTile key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
