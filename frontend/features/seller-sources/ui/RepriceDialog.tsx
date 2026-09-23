"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceRepriceResult } from "@/lib/types";
import { Button, Tag } from "@/components/ui";
import { ArrowRight, Check } from "@/components/Icons";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

/** Xem trước đổi giá hàng loạt — không bao giờ đổi giá chỉ với một click. */
export function RepriceDialog({ preview, title, busy, onCancel, onConfirm, confirmLabel }: {
  preview: SourceRepriceResult; title: string; busy: boolean;
  onCancel: () => void; onConfirm: () => void; confirmLabel?: string;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const money = (n: number) => formatLedgerMoney(n, locale);
  const up = preview.changed.filter((c) => c.new_price > c.old_price).length;
  const down = preview.changed.length - up;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="max-w-2xl border-line bg-panel p-0 text-fg">
        <div className="space-y-2 px-5 pb-2 pt-5">
          <DialogHeader><DialogTitle className="text-[16px] font-semibold">{title}</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted">{t("reprice.intro")}</p>
          <div className="flex flex-wrap gap-1.5">
            <Tag tone={up > 0 ? "good" : "neutral"}>{t("reprice.up", { n: up })}</Tag>
            <Tag tone={down > 0 ? "warn" : "neutral"}>{t("reprice.down", { n: down })}</Tag>
            <Tag tone="neutral">{t("reprice.same", { n: preview.unchanged })}</Tag>
            {preview.skipped_manual.length > 0 && <Tag tone="neutral">{t("reprice.manual", { n: preview.skipped_manual.length })}</Tag>}
          </div>
        </div>
        <div className="max-h-[50dvh] overflow-y-auto px-5">
          {preview.changed.length === 0 && <p className="py-4 text-[13px] text-muted">{t("reprice.nothing")}</p>}
          <ul className="divide-y divide-line">
            {preview.changed.map((c) => (
              <li key={c.listing_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_110px_190px]">
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium text-fg">{c.product_title}</span>
                  <span className="block truncate text-[12.5px] text-muted">{c.variant_name}</span>
                </span>
                <span className="hidden text-right font-mono text-[12px] text-muted sm:block">{t("reprice.cost", { cost: money(c.cost_price) })}</span>
                <span className="flex items-center justify-end gap-1.5 font-mono tabular-nums">
                  <span className="text-[12.5px] text-muted line-through">{money(c.old_price)}</span>
                  <ArrowRight size={13} className="text-faint" />
                  <span className={cn("text-[14px] font-semibold", c.new_price > c.old_price ? "text-good" : "text-warn")}>{money(c.new_price)}</span>
                </span>
              </li>
            ))}
          </ul>
          {preview.unchanged > 0 && (
            <p className="border-t border-line py-2.5 text-[12.5px] text-muted">{t("reprice.sameHint", { n: preview.unchanged })}</p>
          )}
          {preview.skipped_manual.length > 0 && (
            <div className="my-2 rounded-lg bg-raised px-3 py-2.5 text-[12.5px] text-muted">
              <p className="font-medium text-fg">{t("reprice.manualTitle")}</p>
              <ul className="mt-1 space-y-0.5">
                {preview.skipped_manual.map((m) => (
                  <li key={m.listing_id}>
                    {m.product_title} · {m.variant_name} — <span className="font-mono">{money(m.price)}</span>
                    {!m.margin_ok && <span className="text-warn"> · {t("reprice.manualBlocked")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter className="mt-3 flex-row justify-end gap-2 border-t border-line bg-raised px-5 py-3.5">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{t("cancel")}</Button>
          <Button onClick={onConfirm} disabled={busy}>
            <Check size={15} />
            {confirmLabel ?? (preview.changed.length > 0 ? t("reprice.confirm", { n: preview.changed.length }) : t("reprice.close"))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
