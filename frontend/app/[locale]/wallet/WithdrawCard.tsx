"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { Wallet, WithdrawRequest } from "@/lib/types";
import { Button, Card, Input, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";

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
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const available = wallet?.available_balance ?? 0;

  const handleWithdraw = async () => {
    const value = parseInt(amount) || 0;
    if (value <= 0) { setErr(t("withdrawErrAmount")); return; }
    if (value > available) { setErr(t("withdrawErrBalance")); return; }
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
      });
      setAmount("");
      setMsg(t("withdrawSuccess"));
      await onChanged();
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      setErr(t("withdrawFail", { error: e instanceof Error ? e.message : "—" }));
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
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-faint font-medium">{t("withdrawAmountVnd")}</span>
            <button
              onClick={() => setAmount(String(available))}
              className="text-[11px] text-iris hover:text-iris-hi transition-colors cursor-pointer"
            >
              {t("withdrawMaxVnd", { amount: formatLedgerMoney(available, locale) })}
            </button>
          </div>
          <MoneyInput
            value={amount}
            onValueChange={(v) => { setAmount(v); setErr(""); }}
            placeholder={t("withdrawAmountPh")}
            disabled={loading}
            invalid={!!amount && Number(amount) > available}
          />
        </div>
        {err && (
          <div className="p-2.5 rounded-lg bg-bad-soft text-bad text-[12px]">{err}</div>
        )}
        <Button
          variant="secondary"
          size="md"
          block
          onClick={handleWithdraw}
          disabled={loading || !amount}
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
  const { formatLedgerMoney } = useMoney();
  if (withdrawals.length === 0) return null;
  return (
    <Card className="p-5">
      <h3 className="text-[13px] font-semibold mb-3">{t("withdrawHistory")}</h3>
      <div className="space-y-2.5">
        {withdrawals.map((w) => (
          <div key={w.id} className="flex items-center justify-between text-[13px]">
            <div>
              <div className="font-mono font-medium tabular">{formatLedgerMoney(w.amount, locale)}</div>
              <div className="text-[11px] text-faint">
                {formatDate(w.created_at, locale)}
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
