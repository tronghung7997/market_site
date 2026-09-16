"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { SellerDashboardRange, SellerDashboardRangeKey } from "@/lib/types";
import { Button, Input } from "@/components/ui";
import {
  customRangeError,
  formatIsoDate,
  localIsoDate,
  RANGE_PRESETS,
  type DashboardRangeParams,
} from "../model";

export const PRESET_LABEL = {
  today: "rangeToday",
  this_week: "rangeThisWeek",
  this_month: "rangeThisMonth",
  this_quarter: "rangeThisQuarter",
  this_year: "rangeThisYear",
  "7d": "range7d",
  "30d": "range30d",
  "90d": "range90d",
  custom: "rangeCustom",
} as const satisfies Record<SellerDashboardRangeKey, string>;

export function DashboardRangePicker({
  params,
  resolved,
  onChange,
}: {
  params: DashboardRangeParams;
  /** Range echoed by the API — drives the "15/8 – 14/9" summary line. */
  resolved: SellerDashboardRange | null;
  onChange: (next: DashboardRangeParams) => void;
}) {
  const t = useTranslations("sellerDashboard");
  const locale = useLocale();
  const [customOpen, setCustomOpen] = useState(params.range === "custom");
  const [from, setFrom] = useState(params.from ?? "");
  const [to, setTo] = useState(params.to ?? localIsoDate());
  const [error, setError] = useState<ReturnType<typeof customRangeError>>(null);

  useEffect(() => {
    if (params.range === "custom") {
      setCustomOpen(true);
      setFrom(params.from ?? "");
      setTo(params.to ?? localIsoDate());
    }
  }, [params.range, params.from, params.to]);

  const applyCustom = () => {
    const problem = customRangeError(from, to);
    setError(problem);
    if (problem) return;
    onChange({ range: "custom", from, to });
  };

  const options: SellerDashboardRangeKey[] = [...RANGE_PRESETS, "custom"];
  const active = params.range;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label={t("rangeLabel")}
          className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5"
        >
          {options.map((key) => {
            const selected = active === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  if (key === "custom") {
                    setCustomOpen(true);
                    return;
                  }
                  setCustomOpen(false);
                  setError(null);
                  onChange({ range: key });
                }}
                className={cn(
                  "h-7 rounded-md px-3 text-[12.5px] font-medium transition-colors",
                  selected ? "bg-surface text-fg font-semibold shadow-xs" : "text-muted hover:text-fg",
                )}
              >
                {t(PRESET_LABEL[key])}
              </button>
            );
          })}
        </div>
        {resolved && (
          <span className="text-[12px] text-faint">
            {t("periodSummary", {
              from: formatIsoDate(resolved.from_date, locale),
              to: formatIsoDate(resolved.to_date, locale, { day: "numeric", month: "short", year: "numeric" }),
              compareFrom: formatIsoDate(resolved.compare_from_date, locale),
              compareTo: formatIsoDate(resolved.compare_to_date, locale),
            })}
          </span>
        )}
      </div>

      {customOpen && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyCustom();
          }}
        >
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t("fromDate")}
            <Input
              type="date"
              value={from}
              max={to || localIsoDate()}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-auto text-[12.5px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t("toDate")}
            <Input
              type="date"
              value={to}
              min={from || undefined}
              max={localIsoDate()}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-auto text-[12.5px]"
            />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            {t("apply")}
          </Button>
          {error && (
            <span role="alert" className="text-[12px] text-bad">
              {t(error === "missing" ? "customMissing" : error === "order" ? "customOrder" : "customTooLong")}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
