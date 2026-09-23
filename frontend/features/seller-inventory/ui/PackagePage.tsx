"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { daysAgo } from "@/lib/utils";
import type { RestockResult } from "@/lib/types";
import { productPath, sellerInventoryProductQuery, sellerProductPath } from "@/lib/routes";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Button, Card, Tag } from "@/components/ui";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Download, Edit2, ExternalLink, Plus, X } from "@/components/Icons";
import type { ResourceFilters } from "../model";
import { useBulkPackageStatus, useInventoryPackage } from "../useInventory";
import { Switch } from "./InventoryConsole";
import { PackageSwitcher, rememberRecentPackage } from "./PackageSwitcher";
import { RestockPanel } from "./RestockPanel";
import { ResourceTable } from "./ResourceTable";

export function PackagePageSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true">
      <div className="h-3.5 w-64 rounded bg-raised" />
      <div className="h-[120px] rounded-xl border border-line bg-raised" />
      <div className="h-96 rounded-xl border border-line bg-raised" />
    </div>
  );
}

export function PackagePage({
  variantRef,
  filters,
  onFiltersChange,
}: {
  /** Route segment: the package's public key (legacy numeric ids still resolve). */
  variantRef: string;
  filters: ResourceFilters;
  onFiltersChange: (next: ResourceFilters) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const query = useInventoryPackage(variantRef);
  const status = useBulkPackageStatus();
  const [notice, setNotice] = useState<{ tone: "good" | "bad" | "warn"; text: string } | null>(null);

  useEffect(() => { if (query.data) rememberRecentPackage(query.data.variant_id); }, [query.data]);
  useEffect(() => {
    if (!notice) return;
    const handle = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(handle);
  }, [notice]);

  if (query.isPending) return <PackagePageSkeleton />;
  if (query.isError) {
    return (
      <Card className="p-10 text-center">
        <AlertCircle size={32} className="mx-auto mb-2 text-bad" />
        <p className="mb-1 text-[13.5px] font-medium text-fg">{t("package.loadFailed")}</p>
        <p className="mb-3 text-[12.5px] text-muted">{apiErrorMessage(query.error)}</p>
        <div className="flex justify-center gap-2">
          <Link href="/seller/inventory"><Button size="sm" variant="secondary">{t("package.backToInventory")}</Button></Link>
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("retry")}</Button>
        </div>
      </Card>
    );
  }

  const pkg = query.data;
  const metrics: { key: string; value: string; tone?: string }[] = [
    { key: "available", value: pkg.available.toLocaleString(locale), tone: pkg.stock_state === "out" ? "text-bad" : pkg.stock_state === "low" ? "text-warn" : "text-good" },
    { key: "assigned", value: pkg.assigned.toLocaleString(locale) },
    { key: "error", value: pkg.error.toLocaleString(locale), tone: pkg.error > 0 ? "text-warn" : undefined },
    { key: "expired", value: pkg.expired.toLocaleString(locale) },
    { key: "archived", value: pkg.archived.toLocaleString(locale) },
    { key: "lastRestock", value: pkg.last_restock_at ? daysAgo(pkg.last_restock_at, locale) : "—" },
  ];

  const toggleActive = async (isActive: boolean) => {
    try {
      await status.mutateAsync({ ids: [pkg.variant_id], isActive });
      setNotice({ tone: "good", text: t(isActive ? "package.activated" : "package.deactivated") });
    } catch (err) {
      setNotice({ tone: "bad", text: apiErrorMessage(err, t("notice.bulkFailed")) });
    }
  };

  const onRestocked = (result: RestockResult) => {
    const market = result.skipped_market ?? 0;
    const skipped = result.skipped_duplicate + result.skipped_existing;
    setNotice({
      tone: market > 0 ? "bad" : skipped > 0 ? "warn" : "good",
      text: t("restock.done", { count: result.count.toLocaleString(locale) })
        + (skipped > 0 ? ` · ${t("restock.doneSkipped", { duplicate: result.skipped_duplicate, existing: result.skipped_existing })}` : "")
        + (market > 0 ? ` · ${t("restock.doneMarket", { count: market })}` : ""),
    });
    onFiltersChange({ ...filters, restock: false, page: 1 });
  };

  return (
    <div className="space-y-4 animate-fade">
      <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        <Link href="/seller/inventory" className="text-iris hover:underline">{t("title")}</Link>
        <ChevronRight size={12} className="text-faint" />
        <Link href={sellerInventoryProductQuery({ id: pkg.product_id, public_key: pkg.product_key })} className="min-w-0 truncate text-iris hover:underline">{pkg.product_title}</Link>
        <ChevronRight size={12} className="text-faint" />
        <span className="min-w-0 truncate text-fg">{pkg.variant_name}</span>
      </nav>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <ProductCover coverId={parseCoverId({ cover_id: pkg.cover_id })} title={pkg.product_title} className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
              <Link href={sellerProductPath({ id: pkg.product_id, public_key: pkg.product_key })} className="hover:text-iris">{pkg.product_title}</Link>
              <span>·</span>
              <span>{pkg.category_name}</span>
              {pkg.product_status !== "active" && <Tag tone="neutral">{t("state.productPaused")}</Tag>}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PackageSwitcher pkg={pkg} />
              <Tag tone="iris">{t("table.autoDelivery")}</Tag>
              {pkg.stock_state === "out" && <Tag tone="bad">{t("state.out")}</Tag>}
              {pkg.stock_state === "low" && <Tag tone="warn">{t("state.low")}</Tag>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Switch checked={pkg.is_active} onChange={(next) => void toggleActive(next)} label={pkg.is_active ? t("package.selling") : t("package.notSelling")} />
            <Link href={sellerProductPath({ id: pkg.product_id, public_key: pkg.product_key })}><Button size="sm" variant="ghost" className="h-8 gap-1 text-xs"><Edit2 size={13} /> {t("package.editProduct")}</Button></Link>
            <Link href={productPath({ id: pkg.product_id, public_key: pkg.product_key })} target="_blank"><Button size="sm" variant="ghost" className="h-8 gap-1 text-xs"><ExternalLink size={13} /> {t("package.viewStore")}</Button></Link>
            <Link href={`/seller/inventory/export?tab=goods&variants=${pkg.variant_key ?? pkg.variant_id}`}><Button size="sm" variant="secondary" className="h-8 gap-1 text-xs"><Download size={13} /> {t("package.export")}</Button></Link>
            <Button size="sm" variant={filters.restock ? "secondary" : "primary"} onClick={() => onFiltersChange({ ...filters, restock: !filters.restock })} className="h-8 gap-1 text-xs">
              {filters.restock ? <><X size={13} /> {t("package.closeRestock")}</> : <><Plus size={13} /> {t("package.restock")}</>}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-line sm:grid-cols-6">
          {metrics.map((m) => (
            <div key={m.key} className="px-4 py-2.5">
              <div className="text-[11px] text-faint">{t(`package.metric.${m.key}`)}</div>
              <div className={cn("font-mono text-[15px] font-semibold tabular text-fg", m.tone)}>{m.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {notice && (
        <div role="alert" className={cn(
          "flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs font-medium",
          notice.tone === "good" && "border-good/20 bg-good-soft text-good",
          notice.tone === "warn" && "border-warn/20 bg-warn-soft text-warn",
          notice.tone === "bad" && "border-bad/20 bg-bad-soft text-bad",
        )}>
          <span className="flex items-start gap-1.5">
            {notice.tone === "good" ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
            {notice.text}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)} className="h-6 px-1.5"><X size={12} /></Button>
        </div>
      )}

      {filters.restock && (
        <RestockPanel pkg={pkg} onClose={() => onFiltersChange({ ...filters, restock: false })} onDone={onRestocked} />
      )}

      <ResourceTable pkg={pkg} filters={filters} onFiltersChange={onFiltersChange} onNotice={(tone, text) => setNotice({ tone, text })} />
    </div>
  );
}
