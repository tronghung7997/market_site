"use client";

/** Các section THUẦN HIỂN THỊ của trang sản phẩm — cột tài liệu bên trái:
 *  định danh, thông số (data plate), mô tả, bảo hành, sản phẩm liên quan.
 *  Không state, không fetch (ReviewsCard tự fetch nên ở file riêng). */

import Link from "next/link";
import type { ReactNode } from "react";
import { vnd } from "@/lib/api";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { serviceLabel } from "@/lib/labels";
import { formatSpecKey as fmtKey } from "@/lib/utils";
import type { Product, ProductDetail } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { Bolt, Check, MessageCircle, Shield, Star, Verified } from "@/components/Icons";
import { MarkdownContent } from "@/components/MarkdownContent";

export function SectionHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
      <h2 className="font-serif text-[16px] font-semibold tracking-tight">{title}</h2>
      {aside}
    </div>
  );
}

/** Khối định danh: tag → tiêu đề serif → meta (rating link xuống #reviews,
 *  đã bán, sẵn hàng) → người bán → highlight. KHÔNG có giá — vùng giá duy
 *  nhất của trang nằm trong phiếu đặt hàng. */
export function ProductIdentity({ product }: { product: ProductDetail }) {
  const totalStock = product.variants.reduce((s, v) => s + v.stock_count, 0);
  const sellerName = product.seller_name ?? "seller";

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone="iris">{serviceLabel(product.service_type)}</Tag>
        <Tag tone="good">Đang bán</Tag>
        <Tag tone="neutral"><Shield size={11} /> Ký quỹ {product.escrow_days} ngày</Tag>
      </div>

      <h1 className="mt-3 font-serif text-[24px] sm:text-[28px] leading-[1.18] tracking-tight font-semibold">
        {product.title}
      </h1>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-[13px] text-muted">
        {product.rating_avg != null && product.rating_count > 0 && (
          <a href="#reviews" className="flex items-center gap-1 hover:text-fg transition-colors">
            <Star size={13} className="text-warn fill-warn" />
            <span className="font-semibold text-fg">{product.rating_avg.toFixed(1)}</span>
            <span className="underline decoration-line-2 underline-offset-2">{product.rating_count} đánh giá</span>
          </a>
        )}
        {product.sold_count > 0 && <span>Đã bán {product.sold_count.toLocaleString("vi-VN")}</span>}
        {totalStock > 0 && <span className="text-good font-medium">{totalStock} sẵn hàng</span>}
      </div>

      {/* Seller */}
      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-line">
        <span className="grid place-items-center h-8 w-8 shrink-0 rounded-full bg-raised border border-line text-[10px] font-bold text-muted">
          {sellerName.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link href={`/sellers/${product.seller_id}`} className="text-[13px] font-medium hover:underline truncate">
              {sellerName}
            </Link>
            <Tag tone="good"><Verified size={10} /> Xác minh</Tag>
          </div>
          <div className="text-[11.5px] text-faint mt-0.5">Gian hàng trên Proxora</div>
        </div>
        <Link
          href={`/sellers/${product.seller_id}`}
          className="shrink-0 flex items-center gap-1.5 text-[12.5px] font-medium text-iris-hi hover:underline"
        >
          <MessageCircle size={12} /> Nhắn tin
        </Link>
      </div>

      {product.highlight_text && (
        <div className="flex items-start gap-2 mt-4 px-3.5 py-2.5 rounded-lg bg-iris/4 border border-iris/12 text-[12.5px] leading-relaxed">
          <Bolt size={13} className="text-iris-hi shrink-0 mt-0.5" />
          <span>{product.highlight_text}</span>
        </div>
      )}
    </Card>
  );
}

/** "Data plate" thông số: lưới hairline (gap-px trên nền line), nhãn uppercase
 *  nhỏ + giá trị mono — giọng kỹ thuật của một chợ dữ liệu B2B. */
export function SpecsPlate({ specs }: { specs: Record<string, string> }) {
  const entries = Object.entries(specs);
  if (entries.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <SectionHead title="Thông số kỹ thuật" />
      <dl className="grid sm:grid-cols-2 gap-px bg-line">
        {entries.map(([key, val]) => (
          <div key={key} className="bg-surface px-5 py-3">
            <dt className="text-[10.5px] uppercase tracking-wider text-faint font-semibold">{fmtKey(key)}</dt>
            <dd className="mt-1 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words">{val}</dd>
          </div>
        ))}
        {entries.length % 2 === 1 && <div className="bg-surface hidden sm:block" aria-hidden />}
      </dl>
    </Card>
  );
}

export function DescriptionCard({ product }: { product: ProductDetail }) {
  if (!product.description && !(product.features && product.features.length > 0)) return null;
  return (
    <Card className="overflow-hidden">
      <SectionHead title="Mô tả sản phẩm" />
      <div className="p-5 space-y-4 text-[13.5px]">
        {product.description && <MarkdownContent>{product.description}</MarkdownContent>}
        {product.features && product.features.length > 0 && (
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {product.features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-muted">
                <Check size={14} className="text-good mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function WarrantyCard({ product }: { product: ProductDetail }) {
  return (
    <Card className="overflow-hidden">
      <SectionHead
        title="Bảo hành & ký quỹ"
        aside={<Tag tone="neutral"><Shield size={11} /> {product.escrow_days} ngày</Tag>}
      />
      <div className="p-5 space-y-4 text-[13px]">
        {product.warranty_text ? (
          <div className="text-muted leading-relaxed whitespace-pre-line">{product.warranty_text}</div>
        ) : (
          <p className="text-muted">Áp dụng chính sách ký quỹ {product.escrow_days} ngày theo quy định Proxora.</p>
        )}
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-4 text-muted">
          {[
            `Tiền giữ bởi Proxora trong ${product.escrow_days} ngày`,
            "Chỉ chuyển cho người bán khi bạn xác nhận",
            "Hoàn tiền 100% nếu không đúng mô tả",
            "Mở tranh chấp bất kỳ lúc nào trong thời hạn ký quỹ",
          ].map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check size={13} className="text-good mt-0.5 shrink-0" />{t}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function RelatedProducts({ items }: { items: Product[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="font-serif text-[16px] font-semibold tracking-tight mb-3">Sản phẩm liên quan</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((r) => {
          const rPrice = effectiveMinPrice(r);
          return (
            <Link key={r.id} href={`/products/${r.id}`} className="h-full">
              <Card interactive className="p-4 h-full flex flex-col">
                <div className="text-[13.5px] font-medium leading-snug line-clamp-2">{r.title}</div>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-faint">
                  {r.rating_avg != null && r.rating_count > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-muted">
                      <Star size={11} className="text-warn fill-warn" />
                      {r.rating_avg.toFixed(1)}
                    </span>
                  )}
                  {r.sold_count > 0 && <span>Đã bán {r.sold_count}</span>}
                  <Tag tone="iris">{serviceLabel(r.service_type)}</Tag>
                </div>
                <div className="mt-auto pt-3 flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-faint font-medium">Chỉ từ</span>
                  <span className="font-mono text-[14px] font-semibold tabular text-iris-hi">
                    {rPrice > 0 ? vnd(rPrice) : "Báo giá"}
                  </span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
