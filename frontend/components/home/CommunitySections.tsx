"use client";

/** Hai section "cộng đồng" của trang chủ: người bán uy tín (public) và đơn
 *  hàng gần đây (chỉ buyer đã đăng nhập). */

import Link from "next/link";
import { vnd } from "@/lib/api";
import { orderStatus } from "@/lib/order-status";
import type { Order, SellerSummary } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { ArrowRight, Star, Store } from "@/components/Icons";
import { SectionHead } from "./SectionHead";

export function TrustedSellers({ sellers }: { sellers: SellerSummary[] }) {
  if (sellers.length === 0) return null;
  return (
    <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
      <SectionHead title="Người bán uy tín" sub="Xếp hạng theo đơn hàng hoàn tất và đánh giá" />
      <div className="grid gap-2.5 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {sellers.map((s) => (
          <Link key={s.account_id} href={`/sellers/${s.account_id}`}>
            <Card interactive className="p-3 sm:p-4 h-full text-center">
              <span className="mx-auto grid place-items-center h-9 w-9 sm:h-11 sm:w-11 rounded-full bg-iris-soft text-iris border border-iris/15">
                <Store size={15} />
              </span>
              <div className="mt-2 sm:mt-3 font-medium text-[12.5px] sm:text-[13.5px] truncate">
                {s.display_name}
              </div>
              <div className="mt-1 flex items-center justify-center gap-1 text-[11.5px] sm:text-[12px] text-muted">
                {s.rating_avg != null ? (
                  <>
                    <Star size={11} className="text-warn fill-warn" /> {s.rating_avg.toFixed(1)}
                  </>
                ) : (
                  <span className="text-faint">Chưa có đánh giá</span>
                )}
              </div>
              <div className="text-[11.5px] text-faint mt-0.5">
                {s.completed_order_count} đơn hoàn tất
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function RecentOrders({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return null;
  return (
    <section className="border-y border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
        <SectionHead title="Đơn hàng gần đây" sub="Tiếp tục theo dõi đơn của bạn" />
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
          {orders.map((o) => {
            const st = orderStatus(o.status);
            return (
              <Link key={o.id} href="/orders">
                <Card interactive className="p-3 sm:p-4 h-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] sm:text-[11.5px] text-faint">#{o.id}</span>
                    <Tag tone={st.tone}>{st.label}</Tag>
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-[12.5px] sm:text-[13.5px] font-medium truncate">
                    {o.product_title ?? o.variant_name ?? `Đơn #${o.id}`}
                  </div>
                  <div className="mt-1.5 sm:mt-2 font-mono text-[13px] sm:text-[14px] font-semibold tabular">
                    {vnd(o.total_amount)}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
        <div className="mt-5">
          <Link href="/orders" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-iris hover:text-iris-hi transition-colors">
            Xem tất cả đơn hàng <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
