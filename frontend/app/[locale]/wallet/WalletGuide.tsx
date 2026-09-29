"use client";

/** How a top-up works, the real per-request limits from the deposit rails,
 *  what to do when a payment is not credited, and the full top-up history. */

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/cn";
import type { DepositIntent } from "@/lib/types";
import { Button, Card, Skeleton, Tag } from "@/components/ui";
import { AlertCircle, ArrowRight, Download } from "@/components/Icons";
import {
  countDeposits, DEPOSIT_FILTERS, depositRef, depositsCsv, depositTotals, filterDeposits, needsDepositCheck, type DepositFilter,
} from "./deposit-history";
import { useRequestDepositCheck } from "./useDepositCheck";

const STEPS = ["Amount", "Pay", "Credit"] as const;

const STATUS_TONE: Record<DepositIntent["status"], "good" | "warn" | "neutral"> = {
  paid: "good",
  pending: "warn",
  expired: "neutral",
  cancelled: "neutral",
};

export function TopUpGuide({ checkable }: { checkable?: DepositIntent }) {
  const t = useTranslations("wallet");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const methods = useQuery({ queryKey: ["deposit-methods"], queryFn: () => api.depositMethods(), staleTime: 60_000 });
  const requestCheck = useRequestDepositCheck();
  const m = methods.data;
  const rails = m ? [
    { key: "bank", label: t("limitsBank"), on: m.sepay_enabled, min: m.deposit_min_amount, max: m.deposit_max_amount },
    { key: "usdt", label: t("limitsUsdt"), on: m.nowpayments_enabled, min: m.deposit_usdt_min_vnd, max: m.deposit_usdt_max_vnd },
  ] : [];

  return (
    <Card className="p-5">
      <h2 className="text-[14px] font-semibold">{t("guideTitle")}</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step} className="flex gap-3 sm:flex-col sm:gap-2">
            <span aria-hidden className="grid place-items-center h-7 w-7 shrink-0 rounded-full border border-line-2 font-mono text-[12px] font-semibold">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t(`guideStep${step}`)}</span>
              <span className="block mt-0.5 text-[12px] leading-relaxed text-muted">{t(`guideStep${step}Body`)}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-[12.5px] font-semibold text-muted">{t("limitsTitle")}</h3>
        {methods.isPending ? (
          <div className="mt-2 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
        ) : methods.isError ? (
          <p className="mt-2 text-[12.5px] text-bad">{t("depositMethodsLoadFail")}</p>
        ) : (
          <dl className="mt-2 space-y-1.5 text-[12.5px]">
            {rails.map((rail) => (
              <div key={rail.key} className="flex items-center justify-between gap-3">
                <dt className="text-muted">{rail.label}</dt>
                <dd className={cn("font-mono tabular", !rail.on && "font-sans text-faint")}>
                  {!rail.on
                    ? t("limitsOff")
                    : rail.key === "bank"
                      ? <span className="font-sans">{t("limitsBankAny")}</span>
                      : t("limitsRange", { min: formatLedgerMoney(rail.min, locale), max: formatLedgerMoney(rail.max, locale) })}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-faint">{t("limitsExpire")}</p>
      </div>

      <div className="mt-4 rounded-lg border border-warn/25 bg-warn-soft p-3.5">
        <h3 className="flex items-center gap-2 text-[13px] font-medium"><AlertCircle size={14} className="text-warn" /> {t("missingTitle")}</h3>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-fg/85">
          {[t("missingCheck"), t("missingKeep"), t("missingNoRepeat")].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="sm" variant="secondary" onClick={() => requestCheck(checkable)}>{t("checkRequest")}</Button>
          <Link href="/support#faq" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">
            {t("missingHelp")} <ArrowRight size={13} />
          </Link>
        </div>
        {checkable && <p className="mt-2 text-[11.5px] text-muted">{t("checkPrefilled", { code: depositRef(checkable) })}</p>}
      </div>
    </Card>
  );
}

export function DepositHistory({ deposits, loading, error, canLoadMore, onLoadMore, loadingMore }: {
  deposits: DepositIntent[];
  loading: boolean;
  error: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  const t = useTranslations("wallet");
  const td = useTranslations("status.deposit");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const [filter, setFilter] = useState<DepositFilter>("all");
  const counts = useMemo(() => countDeposits(deposits), [deposits]);
  const rows = useMemo(() => filterDeposits(deposits, filter), [deposits, filter]);
  const totals = useMemo(() => depositTotals(deposits), [deposits]);
  const requestCheck = useRequestDepositCheck();
  const now = Date.now();
  const methodLabel = (d: DepositIntent) => (d.provider === "nowpayments" ? t("depositRailUsdt") : t("depositRailBank"));
  const filterLabel = (f: DepositFilter) => (f === "all" ? t("historyAll") : td(f));

  const exportCsv = () => {
    const csv = depositsCsv(
      rows,
      { code: t("historyCode"), time: t("historyTime"), method: t("historyMethod"), amount: t("historyAmount"), status: t("historyStatus") },
      (status) => td(status),
    );
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `gmmo-topups-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="deposit-history-title" className="mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="deposit-history-title" className="text-[13px] font-semibold">{t("historyTitle")}</h2>
          {deposits.length > 0 && (
            <p className="text-[12px] text-faint">
              {t("historyScope", { count: deposits.length })}
              {" · "}{t("historyCredited", { amount: formatLedgerMoney(totals.credited, locale) })}
              {totals.pending > 0 && <>{" · "}{t("historyPending", { amount: formatLedgerMoney(totals.pending, locale) })}</>}
            </p>
          )}
        </div>
        {rows.length > 0 && (
          <Button size="sm" variant="secondary" onClick={exportCsv}><Download size={13} /> {t("historyExport")}</Button>
        )}
      </div>
      {deposits.length > 0 && (
        <div role="group" aria-label={t("historyStatus")} className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {DEPOSIT_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors",
                filter === f ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:text-fg hover:border-line-2",
              )}
            >
              {filterLabel(f)} <span className="font-mono text-[11px] opacity-75">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4" aria-hidden><Skeleton className="h-4" /><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div>
        ) : error ? (
          <p className="px-4 py-6 text-center text-[13px] text-bad">{t("historyLoadError")}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted">{deposits.length === 0 ? t("historyEmpty") : t("historyEmptyFilter")}</p>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_110px_minmax(0,1fr)_120px] gap-3 border-b border-line bg-raised/40 px-4 py-2 text-[11.5px] font-medium text-muted">
              <span>{t("historyCode")}</span><span>{t("historyTime")}</span><span>{t("historyMethod")}</span>
              <span className="text-right">{t("historyAmount")}</span><span>{t("historyStatus")}</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((d) => (
                <li key={d.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-[12.5px] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_110px_minmax(0,1fr)_120px] md:items-center">
                  <span className="truncate font-mono">{depositRef(d)}</span>
                  <span className="text-right text-muted md:text-left">{formatDateTime(d.created_at, locale)}</span>
                  <span className="text-muted">{methodLabel(d)}</span>
                  <span className="text-right font-mono tabular">{formatLedgerMoney(d.amount, locale)}</span>
                  <span className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 md:col-span-1">
                    <Tag tone={STATUS_TONE[d.status]}>{td(d.status)}</Tag>
                    {needsDepositCheck(d, now) && (
                      <button type="button" onClick={() => requestCheck(d)} className="text-[11.5px] font-medium text-iris-hi hover:underline">
                        {t("checkShort")}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {canLoadMore && (
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="secondary" loading={loadingMore} onClick={onLoadMore}>{t("historyLoadMore")}</Button>
        </div>
      )}
    </section>
  );
}
