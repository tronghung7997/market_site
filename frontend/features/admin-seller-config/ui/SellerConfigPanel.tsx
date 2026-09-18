"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Input, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { SettingsFooter, SettingsRow, SettingsToggle } from "@/features/admin-site-settings";

const THRESHOLD_RANGE = { min: 1, max: 1_000, fallback: 20 };
const LIMIT_RANGE = { min: 100, max: 500_000, fallback: 50_000 };
const REVIEW_WINDOW_RANGE = { min: 1, max: 365, fallback: 30 };
const AUTO_REVIEW_RANGE = { min: 1, max: 90, fallback: 7 };

/** Admin › Settings › Sellers: one editable row per knob that used to be a constant. */
export function SellerConfigPanel() {
  const t = useTranslations("adminSellerConfig");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.adminSellerConfig(), queryFn: api.adminSellerConfig });
  const [threshold, setThreshold] = useState("");
  const [limit, setLimit] = useState("");
  const [reviewWindow, setReviewWindow] = useState("");
  const [autoDays, setAutoDays] = useState("");
  const [autoEnabled, setAutoEnabled] = useState(true);
  const toast = useToast();

  useEffect(() => {
    if (query.data) {
      setThreshold(String(query.data.low_stock_threshold));
      setLimit(String(query.data.inventory_export_row_limit));
      setReviewWindow(String(query.data.review_window_days));
      setAutoDays(String(query.data.auto_review_days));
      setAutoEnabled(query.data.auto_review_enabled);
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.updateAdminSellerConfig>[0]) => api.updateAdminSellerConfig(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminSellerConfig(), data);
      void queryClient.invalidateQueries({ queryKey: ["seller-inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["seller-products"] });
      toast.success(t("saved"));
    },
    onError: (err) => toast.error(apiErrorMessage(err, t("saveFailed"))),
  });

  const thresholdNum = Number(threshold);
  const limitNum = Number(limit);
  const thresholdOk = Number.isInteger(thresholdNum) && thresholdNum >= THRESHOLD_RANGE.min && thresholdNum <= THRESHOLD_RANGE.max;
  const limitOk = Number.isInteger(limitNum) && limitNum >= LIMIT_RANGE.min && limitNum <= LIMIT_RANGE.max;
  const reviewWindowNum = Number(reviewWindow);
  const autoDaysNum = Number(autoDays);
  const reviewWindowOk = Number.isInteger(reviewWindowNum) && reviewWindowNum >= REVIEW_WINDOW_RANGE.min && reviewWindowNum <= REVIEW_WINDOW_RANGE.max;
  const autoDaysOk = Number.isInteger(autoDaysNum) && autoDaysNum >= AUTO_REVIEW_RANGE.min && autoDaysNum <= AUTO_REVIEW_RANGE.max;
  const allOk = thresholdOk && limitOk && reviewWindowOk && autoDaysOk;
  const dirty = query.data ? (
    thresholdNum !== query.data.low_stock_threshold || limitNum !== query.data.inventory_export_row_limit
    || reviewWindowNum !== query.data.review_window_days || autoDaysNum !== query.data.auto_review_days
    || autoEnabled !== query.data.auto_review_enabled
  ) : false;
  const resetForm = () => {
    if (!query.data) return;
    setThreshold(String(query.data.low_stock_threshold)); setLimit(String(query.data.inventory_export_row_limit));
    setReviewWindow(String(query.data.review_window_days)); setAutoDays(String(query.data.auto_review_days));
    setAutoEnabled(query.data.auto_review_enabled);
  };

  if (query.isPending) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (query.isError) {
    return (
      <section className="rounded-card border border-line bg-card p-4 shadow-card text-[12.5px] text-bad">
        {apiErrorMessage(query.error, t("loadFailed"))}
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()} className="ml-3">{t("retry")}</Button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <SettingsRow title={t("thresholdTitle")} hint={t("thresholdHint")} label={t("thresholdLabel")}>
        <div className="flex items-center gap-2">
          <Input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))} aria-invalid={!thresholdOk} className="h-10 w-full max-w-[220px] text-right font-mono text-[13px] tabular-nums" />
          <span className="shrink-0 text-[12px] text-muted">≤</span>
        </div>
        <span className="mt-1 block text-[11px] text-faint">{t("thresholdRange", { min: THRESHOLD_RANGE.min, max: THRESHOLD_RANGE.max.toLocaleString(locale), fallback: THRESHOLD_RANGE.fallback })}</span>
      </SettingsRow>
      <SettingsRow title={t("limitTitle")} hint={t("limitHint")} label={t("limitLabel")}>
        <Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} aria-invalid={!limitOk} className="h-10 w-full max-w-[220px] text-right font-mono text-[13px] tabular-nums" />
        <span className="mt-1 block text-[11px] text-faint">{t("limitRange", { min: LIMIT_RANGE.min.toLocaleString(locale), max: LIMIT_RANGE.max.toLocaleString(locale), fallback: LIMIT_RANGE.fallback.toLocaleString(locale) })}</span>
      </SettingsRow>
      <SettingsRow title={t("reviewWindowTitle")} hint={t("reviewWindowHint")} label={t("daysLabel")}>
        <Input inputMode="numeric" value={reviewWindow} onChange={(e) => setReviewWindow(e.target.value.replace(/\D/g, ""))} aria-invalid={!reviewWindowOk} className="h-10 w-full max-w-[220px] text-right font-mono text-[13px] tabular-nums" />
        <span className="mt-1 block text-[11px] text-faint">{t("thresholdRange", { min: REVIEW_WINDOW_RANGE.min, max: REVIEW_WINDOW_RANGE.max, fallback: REVIEW_WINDOW_RANGE.fallback })}</span>
      </SettingsRow>
      <SettingsRow title={t("autoReviewTitle")} hint={t("autoReviewHint")} label={t("daysLabel")}>
        <Input inputMode="numeric" value={autoDays} onChange={(e) => setAutoDays(e.target.value.replace(/\D/g, ""))} aria-invalid={!autoDaysOk} disabled={!autoEnabled} className="h-10 w-full max-w-[220px] text-right font-mono text-[13px] tabular-nums disabled:opacity-50" />
        <span className="mt-1 block text-[11px] text-faint">{t("thresholdRange", { min: AUTO_REVIEW_RANGE.min, max: AUTO_REVIEW_RANGE.max, fallback: AUTO_REVIEW_RANGE.fallback })}</span>
        <div className="mt-3">
          <SettingsToggle checked={autoEnabled} onChange={setAutoEnabled} label={t("autoReviewEnabled")} />
        </div>
      </SettingsRow>
    </section>
      <SettingsFooter
        updatedAt={query.data.updated_at}
        dirty={dirty}
        valid={allOk}
        saving={save.isPending}
        onReset={resetForm}
        onSave={() => save.mutate({ low_stock_threshold: thresholdNum, inventory_export_row_limit: limitNum, review_window_days: reviewWindowNum, auto_review_days: autoDaysNum, auto_review_enabled: autoEnabled })}
      />
    </div>
  );
}
