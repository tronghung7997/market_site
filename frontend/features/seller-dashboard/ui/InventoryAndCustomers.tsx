"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { SellerDashboard } from "@/lib/types";
import { Card } from "@/components/ui";
import { ChevronRight, Rows, Star, Users } from "@/components/Icons";

function Figure({ value, label, tone }: { value: string; label: string; tone?: "warn" | "bad" }) {
  return (
    <div className="min-w-0">
      <div className={cn("font-mono text-[20px] font-semibold leading-none tabular", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>
        {value}
      </div>
      <div className="mt-1 text-[11.5px] text-faint">{label}</div>
    </div>
  );
}

export function InventoryCard({ data }: { data: SellerDashboard }) {
  const t = useTranslations("sellerDashboard");
  const locale = useLocale();
  const inv = data.inventory;
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <Rows size={14} className="text-faint" /> {t("inventoryTitle")}
        </h3>
        <Link href="/seller/inventory" className="inline-flex items-center gap-1 text-[12px] text-iris hover:text-iris-hi">
          {t("inventoryLink")} <ChevronRight size={12} />
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Figure value={inv.total_stock.toLocaleString(locale)} label={t("stockAvailable")} />
        <Figure value={String(inv.low_stock)} label={t("lowStockProducts")} tone={inv.low_stock > 0 ? "warn" : undefined} />
        <Figure value={String(inv.out_of_stock)} label={t("outOfStockProducts")} tone={inv.out_of_stock > 0 ? "bad" : undefined} />
      </div>
      <p className="mt-3 border-t border-line pt-3 text-[12px] text-muted">
        {t("productsActive", { active: inv.active_count, total: inv.product_count, managed: inv.managed_products })}
      </p>
    </Card>
  );
}

export function CustomersCard({ data }: { data: SellerDashboard }) {
  const t = useTranslations("sellerDashboard");
  const locale = useLocale();
  const { customers: c, reviews: r } = data;
  const returningPct = c.unique_buyers > 0 ? Math.round((c.returning_buyers / c.unique_buyers) * 100) : null;
  return (
    <Card className="p-5">
      <h3 className="mb-4 flex items-center gap-2 text-[13px] font-semibold">
        <Users size={14} className="text-faint" /> {t("customersTitle")}
      </h3>
      <div className="grid grid-cols-3 gap-3">
        <Figure value={c.unique_buyers.toLocaleString(locale)} label={t("buyers")} />
        <Figure value={returningPct === null ? "—" : `${returningPct}%`} label={t("returning", { count: c.returning_buyers })} />
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-mono text-[20px] font-semibold leading-none tabular">
            {r.rating_avg === null ? "—" : (
              <>
                <Star size={14} className="text-warn" /> {r.rating_avg.toFixed(1)}
              </>
            )}
          </div>
          <div className="mt-1 text-[11.5px] text-faint">
            {r.rating_count > 0 ? t("rating", { count: r.rating_count }) : t("noRating")}
          </div>
        </div>
      </div>
      <p className="mt-3 border-t border-line pt-3 text-[12px] text-muted">
        {t("customersFoot", { newCount: c.new_buyers, reviews: r.count_in_range })}
      </p>
    </Card>
  );
}
