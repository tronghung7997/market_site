"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils/format";
import type { DepositIntent } from "@/lib/types";
import { openHelpdesk } from "@/features/helpdesk";
import { depositRef } from "./deposit-history";

/** Opens "Chat với GMMO" with a check request for one top-up, or a general one. */
export function useRequestDepositCheck() {
  const t = useTranslations("wallet");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  return (deposit?: DepositIntent) => openHelpdesk({
    role: "buyer",
    draft: deposit
      ? t("checkDraft", { code: depositRef(deposit), amount: formatLedgerMoney(deposit.amount, locale), time: formatDateTime(deposit.created_at, locale) })
      : t("checkDraftGeneric"),
  });
}
