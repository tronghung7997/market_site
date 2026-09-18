"use client";

import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useState } from "react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { useAuth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { Wallet, WithdrawRequest } from "@/lib/types";
import { Button, Card, Input, Tag } from "@/components/ui";
import { DisplayCurrencyInput } from "@/components/DisplayCurrencyInput";
import { FrozenNotice, useFlowFrozen } from "@/features/site-status";

const WITHDRAW_TONE: Record<string, "good" | "bad" | "warn" | "iris" | "neutral"> = {
  pending: "warn",
  approved: "good",
  paid: "good",
  rejected: "bad",
};

export function WithdrawCard({ wallet, onChanged }: {
  wallet: Wallet | null;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("wallet");
  const apiErrorMessage = useApiErrorMessage();
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const { account } = useAuth();
  const withdrawalsFrozen = useFlowFrozen("withdrawals");
  const [amount, setAmount] = useState(0);
  const [totpCode, setTotpCode] = useState("");
  const [needsTotpSetup, setNeedsTotpSetup] = useState(false);
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const available = wallet?.available_balance ?? 0;
  // Admin's withdrawal rules (Settings › Fees & holds): minimum and fee, quoted before the seller commits.
  const feeConfig = useQuery({ queryKey: queryKeys.feeConfig(), queryFn: api.feeConfig, staleTime: 60_000 });
  const minAmount = feeConfig.data?.withdraw_min_amount ?? 0;
  const feeFixed = feeConfig.data?.withdraw_fee_fixed ?? 0;
  const feePercent = feeConfig.data?.withdraw_fee_percent ?? 0;
  const feeAmount = amount > 0 ? Math.max(0, Math.min(amount, feeFixed + Math.floor(amount * feePercent / 100))) : 0;
  const netAmount = amount - feeAmount;
  const hasFee = feeFixed > 0 || feePercent > 0;
  const belowMin = amount > 0 && (amount < minAmount || netAmount <= 0);

  const handleWithdraw = async () => {
    const value = amount;
    if (value <= 0) { setErr(t("withdrawErrAmount")); return; }
    if (value > available) { setErr(t("withdrawErrBalance")); return; }
    if (belowMin) { setErr(t("withdrawErrMin", { min: formatBrowseMoney(minAmount, { locale }) })); return; }
    if (!bankName.trim() || !bankAccountNumber.trim() || !bankAccountHolder.trim()) {
      setErr(t("withdrawErrBank"));
      return;
    }
    setLoading(true);
    setMsg("");
    setErr("");
    try {
      await api.requestWithdraw(value, {
        bank_name: bankName.trim(),
        bank_account_number: bankAccountNumber.trim(),
        bank_account_holder: bankAccountHolder.trim(),
        totp_code: totpCode.trim() || undefined,
      });
      setAmount(0);
      setTotpCode("");
      setMsg(t("withdrawSuccess"));
      await onChanged();
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      if (e instanceof ApiError && e.errorCode === "MFA_SETUP_REQUIRED") setNeedsTotpSetup(true);
      setErr(t("withdrawFail", { error: apiErrorMessage(e, "—") }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-line bg-raised/30">
        <h3 className="text-[13px] font-semibold">{t("withdrawTitle")}</h3>
      </div>
      <div className="p-5 space-y-3">
        <FrozenNotice flow="withdrawals" />
        {msg && (
          <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">✓ {msg}</div>
        )}
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
            {t("withdrawBank")}
          </label>
          <Input
            placeholder={t("withdrawBankPh")}
            value={bankName}
            onChange={(e) => { setBankName(e.target.value); setErr(""); }}
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
            {t("withdrawAccount")}
          </label>
          <Input
            placeholder={t("withdrawAccountPh")}
            value={bankAccountNumber}
            onChange={(e) => { setBankAccountNumber(e.target.value); setErr(""); }}
            disabled={loading}
            className="font-mono tabular"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
            {t("withdrawHolder")}
          </label>
          <Input
            placeholder={t("withdrawHolderPh")}
            value={bankAccountHolder}
            onChange={(e) => { setBankAccountHolder(e.target.value); setErr(""); }}
            disabled={loading}
          />
        </div>
        {account?.mfa_available && account?.totp_enabled && (
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
              {t("withdrawTotp")}
            </label>
            <Input
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(e) => { setTotpCode(e.target.value.replace(/[^0-9a-zA-Z-]/g, "").slice(0, 16)); setErr(""); }}
              disabled={loading}
              className="font-mono tracking-[0.2em] max-w-[200px]"
            />
            <p className="mt-1 text-[11px] text-faint">{t("withdrawTotpHint")}</p>
          </div>
        )}
        {needsTotpSetup && (
          <div className="p-2.5 rounded-lg bg-warn-soft text-warn text-[12px]">
            {t("withdrawTotpSetup")}{" "}
            <Link href="/account/security?setup=2fa" className="font-medium underline">{t("withdrawTotpSetupLink")}</Link>
          </div>
        )}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-faint font-medium">{t("withdrawAmount")}</span>
            <button
              onClick={() => setAmount(available)}
              className="text-[11px] text-iris hover:text-iris-hi transition-colors cursor-pointer"
            >
              {t("withdrawMax", { amount: formatBrowseMoney(available, { locale }) })}
            </button>
          </div>
          <DisplayCurrencyInput
            amountVnd={amount}
            onAmountVndChange={(value) => { setAmount(value); setErr(""); }}
            disabled={loading}
            invalid={amount > available || belowMin}
          />
          {(minAmount > 0 || hasFee) && (
            <div className="mt-2 space-y-0.5 text-[12px] text-muted">
              {minAmount > 0 && <p>{t("withdrawMin", { min: formatBrowseMoney(minAmount, { locale }) })}</p>}
              {hasFee && (
                <p>
                  {t("withdrawFeeRule", { fixed: formatBrowseMoney(feeFixed, { locale }), percent: feePercent })}
                  {amount > 0 && <> · <span className="text-fg">{t("withdrawNet", { fee: formatBrowseMoney(feeAmount, { locale }), net: formatBrowseMoney(netAmount, { locale }) })}</span></>}
                </p>
              )}
            </div>
          )}
        </div>
        {err && (
          <div className="p-2.5 rounded-lg bg-bad-soft text-bad text-[12px]">{err}</div>
        )}
        <Button
          variant="secondary"
          size="md"
          block
          onClick={handleWithdraw}
          disabled={loading || !amount || withdrawalsFrozen || belowMin}
        >
          {loading ? t("withdrawSubmitting") : t("withdrawSubmit")}
        </Button>
        <p className="text-[11px] text-faint">{t("withdrawCurrencyHint")}</p>
      </div>
    </Card>
  );
}

export function WithdrawHistory({ withdrawals }: { withdrawals: WithdrawRequest[] }) {
  const t = useTranslations("wallet");
  const tw = useTranslations("status.withdraw");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  if (withdrawals.length === 0) return null;
  return (
    <Card className="p-5">
      <h3 className="text-[13px] font-semibold mb-3">{t("withdrawHistory")}</h3>
      <div className="space-y-2.5">
        {withdrawals.map((w) => (
          <div key={w.id} className="flex items-center justify-between text-[13px]">
            <div>
              <div className="font-mono font-medium tabular">{formatBrowseMoney(w.amount, { locale })}</div>
              <div className="text-[11px] text-faint">
                {formatDate(w.created_at, locale)}
                {(w.fee_amount ?? 0) > 0 && <> · {t("withdrawHistoryNet", { fee: formatBrowseMoney(w.fee_amount ?? 0, { locale }), net: formatBrowseMoney(w.net_amount ?? w.amount - (w.fee_amount ?? 0), { locale }) })}</>}
              </div>
            </div>
            <Tag tone={WITHDRAW_TONE[w.status] ?? "neutral"}>
              {tw.has(w.status) ? tw(w.status as "pending") : w.status}
            </Tag>
          </div>
        ))}
      </div>
    </Card>
  );
}
