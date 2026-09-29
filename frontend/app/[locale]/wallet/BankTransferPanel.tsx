"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button } from "@/components/ui";
import { bankName } from "./bank-names";

// While the transfer screen is open, look for incoming money this often.
const POLL_MS = 6000;

/**
 * Bank transfer with the owner's standing memo. The QR carries no amount:
 * the buyer types any amount in their banking app and the wallet is credited
 * with exactly what arrives. The same QR works for every future top-up.
 */
export function BankTransferPanel({ onPoll, shortfallVnd }: {
  /** Refresh wallet data so a credited transfer shows up. */
  onPoll: () => Promise<void>;
  /** Amount the buyer came to top up (checkout shortfall), in ledger VND. */
  shortfallVnd?: number | null;
}) {
  const t = useTranslations("wallet");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const { formatLedgerMoney } = useMoney();
  const [copied, setCopied] = useState<string | null>(null);

  const accountQ = useQuery({
    queryKey: queryKeys.bankDepositAccount(),
    queryFn: () => api.bankDepositAccount(),
    staleTime: Infinity,
    retry: 1,
  });

  useEffect(() => {
    if (!accountQ.data) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void onPoll();
    }, POLL_MS);
    // Buyers pay in their banking app and come back: check at once.
    const onVisible = () => {
      if (document.visibilityState === "visible") void onPoll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [accountQ.data, onPoll]);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked: the value is still selectable */
    }
  };

  if (accountQ.isPending) {
    return <div className="py-8 text-center text-[13px] text-muted">{t("depositMethodsLoading")}</div>;
  }
  if (accountQ.isError || !accountQ.data) {
    return (
      <div className="space-y-3 py-4 text-center">
        <p className="text-[13px] text-bad">{apiErrorMessage(accountQ.error, t("bankAccountLoadFail"))}</p>
        <Button variant="secondary" size="sm" onClick={() => void accountQ.refetch()}>
          {t("depositMethodsRetry")}
        </Button>
      </div>
    );
  }

  const acc = accountQ.data;
  return (
    <div className="space-y-3">
      {shortfallVnd ? (
        <p className="rounded-lg border border-iris/30 bg-iris-soft/40 px-3 py-2 text-[12px] text-fg">
          {t("bankShortfall", { amount: formatLedgerMoney(shortfallVnd, locale) })}
        </p>
      ) : null}

      <div className="space-y-3">
        <div className="mx-auto flex w-fit flex-col items-center rounded-xl border border-line bg-white p-3 shadow-sm">
          {/* The VietQR image is rendered by the bank-QR service; its URL is not a QR payload. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={acc.qr_code}
            alt={t("depositQrAlt")}
            className="h-[min(56vw,200px)] w-[min(56vw,200px)] object-contain"
            loading="eager"
          />
          <span className="mt-1.5 text-[11px] font-medium text-slate-500">{t("bankQrReusable")}</span>
        </div>

        <div className="space-y-2 text-[12px]">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-raised/40 p-3">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wider text-faint">
                {t("depositBankAccount")} · {bankName(acc.bank_code) ?? acc.bank_code}
              </div>
              <div className="mt-0.5 break-all font-mono text-[14.5px] font-bold text-fg">{acc.bank_account_number}</div>
              <div className="truncate text-[11px] text-muted">{acc.bank_account_name}</div>
            </div>
            <button
              type="button"
              onClick={() => copy("account", acc.bank_account_number)}
              className="shrink-0 cursor-pointer rounded-md border border-line bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-iris transition-colors hover:bg-iris hover:text-white"
            >
              {copied === "account" ? t("depositCopied") : t("depositCopy")}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-iris/40 bg-iris-soft/40 p-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-iris">
                {t("depositTransferContent")} ({t("depositRequired")})
              </div>
              <div className="mt-0.5 break-all font-mono text-[15px] font-bold text-iris">{acc.payment_code}</div>
            </div>
            <button
              type="button"
              onClick={() => copy("code", acc.payment_code)}
              className="shrink-0 cursor-pointer rounded-md bg-iris px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition-colors hover:bg-iris/90"
            >
              {copied === "code" ? t("depositCopied") : t("depositCopy")}
            </button>
          </div>
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-4 text-[11.5px] leading-relaxed text-muted">
        <li>{t("bankAnyAmount")}</li>
        <li>{t("bankKeepMemo")}</li>
        <li>{t("bankAutoCredit")}</li>
      </ul>
      <p className="text-[11px] leading-relaxed text-faint">{t("bankConsent")}</p>
    </div>
  );
}
