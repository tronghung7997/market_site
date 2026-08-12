"use client";

/**
 * Booking-style display currency control — independent of language.
 *
 * Design read: product chrome for marketplace buyers; trust-first commerce.
 * Match existing iris/surface nav tokens; segmented control like LocaleSwitcher.
 * Clarity first: short labels (VND / USD) + tooltip that money is display-only.
 *
 * VARIANCE 3 · MOTION 3 · DENSITY 5 — no flashy motion; preference feedback only.
 */

import { useLocale, useTranslations } from "next-intl";
import { useMoney, type DisplayCurrency } from "@/lib/money";
import { cn } from "@/lib/cn";

const OPTIONS: { code: DisplayCurrency; short: string }[] = [
  { code: "VND", short: "VND" },
  { code: "USD", short: "USD" },
];

export default function CurrencyToggle({
  className,
  compact = false,
}: {
  className?: string;
  /** Icon-free, denser — for mobile drawer. */
  compact?: boolean;
}) {
  const t = useTranslations("currency");
  const locale = useLocale();
  const { currency, setCurrency, allowToggle, fxRate, configReady } = useMoney();

  if (!allowToggle) return null;

  const rateHint =
    fxRate != null
      ? t("rateHint", {
          rate: new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US").format(fxRate),
        })
      : t("rateUnavailable");

  return (
    <div
      className={cn("inline-flex items-center gap-1.5", className)}
      role="group"
      aria-label={t("label")}
    >
      {!compact && (
        <span className="hidden lg:inline text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint select-none">
          {t("shortLabel")}
        </span>
      )}
      <span
        className={cn(
          "inline-flex items-center rounded-lg border border-line bg-raised/75 p-0.5",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
          !configReady && "opacity-70",
        )}
        title={`${t("tooltip")}\n${rateHint}`}
      >
        {OPTIONS.map((opt) => {
          const active = currency === opt.code;
          return (
            <button
              key={opt.code}
              type="button"
              onClick={() => setCurrency(opt.code)}
              aria-pressed={active}
              aria-label={
                opt.code === "USD" ? t("optionUsd") : t("optionVnd")
              }
              className={cn(
                "min-w-10 rounded-md px-2 py-1.5 text-[11px] font-bold tracking-[0.08em]",
                "transition-[background-color,color,box-shadow] duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40 focus-visible:ring-offset-1",
                active
                  ? "bg-iris text-white shadow-[0_1px_2px_rgba(67,56,202,0.32)]"
                  : "text-faint hover:bg-surface hover:text-fg",
              )}
            >
              {opt.short}
            </button>
          );
        })}
      </span>
    </div>
  );
}
