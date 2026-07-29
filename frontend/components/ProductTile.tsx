"use client";

/** Tile sản phẩm giàu thông tin dùng chung cho trang danh mục (hub + trang
 *  từng danh mục). Mọi dữ liệu lấy từ item của GET /products (đã kèm variants
 *  từ fix N+1) — không tốn request phụ:
 *  tên · ★ đánh giá · đã bán · số gói · tag giao hàng · giá "Chỉ từ" thật. */

import Link from "next/link";
import { vnd } from "@/lib/api";
import { effectiveMinPrice, isAdapterFulfilled } from "@/lib/pricing-display";
import type { Product } from "@/lib/types";
import { Card, Monogram, Tag } from "@/components/ui";
import { Bolt, Star } from "@/components/Icons";

/** Tag giao hàng: ưu tiên nói được "mua là có ngay" — adapter luôn sẵn,
 *  variant giao ngay cần còn kho; còn lại là hàng đặt theo yêu cầu. */
function deliveryTag(p: Product) {
  if (isAdapterFulfilled(p)) return <Tag tone="good"><Bolt size={10} /> Giao tự động</Tag>;
  const variants = p.variants ?? [];
  const instantStock = variants
    .filter((v) => v.delivery_mode === "instant")
    .reduce((s, v) => s + v.stock_count, 0);
  if (instantStock > 0) return <Tag tone="good"><Bolt size={10} /> Giao ngay · {instantStock}</Tag>;
  return <Tag tone="warn">Theo yêu cầu</Tag>;
}

export default function ProductTile({ product: p }: { product: Product }) {
  const mp = effectiveMinPrice(p);
  const variantCount = (p.variants ?? []).length;

  return (
    <Link href={`/products/${p.id}`} className="h-full">
      <Card interactive className="p-3.5 h-full flex flex-col">
        <div className="flex items-start gap-2.5">
          <Monogram text={p.title} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-snug line-clamp-2">{p.title}</div>
            <div className="mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] text-faint">
              {p.rating_avg != null && p.rating_count > 0 && (
                <span className="flex items-center gap-0.5 text-muted">
                  <Star size={10} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}
                </span>
              )}
              {p.sold_count > 0 && <span>Đã bán {p.sold_count}</span>}
              {variantCount > 1 && <span>{variantCount} gói</span>}
            </div>
          </div>
        </div>
        <div className="mt-auto pt-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-wide text-faint font-medium">Chỉ từ</div>
            <div className="font-mono text-[14.5px] font-semibold tabular text-iris-hi leading-tight">
              {mp > 0 ? vnd(mp) : "Báo giá"}
            </div>
          </div>
          <span className="shrink-0">{deliveryTag(p)}</span>
        </div>
      </Card>
    </Link>
  );
}
