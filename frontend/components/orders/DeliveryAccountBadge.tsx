"use client";

import { useTranslations } from "next-intl";
import type { DeliveryResourceMark } from "@/lib/dispute-case";
import { lineLabel } from "@/lib/order-ref";

export function DeliveryAccountBadge({
  mark,
  highlighted,
  formatRefund,
  lineOf,
}: {
  mark?: DeliveryResourceMark;
  highlighted?: boolean;
  formatRefund?: (amount: number) => string;
  /** resource id → 1-based stock line, so chips point at "#03" rather than a row id. */
  lineOf?: Record<number, number>;
}) {
  const t = useTranslations("orders");
  const lineRef = (id: number | null | undefined) => (id != null && lineOf?.[id] ? lineLabel(lineOf[id]) : null);
  const chips: Array<{ key: string; className: string; label: string }> = [];
  if (highlighted) {
    chips.push({
      key: "highlight",
      className: "bg-iris-soft text-iris-hi",
      label: t("accountFromNotification"),
    });
  }
  if (mark?.kind === "refunded") {
    chips.push({
      key: "refunded",
      className: "bg-good-soft text-good",
      label: formatRefund && mark.amount
        ? t("accountRefundedAmount", { amount: formatRefund(mark.amount) })
        : t("accountRefunded"),
    });
  } else if (mark?.kind === "replaced") {
    const target = lineRef(mark.replacementId);
    chips.push({
      key: "replaced",
      className: "bg-iris-soft text-iris-hi",
      label: target ? t("accountReplaced", { id: target }) : t("accountReplacedUnknown"),
    });
  } else if (mark?.kind === "replacement") {
    const original = lineRef(mark.originalId);
    chips.push({
      key: "replacement",
      className: "bg-iris-soft text-iris-hi",
      label: original ? t("accountReplacement", { id: original }) : t("accountReplacementUnknown"),
    });
  } else if (mark?.kind === "claimed") {
    chips.push({
      key: "claimed",
      className: "bg-warn-soft text-warn",
      label: t("accountAlreadyClaimed"),
    });
  }
  if (chips.length === 0) return null;
  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${chip.className}`}
        >
          {chip.label}
        </span>
      ))}
    </>
  );
}
