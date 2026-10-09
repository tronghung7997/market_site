import { useTranslations } from "next-intl";

/** Escrow holds (product hold, admin floors, tier reductions) are stored in
 *  hours. A whole number of days reads as days ("2 ngày"), anything else as
 *  hours ("36 giờ"). */
export function holdParts(hours: number): { unit: "days" | "hours"; count: number } {
  const value = Math.max(0, Math.round(hours));
  return value > 0 && value % 24 === 0 ? { unit: "days", count: value / 24 } : { unit: "hours", count: value };
}

/** `(hours) => "2 ngày" | "36 giờ"` in the current locale (common.holdDays / holdHours). */
export function useHoldLabel(): (hours: number) => string {
  const t = useTranslations("common");
  return (hours: number) => {
    const { unit, count } = holdParts(hours);
    return unit === "days" ? t("holdDays", { count }) : t("holdHours", { count });
  };
}
