"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMoney } from "@/lib/money";
import { sellerProductPath } from "@/lib/routes";
import type { SellerDashboard, SellerDashboardTopProduct } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { ChevronRight, Star, TrendingUp } from "@/components/Icons";
import { serviceLabel } from "@/lib/labels";

function stockTag(p: SellerDashboardTopProduct, t: ReturnType<typeof useTranslations<"sellerDashboard">>) {
  switch (p.stock_state) {
    case "out":
      return <Tag tone="bad">{t("stockOut")}</Tag>;
    case "low":
      return <Tag tone="warn">{t("stockLow", { count: p.total_stock })}</Tag>;
    case "in_stock":
      return <Tag tone="good">{t("stockIn", { count: p.total_stock })}</Tag>;
    case "manual":
      return <Tag tone="warn">{t("stockManual")}</Tag>;
    default:
      return <Tag tone="iris">{t("stockNotManaged")}</Tag>;
  }
}

export function TopProductsTable({ data }: { data: SellerDashboard }) {
  const t = useTranslations("sellerDashboard");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const rows = data.top_products;
  const tp = useTranslations("sellerProducts");
  const meta = (p: SellerDashboardTopProduct) => [
    p.service_type && p.service_type !== "other" ? serviceLabel(p.service_type, locale) : null,
    p.status !== "active" && tp.has(`tab.${p.status}`) ? tp(`tab.${p.status}`) : null,
  ].filter(Boolean).join(" · ");

  return (
    <Card className="h-full p-5 pb-2">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <TrendingUp size={14} className="text-faint" /> {t("topTitle")}
        </h3>
        <Link href="/seller/products" className="inline-flex items-center gap-1 text-[12px] text-iris hover:text-iris-hi">
          {t("allProducts")} <ChevronRight size={12} />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="pb-3 text-[13px] text-muted">{t("topEmpty")}</p>
      ) : (
        <>
          {/* Phones: one stacked record per product instead of a squeezed table. */}
          <ul className="divide-y divide-line sm:hidden">
            {rows.map((p) => (
              <li key={p.id} className="py-3">
                <Link href={sellerProductPath(p)} className="block truncate text-[13px] font-medium text-fg hover:text-iris" title={p.title}>
                  {p.title}
                </Link>
                {meta(p) && <p className="text-[11px] text-faint">{meta(p)}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                  <span>{t("colOrders")}: <b className="font-mono tabular text-fg">{p.orders.toLocaleString(locale)}</b></span>
                  <span>{t("colNet")}: <b className="font-mono tabular text-fg">{formatBrowseMoney(p.net, { locale })}</b></span>
                  {stockTag(p, t)}
                  {p.rating_avg !== null && (
                    <span className="inline-flex items-center gap-1 font-mono tabular"><Star size={12} className="text-warn" /> {p.rating_avg.toFixed(1)} ({p.rating_count})</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[12px] font-medium text-faint">
                  <th className="py-2 pr-3 font-medium">{t("colProduct")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("colOrders")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("colNet")}</th>
                  <th className="px-3 py-2 font-medium">{t("colStock")}</th>
                  <th className="py-2 pl-3 text-right font-medium">{t("colRating")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-[13px]">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-raised/40">
                    <td className="py-2.5 pr-3">
                      <Link
                        href={sellerProductPath(p)}
                        className="block max-w-[260px] truncate font-medium text-fg hover:text-iris"
                        title={p.title}
                      >
                        {p.title}
                      </Link>
                      {meta(p) && <span className="text-[11px] text-faint">{meta(p)}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular whitespace-nowrap">
                      {p.orders.toLocaleString(locale)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular whitespace-nowrap" title={t("grossHint", { amount: formatBrowseMoney(p.gross, { locale }) })}>
                      {formatBrowseMoney(p.net, { locale })}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{stockTag(p, t)}</td>
                    <td className="py-2.5 pl-3 text-right font-mono tabular whitespace-nowrap">
                      {p.rating_avg === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Star size={12} className="text-warn" /> {p.rating_avg.toFixed(1)}
                          <span className="text-[11px] text-faint">({p.rating_count})</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
