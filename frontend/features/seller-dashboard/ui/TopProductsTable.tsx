"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMoney } from "@/lib/money";
import type { SellerDashboard, SellerDashboardTopProduct } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { ChevronRight, Star, TrendingUp } from "@/components/Icons";

function stockTag(p: SellerDashboardTopProduct, t: ReturnType<typeof useTranslations<"sellerDashboard">>) {
  switch (p.stock_state) {
    case "out":
      return <Tag tone="bad">{t("stockOut")}</Tag>;
    case "low":
      return <Tag tone="warn">{t("stockLow", { count: p.total_stock })}</Tag>;
    case "in_stock":
      return <Tag tone="good">{t("stockIn", { count: p.total_stock })}</Tag>;
    default:
      return <Tag tone="iris">{t("stockNotManaged")}</Tag>;
  }
}

export function TopProductsTable({ data }: { data: SellerDashboard }) {
  const t = useTranslations("sellerDashboard");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const rows = data.top_products;

  return (
    <Card className="p-5 pb-2">
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-faint">
                <th className="py-2 pr-3">{t("colProduct")}</th>
                <th className="px-3 py-2 text-right">{t("colOrders")}</th>
                <th className="px-3 py-2 text-right">{t("colNet")}</th>
                <th className="px-3 py-2">{t("colStock")}</th>
                <th className="py-2 pl-3 text-right">{t("colRating")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-[13px]">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-raised/40">
                  <td className="py-2.5 pr-3">
                    <Link
                      href={`/seller/products/${p.id}`}
                      className="block max-w-[260px] truncate font-medium text-fg hover:text-iris"
                      title={p.title}
                    >
                      {p.title}
                    </Link>
                    <span className="text-[11px] text-faint">
                      {p.service_type ?? "—"}
                      {p.status !== "active" && ` · ${p.status}`}
                    </span>
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
      )}
    </Card>
  );
}
