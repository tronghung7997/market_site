"use client";

import { useTranslations } from "next-intl";
import type { DeliveryResourceMark } from "@/lib/dispute-case";

export function DeliveryAccountBadge({
  mark,
  highlighted,
  formatRefund,
}: {
  mark?: DeliveryResourceMark;
  highlighted?: boolean;
  formatRefund?: (amount: number) => string;
}) {
  const t = useTranslations("orders");
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
    chips.push({
      key: "replaced",
      className: "bg-iris-soft text-iris-hi",
      label: mark.replacementId
        ? t("accountReplaced", { id: mark.replacementId })
        : t("accountReplacedUnknown"),
    });
  } else if (mark?.kind === "replacement") {
    chips.push({
      key: "replacement",
      className: "bg-iris-soft text-iris-hi",
      label: t("accountReplacement", { id: mark.originalId }),
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
