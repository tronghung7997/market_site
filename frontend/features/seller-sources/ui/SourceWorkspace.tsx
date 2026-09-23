"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceArea, SourceListing, SupplierSource } from "@/lib/types";
import { Banner, Button, Spinner, Tag } from "@/components/ui";
import { AlertTriangle, CheckCircle2, ChevronLeft, Pause, RefreshCw } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { balanceDays, countListings, lowBalance } from "../logic";
import { CatalogTab } from "./CatalogTab";
import { PurchasesTab } from "./PurchasesTab";
import { SellingTab } from "./SellingTab";
import { SettingsTab } from "./SettingsTab";
import { relTime, SummaryStrip } from "./shared";

export type WorkspaceTab = "selling" | "catalog" | "orders" | "settings";
const TABS: WorkspaceTab[] = ["selling", "catalog", "orders", "settings"];

function parseTab(raw: string | null): WorkspaceTab {
  return TABS.includes(raw as WorkspaceTab) ? (raw as WorkspaceTab) : "selling";
}

/** Một nguồn = một trang, 4 tab: Đang bán · Kho · Đơn mua · Cài đặt. Tab nằm
 *  trên URL (?tab=) để link từ danh sách / thông báo mở đúng chỗ. */
export function SourceWorkspace({ area, sourceId }: { area: SourceArea; sourceId: number }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const base = area === "admin" ? "/admin/sources" : "/seller/sources";

  const tab = parseTab(params.get("tab"));
  const [source, setSource] = useState<SupplierSource | null>(null);
  const [missing, setMissing] = useState(false);
  const [rows, setRows] = useState<SourceListing[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(params.get("created") ? t("workspace.created") : "");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [all, listings] = await Promise.all([api.sources.list(area), api.sources.listings(area, sourceId)]);
      const s = all.find((x) => x.id === sourceId) ?? null;
      setSource(s);
      setMissing(s === null);
      setRows(listings);
      setError("");
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [area, sourceId, apiErrorMessage]);
  useEffect(() => { void load(); }, [load]);

  const goTab = (next: WorkspaceTab, extra?: Record<string, string>) => {
    const qs = new URLSearchParams({ tab: next, ...extra });
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
  };

  const sync = async () => {
    setSyncing(true);
    setNotice("");
    try {
      const r = await api.sources.sync(area, sourceId);
      if (r.error) setError(`${t("workspace.syncFailed")}: ${r.error}`);
      else setNotice(t("workspace.syncDone", { items: r.catalog_items, updated: r.updated, repriced: r.repriced, delisted: r.delisted }));
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  if (missing) {
    return (
      <div className="space-y-4">
        <Link href={base} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ChevronLeft size={14} />{t("title")}</Link>
        <Banner tone="warn" icon={<AlertTriangle size={15} />} title={t("workspace.notFound")}>{t("workspace.notFoundHint")}</Banner>
      </div>
    );
  }

  const counts = rows ? countListings(rows) : null;
  const products = rows ? new Set(rows.filter((r) => r.variant_active).map((r) => r.product_id)).size : 0;
  const days = source ? balanceDays(source.balance_vnd, source.stats_7d?.cost ?? 0) : null;
  const low = source ? lowBalance(source) : false;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={base} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ChevronLeft size={14} />{t("title")}</Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h1 className="min-w-0 truncate font-serif text-2xl font-semibold text-fg">{source?.name ?? "…"}</h1>
            {source && <Tag tone="iris">{t("kind.catalog")} · {source.adapter_type}</Tag>}
          </div>
          {source && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              {!source.is_active
                ? <Tag tone="neutral"><Pause size={12} />{t("status.paused")}</Tag>
                : <Tag tone="good"><CheckCircle2 size={12} />{t("status.running")}</Tag>}
              {t("workspace.syncMeta", { when: relTime(source.catalog_synced_at, t) })}
              {area === "admin" && source.seller_email && <span>· {t("list.soldAs", { store: source.seller_business_name ?? source.seller_email })}</span>}
            </p>
          )}
        </div>
        <Button variant="secondary" onClick={sync} disabled={syncing || !source}>
          <RefreshCw size={15} className={cn(syncing && "animate-spin")} />{syncing ? t("workspace.syncing") : t("workspace.sync")}
        </Button>
      </div>

      {source && !source.is_active && (
        <Banner tone="warn" icon={<Pause size={15} />} title={t("workspace.pausedTitle")}
          action={<Button size="sm" variant="secondary" onClick={() => goTab("settings")}>{t("workspace.pausedAction")}</Button>}>
          {t("workspace.pausedBody")}
        </Banner>
      )}
      {source?.sync_error && (
        <Banner tone="warn" icon={<AlertTriangle size={15} />} title={t("workspace.syncErrorTitle")}
          action={<Button size="sm" variant="secondary" onClick={sync} disabled={syncing}>{t("workspace.sync")}</Button>}>
          {t("workspace.syncErrorBody", { error: source.sync_error })}
        </Banner>
      )}
      {notice && <p role="status" className="text-[13px] text-good">{notice}</p>}
      {error && (
        <Banner tone="bad" icon={<AlertTriangle size={15} />} action={<Button size="sm" variant="secondary" onClick={load}>{t("retry")}</Button>}>
          {error}
        </Banner>
      )}

      {source && counts ? (
        <SummaryStrip
          label={t("workspace.summaryLabel")}
          cells={[
            {
              key: "balance", label: t("workspace.balance"), tone: low ? "warn" : undefined,
              value: source.balance_vnd === null ? "—" : formatLedgerMoney(source.balance_vnd, locale),
              sub: days === null ? t("list.balanceUnknownPace") : t("list.balanceDays", { n: days }),
            },
            { key: "selling", label: t("workspace.selling"), value: counts.selling, sub: t("workspace.inProducts", { n: products }) },
            {
              key: "blocked", label: t("workspace.blocked"), value: counts.blocked, tone: counts.blocked > 0 ? "warn" : undefined,
              sub: counts.blocked > 0 ? t("workspace.blockedSub") : t("workspace.blockedNone"),
            },
            {
              key: "profit", label: t("workspace.profit7d"), value: formatLedgerMoney(source.stats_7d?.profit ?? 0, locale),
              sub: t("list.units7d", { n: source.stats_7d?.units ?? 0 }),
            },
          ]}
        />
      ) : !error ? <Spinner /> : null}

      <div role="tablist" aria-label={t("workspace.tabsLabel")} className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((key) => (
          <button
            key={key} type="button" role="tab" id={`src-tab-${key}`} aria-selected={tab === key} aria-controls={`src-panel-${key}`}
            onClick={() => goTab(key)}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors",
              tab === key ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t(`tabs.${key}`, { source: source?.name ?? "" })}
            {key === "selling" && counts && <span className="ml-1.5 rounded-full bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">{counts.all}</span>}
            {key === "selling" && counts && counts.blocked > 0 && <span className="ml-1 rounded-full bg-warn-soft px-1.5 py-0.5 font-mono text-[11px] text-warn">{counts.blocked}</span>}
            {key === "catalog" && source && <span className="ml-1.5 rounded-full bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">{source.catalog_count.toLocaleString(locale)}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`src-panel-${tab}`} aria-labelledby={`src-tab-${tab}`}>
        {source && rows && tab === "selling" && (
          <SellingTab area={area} source={source} rows={rows} reload={load} setRows={setRows} goTab={goTab} />
        )}
        {source && rows && tab === "catalog" && (
          <CatalogTab area={area} source={source} listings={rows} onImported={async (n) => { setNotice(t("catalog.done", { n })); await load(); }} />
        )}
        {source && tab === "orders" && <PurchasesTab area={area} sourceId={source.id} initialResult={params.get("result")} />}
        {source && tab === "settings" && <SettingsTab area={area} sourceId={source.id} onSaved={load} />}
      </div>
    </div>
  );
}
