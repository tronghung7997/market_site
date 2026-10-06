"use client";

/** "Đơn hàng gần đây" on the home page (signed-in buyers only). The shops
 *  row is the catalog's ShopStrip. */

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { orderStatus } from "@/lib/order-status";
import type { Order } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { ArrowRight, Clock } from "@/components/Icons";
import { SectionHead } from "./SectionHead";

export function RecentOrders({ orders }: { orders: Order[] }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const { formatOrderHistoryMoney } = useMoney();
  if (orders.length === 0) return null;
  return (
    <section className="border-y border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-6 lg:py-8">
        <SectionHead title={t("recentOrdersTitle")} sub={t("recentOrdersSubtitle")} />
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
          {orders.map((o) => {
            const st = orderStatus(o.status);
            const money = formatOrderHistoryMoney(
              o.total_amount,
              o.display_fx_rate_snapshot,
              { locale },
            );
            return (
              <Link key={o.id} href="/orders">
                <Card interactive className="p-3 sm:p-4 h-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] sm:text-[11.5px] text-faint">#{o.order_code}</span>
                    <Tag tone={st.tone}>{st.label}</Tag>
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-[12.5px] sm:text-[13.5px] font-medium truncate">
                    {o.product_title ?? o.variant_name ?? t("orderFallback", { id: o.order_code })}
                  </div>
                  <div className="mt-1.5 sm:mt-2 font-mono text-[13px] sm:text-[14px] font-semibold tabular">
                    {money.text}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
        <div className="mt-5">
          <Link href="/orders" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-iris hover:text-iris-hi transition-colors">
            {t("viewAllOrders")} <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
