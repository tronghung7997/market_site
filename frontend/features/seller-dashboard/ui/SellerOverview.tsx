"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { SellerDashboard } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button, Card } from "@/components/ui";
import { AlertCircle, Inbox, Package, Plus } from "@/components/Icons";
import type { DashboardRangeParams } from "../model";
import { DashboardActionStrip } from "./DashboardActionStrip";
import { DashboardRangePicker } from "./DashboardRangePicker";
import { DashboardStatCards } from "./DashboardStatCards";
import { CustomersCard, InventoryCard } from "./InventoryAndCustomers";
import { OrderStatusBreakdown } from "./OrderStatusBreakdown";
import { RevenueChart } from "./RevenueChart";
import { TopProductsTable } from "./TopProductsTable";

export function SellerOverviewSkeleton() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="h-8 w-72 rounded-lg border border-line bg-raised" />
        <div className="h-9 w-64 rounded-lg bg-raised" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-11 rounded-lg border border-line bg-raised" />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-[108px] rounded-xl border border-line bg-raised" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-[290px] rounded-xl border border-line bg-raised lg:col-span-2" />
        <div className="h-[290px] rounded-xl border border-line bg-raised" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="h-[260px] rounded-xl border border-line bg-raised lg:col-span-3" />
        <div className="h-[260px] rounded-xl border border-line bg-raised lg:col-span-2" />
      </div>
    </div>
  );
}

export function SellerOverviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations("sellerDashboard");
  return (
    <Card className="p-10 text-center">
      <AlertCircle size={32} className="mx-auto mb-2 text-bad" />
      <p className="mb-1 text-[13.5px] font-medium text-fg">{t("loadFailed")}</p>
      <p className="mb-4 text-[12.5px] text-muted">{message}</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>{t("retry")}</Button>
    </Card>
  );
}

function QuickActions() {
  const t = useTranslations("seller");
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/seller/products/new">
        <Button size="sm"><Plus size={14} /> {t("newProduct")}</Button>
      </Link>
      <Link href="/seller/orders">
        <Button size="sm" variant="secondary"><Inbox size={14} /> {t("viewOrders")}</Button>
      </Link>
    </div>
  );
}

export function SellerOverview({
  data,
  params,
  refreshing,
  onRangeChange,
}: {
  data: SellerDashboard;
  params: DashboardRangeParams;
  /** A new range is loading while `data` still shows the previous one. */
  refreshing: boolean;
  onRangeChange: (next: DashboardRangeParams) => void;
}) {
  const t = useTranslations("sellerDashboard");
  const brandNew = data.inventory.product_count === 0 && data.orders.total === 0 && data.money.wallet.available === 0;

  return (
    <div className="space-y-5 animate-fade">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <DashboardRangePicker params={params} resolved={data.range} onChange={onRangeChange} />
        <QuickActions />
      </div>

      {brandNew ? (
        <Card className="p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl border border-line bg-raised text-faint">
            <Package size={24} />
          </div>
          <p className="mb-1 text-[14px] font-medium text-fg">{t("emptyTitle")}</p>
          <p className="mx-auto mb-4 max-w-sm text-[12.5px] text-muted">{t("emptyBody")}</p>
          <Link href="/seller/products/new">
            <Button size="md"><Plus size={15} /> {t("emptyCta")}</Button>
          </Link>
        </Card>
      ) : (
        <div className={cn("space-y-5 transition-opacity", refreshing && "opacity-60")} aria-busy={refreshing}>
          <DashboardActionStrip items={data.action_items} />
          <DashboardStatCards data={data} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><RevenueChart data={data} /></div>
            <OrderStatusBreakdown data={data} />
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3"><TopProductsTable data={data} /></div>
            <div className="flex flex-col gap-4 lg:col-span-2">
              <InventoryCard data={data} className="flex-1" />
              <CustomersCard data={data} className="flex-1" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
