"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SourceArea, SourceStockOverview, SourceStockRow } from "@/lib/types";
import { Button, Input, Skeleton, Tooltip } from "@/components/ui";
import { AlertTriangle, Info } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { MANUAL_STOCK_MAX, parseStockInput } from "../logic";

/** Bảng "Tồn kho token" gọn đầu trang nguồn `manual_stock` (admin + seller
 *  chủ nguồn): mỗi SKU một dòng. Nguồn không báo tồn — số này do người bán
 *  đặt, mỗi đơn trừ số token đã giao, về 0 → Hết hàng. Lưu qua PATCH listing. */
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
    <section aria-labelledby="token-stock-title" aria-describedby="token-stock-help" className="rounded-card border border-line bg-card">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2">
        <h2 id="token-stock-title" className="text-[13.5px] font-semibold text-fg">{t("title")}</h2>
        <Tooltip text={t("help")}>
          <button type="button" aria-label={t("helpLabel")} className="rounded text-faint hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40">
            <Info size={14} />
          </button>
        </Tooltip>
        <span id="token-stock-help" className="sr-only">{t("help")}</span>
      </div>

      {error && !data ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px] text-bad">
          <AlertTriangle size={14} />{t("loadError")}: {error}
          <Button size="sm" variant="secondary" onClick={load}>{t("retry")}</Button>
        </p>
      ) : !data ? (
        <div className="px-4 py-2.5"><Skeleton className="h-9 w-full" /></div>
      ) : data.listings.length === 0 ? (
        <p className="px-4 py-2.5 text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.listings.map((row) => (
            <StockRow
              key={row.listing_id} area={area} row={row} maxPerOrder={data.max_per_order} goSettings={goSettings}
              onSaved={async () => { await load(); await onChanged(); }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function StockRow({ area, row, maxPerOrder, goSettings, onSaved }: {
  area: SourceArea; row: SourceStockRow; maxPerOrder: number | null; goSettings: () => void; onSaved: () => Promise<void>;
}) {
  const t = useTranslations("sellerSources.stockCard");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [draft, setDraft] = useState(String(row.stock));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(String(row.stock)); }, [row.stock]);

  const parsed = parseStockInput(draft);
  const changed = parsed !== null && parsed !== row.stock;
  const fmt = (n: number) => n.toLocaleString(locale);
  const name = `${row.product_title} · ${row.variant_name}`;
  const inputId = `stock-set-${row.listing_id}`;

  const save = async () => {
    if (!changed || parsed === null) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api.sources.updateListing(area, row.listing_id, { stock: parsed });
      setSaved(true);
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const last = row.last_set;
  const who = last ? (last.by_me ? t("byYou") : last.actor_email ?? (last.by_admin ? t("byAdmin") : t("bySeller"))) : "";
  const when = last ? shortStamp(new Date(last.at)) : "";

  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:grid md:grid-cols-[minmax(0,1fr)_auto_11rem_10rem]">
        <div className="flex min-w-0 flex-1 basis-full items-baseline justify-between gap-3 sm:basis-auto sm:justify-start">
          <span className="min-w-0 truncate text-[13px] font-medium text-fg" title={name}>{name}</span>
          <span className="shrink-0 text-[12.5px] text-muted">
            {t("sellable")}{" "}
            <strong className={cn("font-mono text-[15px] tabular-nums", row.stock === 0 ? "text-bad" : "text-fg")}>{fmt(row.stock)}</strong>
          </span>
        </div>

        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Input
            id={inputId} inputMode="numeric" autoComplete="off"
            aria-label={t("setFor", { name })} aria-invalid={parsed === null}
            aria-describedby={parsed === null ? `${inputId}-err` : undefined}
            className="h-9 w-28 font-mono" value={draft}
            onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
          />
          <Button type="submit" size="sm" className="h-9" disabled={!changed} loading={saving}>{t("save")}</Button>
        </form>

        <span className="text-[12px] text-muted">
          {t("sold", { d: fmt(row.sold_24h), w: fmt(row.sold_7d) })}
        </span>
        <span className="text-[12px] text-muted">
          {maxPerOrder == null ? t("maxNone") : t("max", { n: fmt(maxPerOrder) })}{" "}
          <button type="button" onClick={goSettings} className="font-medium text-iris-hi hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40">
            {t("settings")}
          </button>
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
        {parsed === null && <span id={`${inputId}-err`} className="text-bad">{t("invalid", { max: fmt(MANUAL_STOCK_MAX) })}</span>}
        {error && <span role="alert" className="text-bad">{error}</span>}
        {saved && !error && <span role="status" className="text-good">{t("saved")}</span>}
        {row.stock === 0 && <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle size={12} />{t("soldOut")}</span>}
        {!row.variant_active && <span className="text-muted">{t("variantOff")}</span>}
        {row.sellable > 0 && row.sellable < row.stock && <span className="text-muted">{t("capped", { n: fmt(row.sellable) })}</span>}
        {last && (
          <span className="text-faint">
            {t("lastSet", { when, who, old: last.old == null ? "—" : fmt(last.old), new: last.new == null ? "—" : fmt(last.new) })}
          </span>
        )}
      </div>
    </li>
  );
}

/** "14:02 05/10" — giờ:phút ngày/tháng theo giờ máy người xem. */
function shortStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}
