"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import type { SellerProduct } from "@/lib/types";
import { Button, Card, Spinner, Tag, Tooltip } from "@/components/ui";
import { Edit2, Eye, Package, Plus, Trash } from "@/components/Icons";

export default function SellerProducts() {
  const t = useTranslations("seller");
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.sellerProducts().then(setProducts).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (id: number) => {
    if (!confirm(t("pauseConfirm"))) return;
    await api.deleteProduct(id);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[16px] font-semibold">{t("yourProducts")}</h2>
          <p className="text-[13px] text-muted">{t("productCount", { count: products.length })}</p>
        </div>
        <Link href="/seller/products/new">
          <Button><Plus size={15} /> {t("createNew")}</Button>
        </Link>
      </div>

      {products.length === 0 ? (
        <Card className="p-8 text-center">
          <Package size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] text-muted mb-4">{t("noProductsYet")}</p>
          <Link href="/seller/products/new"><Button><Plus size={15} /> {t("createFirstProduct")}</Button></Link>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Bảng cuộn ngang trong chính nó: các cột đã ẩn bớt ở màn nhỏ nhưng phần
              còn lại vẫn rộng hơn màn điện thoại, và Card overflow-hidden thì cắt
              mất thay vì cho cuộn. */}
          <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[12px] text-faint border-b border-line">
                <th className="font-medium px-5 py-3">{t("product")}</th><th className="font-medium px-3 py-3 hidden sm:table-cell">{t("category")}</th><th className="font-medium px-3 py-3">{t("status")}</th><th className="font-medium px-3 py-3 hidden md:table-cell">{t("variants")}</th><th className="font-medium px-3 py-3 hidden md:table-cell">{t("stock")}</th><th className="font-medium px-5 py-3 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const statusMap = { active: { label: t("activeStatus"), tone: "good" as const }, draft: { label: t("draftStatus"), tone: "neutral" as const }, paused: { label: t("pausedStatus"), tone: "warn" as const }, suspended: { label: t("suspendedStatus"), tone: "bad" as const } };
                const st = statusMap[p.status as keyof typeof statusMap] ?? { label: p.status, tone: "neutral" as const };
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-raised transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-raised border border-line font-serif text-[13px] font-semibold text-iris">
                          {p.title.slice(0, 2).toUpperCase()}
                        </span>
                        <Tooltip text={p.title} position="bottom">
                          <div className="min-w-0 cursor-default">
                            <div className="font-medium text-[13.5px] truncate max-w-[240px]">{p.title}</div>
                            <div className="text-[11px] text-faint">{p.service_type ?? "other"}</div>
                          </div>
                        </Tooltip>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-muted hidden sm:table-cell">{p.category_name ?? "—"}</td>
                    <td className="px-3 py-3"><Tag tone={st.tone}>{st.label}</Tag></td>
                    <td className="px-3 py-3 text-[13px] text-muted hidden md:table-cell">{p.variant_count}</td>
                    <td className="px-3 py-3 text-[13px] text-muted hidden md:table-cell">{p.total_stock}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Link href={`/products/${p.id}`} title={t("viewPurchasePage")}>
                          <Button size="sm" variant="ghost"><Eye size={14} /></Button>
                        </Link>
                        <Link href={`/seller/products/${p.id}`} title={t("edit")}>
                          <Button size="sm" variant="ghost"><Edit2 size={14} /></Button>
                        </Link>
                        {p.status === "active" && (
                          <Button size="sm" variant="ghost" className="text-bad hover:text-bad" onClick={() => remove(p.id)} title={t("pause")}><Trash size={14} /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      )}
    </div>
  );
}
