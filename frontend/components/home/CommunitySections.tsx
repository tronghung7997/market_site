"use client";

/** Hai section "cộng đồng" của trang chủ: người bán uy tín (public) và đơn
 *  hàng gần đây (chỉ buyer đã đăng nhập). */

import { Link } from "@/i18n/navigation";
import { sellerPath } from "@/lib/routes";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { orderStatus } from "@/lib/order-status";
import type { Order, TopSeller } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { ArrowRight, Clock, Star, Store } from "@/components/Icons";
import { SectionHead } from "./SectionHead";
import { MediaImage } from "@/components/media/MediaImage";

const TIER_KEYS = ["new", "verified", "trusted", "enterprise"] as const;

export function TrustedSellers({ sellers }: { sellers: TopSeller[] }) {
  const t = useTranslations("home");
  const ts = useTranslations("sellers");
  if (sellers.length === 0) return null;
  const tierLabel = (tier: string) => ts(`tier_${(TIER_KEYS as readonly string[]).includes(tier) ? tier : "new"}` as "tier_new");
  return (
    <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
      <SectionHead title={t("trustedSellersTitle")} sub={t("trustedSellersSubtitle")} />
      <ol className="grid gap-2.5 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {sellers.map((s, index) => (
          <li key={s.public_key}>
            <Link href={sellerPath(s)} className="block h-full">
              <Card interactive className="relative p-3 sm:p-4 h-full text-center">
                <span className="absolute left-2.5 top-2 font-mono text-[11px] font-semibold text-faint" aria-hidden>
                  #{String(index + 1).padStart(2, "0")}
                </span>
                {s.logo ? (
                  <MediaImage image={s.logo} alt="" className="mx-auto h-9 w-9 sm:h-11 sm:w-11 rounded-full border border-line" />
                ) : (
                  <span className="mx-auto grid place-items-center h-9 w-9 sm:h-11 sm:w-11 rounded-full bg-iris-soft text-iris border border-iris/15">
                    <Store size={15} />
                  </span>
                )}
                <div className="mt-2 sm:mt-3 flex items-center justify-center gap-1 font-medium text-[12.5px] sm:text-[13.5px]">
                  <span className="truncate">{s.display_name}</span>
                  {s.tier_badge && <MediaImage image={s.tier_badge} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />}
                </div>
                <div className="mt-0.5 text-[11px] text-iris-hi">{tierLabel(s.seller_tier)}</div>
                <div className="mt-1 flex items-center justify-center gap-1 text-[11.5px] sm:text-[12px] text-muted">
                  {s.rating_avg != null ? (
                    <>
                      <Star size={11} className="text-warn fill-warn" /> {s.rating_avg.toFixed(1)}
                      <span className="text-faint">· {t("completedOrders", { count: s.completed_order_count })}</span>
                    </>
                  ) : (
                    <span className="text-faint">{t("completedOrders", { count: s.completed_order_count })}</span>
                  )}
                </div>
                {s.response_time && (
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-faint">
                    <Clock size={10} /> {t(`replyBand.${s.response_time.within}`)}
                  </div>
                )}
                {s.main_category && (
                  <div className="mt-1.5 truncate text-[11px] text-muted">{s.main_category.name}</div>
                )}
              </Card>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RecentOrders({ orders }: { orders: Order[] }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const { formatOrderHistoryMoney } = useMoney();
  if (orders.length === 0) return null;
  return (
    <section className="border-y border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
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
