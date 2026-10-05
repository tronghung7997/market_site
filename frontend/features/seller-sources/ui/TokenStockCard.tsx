"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SourceArea, SourceStockOverview, SourceStockRow } from "@/lib/types";
import { Banner, Button, Input, Skeleton, Tag } from "@/components/ui";
import { AlertTriangle, Clock, Package } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { MANUAL_STOCK_MAX, parseStockInput, quickStock } from "../logic";
import { relTime } from "./shared";

const STEPS = [100, 500, 1000] as const;

/** Thẻ "Tồn kho token" đầu trang nguồn `manual_stock` (admin + seller chủ
 *  nguồn). Nguồn không báo tồn: số này do người bán đặt, mỗi đơn trừ số
 *  token giao được, về 0 → Hết hàng. Lưu qua PATCH listing (`stock`). */
export function TokenStockCard({ area, sourceRef, onChanged, goSettings }: {
  area: SourceArea; sourceRef: string;
  onChanged: () => Promise<void> | void;
  goSettings: () => void;
}) {
  const t = useTranslations("sellerSources.stockCard");
  const apiErrorMessage = useApiErrorMessage();
  const [data, setData] = useState<SourceStockOverview | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.sources.stock(area, sourceRef));
      setError("");
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [area, sourceRef, apiErrorMessage]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section aria-labelledby="token-stock-title" className="rounded-card border border-line bg-card">
      <header className="border-b border-line px-4 py-3 sm:px-5">
        <h2 id="token-stock-title" className="flex items-center gap-2 text-[15px] font-semibold text-fg">
          <Package size={16} className="text-iris" />{t("title")}
        </h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">{t("lead")}</p>
      </header>

      {error && !data ? (
        <div className="p-4">
          <Banner tone="bad" icon={<AlertTriangle size={15} />} action={<Button size="sm" variant="secondary" onClick={load}>{t("retry")}</Button>}>
            {t("loadError")}: {error}
          </Banner>
        </div>
      ) : !data ? (
        <div className="space-y-3 p-4 sm:p-5"><Skeleton className="h-8 w-48" /><Skeleton className="h-10 w-full" /></div>
      ) : data.listings.length === 0 ? (
        <p className="p-4 text-[13px] text-muted sm:p-5">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.listings.map((row) => (
            <StockRow
              key={row.listing_id} area={area} row={row} showName={data.listings.length > 1}
              onSaved={async () => { await load(); await onChanged(); }}
            />
          ))}
        </ul>
      )}

      {data && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 text-[12.5px] text-muted sm:px-5">
          <span>
            {data.max_per_order == null
              ? t("maxPerOrderNone")
              : t.rich("maxPerOrder", { n: data.max_per_order, b: (c) => <strong className="font-mono text-fg">{c}</strong> })}
          </span>
          <button type="button" onClick={goSettings} className="font-medium text-iris-hi hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40">
            {t("changeInSettings")}
          </button>
        </footer>
      )}
    </section>
  );
}

function StockRow({ area, row, showName, onSaved }: {
  area: SourceArea; row: SourceStockRow; showName: boolean; onSaved: () => Promise<void>;
}) {
  const t = useTranslations("sellerSources.stockCard");
  const tTime = useTranslations("sellerSources");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [draft, setDraft] = useState(String(row.stock));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setDraft(String(row.stock)); }, [row.stock]);

  const parsed = parseStockInput(draft);
  const changed = parsed !== null && parsed !== row.stock;
  const fmt = (n: number) => n.toLocaleString(locale);
  const inputId = `stock-set-${row.listing_id}`;

  const save = async (value: number) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.sources.updateListing(area, row.listing_id, { stock: value });
      setNotice(t("saved", { n: fmt(value) }));
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const who = row.last_set
    ? row.last_set.by_me ? t("byYou")
      : row.last_set.actor_email ?? (row.last_set.by_admin ? t("byAdmin") : t("bySeller"))
    : "";

  return (
    <li className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
      <div className="min-w-0">
        {showName && <p className="mb-1 truncate text-[13px] font-medium text-fg">{row.product_title} · {row.variant_name}</p>}
        <p className="text-[12.5px] text-muted">{t("sellableLabel")}</p>
        <p className={cn("font-mono text-[28px] font-semibold leading-tight tabular-nums", row.stock === 0 ? "text-bad" : "text-fg")}>
          {t("units", { n: fmt(row.stock) })}
        </p>
        {row.sellable > 0 && row.sellable < row.stock && (
          <p className="mt-0.5 text-[12px] text-muted">{t("cappedNote", { n: fmt(row.sellable) })}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {row.stock === 0 && <Tag tone="bad"><AlertTriangle size={12} />{t("soldOut")}</Tag>}
          {!row.variant_active && <Tag tone="neutral">{t("variantOff")}</Tag>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:max-w-sm">
          <dt className="text-muted">{t("sold24h")}</dt><dd className="text-right font-mono tabular-nums text-fg">{fmt(row.sold_24h)}</dd>
          <dt className="text-muted">{t("sold7d")}</dt><dd className="text-right font-mono tabular-nums text-fg">{fmt(row.sold_7d)}</dd>
        </dl>
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-muted">
          <Clock size={13} className="mt-0.5 shrink-0" />
          {row.last_set
            ? t("lastSet", {
              when: relTime(row.last_set.at, tTime), who,
              old: row.last_set.old == null ? "—" : fmt(row.last_set.old),
              new: row.last_set.new == null ? "—" : fmt(row.last_set.new),
            })
            : t("neverSet")}
        </p>
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => { e.preventDefault(); if (changed && parsed !== null) void save(parsed); }}
      >
        <label htmlFor={inputId} className="block text-[13px] font-medium text-fg">{t("setLabel")}</label>
        <div className="flex gap-2">
          <Input
            id={inputId} inputMode="numeric" autoComplete="off"
            className="h-11 min-w-0 flex-1 font-mono sm:h-10" value={draft}
            aria-invalid={parsed === null} aria-describedby={`${inputId}-help`}
            onChange={(e) => { setDraft(e.target.value); setNotice(""); }}
          />
          <Button type="submit" className="h-11 sm:h-10" disabled={!changed} loading={saving}>{t("save")}</Button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("quickLabel")}>
          {STEPS.map((step) => (
            <Button
              key={step} type="button" size="sm" variant="secondary" disabled={saving}
              onClick={() => setDraft(String(quickStock(parsed ?? row.stock, step)))}
            >
              +{fmt(step)}
            </Button>
          ))}
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(String(quickStock(row.stock, "zero")))}>
            {t("setZero")}
          </Button>
        </div>
        <p id={`${inputId}-help`} className={cn("text-[12px]", parsed === null ? "text-bad" : "text-muted")}>
          {parsed === null
            ? t("invalid", { max: fmt(MANUAL_STOCK_MAX) })
            : changed
              ? t("preview", { from: fmt(row.stock), to: fmt(parsed) })
              : t("help")}
        </p>
        {notice && <p role="status" className="text-[12.5px] text-good">{notice}</p>}
        {error && <p role="alert" className="text-[12.5px] text-bad">{error}</p>}
      </form>
    </li>
  );
}
