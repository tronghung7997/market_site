"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { Wallet, WithdrawRequest } from "@/lib/types";
import { Button, Card, Input, Spinner, Tag } from "@/components/ui";
import { DisplayCurrencyInput } from "@/components/DisplayCurrencyInput";
import { Wallet as WalletIcon } from "@/components/Icons";

export default function SellerWithdrawalsPage() {
  const t = useTranslations("seller");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [reqs, setReqs] = useState<WithdrawRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState(0);
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const tierLabels: Record<string, string> = {
    new: t("withdrawTierNew"),
    verified: t("withdrawTierVerified"),
    trusted: t("withdrawTierTrusted"),
    enterprise: t("withdrawTierEnterprise"),
  };

  const load = useCallback(async () => {
    const [w, list] = await Promise.all([api.wallet(), api.myWithdrawals()]);
    setWallet(w);
    setReqs(list);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !wallet) return <Spinner label={t("loading")} />;

  const policy = wallet.withdraw_policy;
  const limit = policy?.limit_per_request ?? null;
  const parsed = amount;
  const valid = parsed > 0;
  const overBalance = valid && parsed > wallet.available_balance;
  const overLimit = valid && limit !== null && parsed > limit;

  /* Rút được nhiều nhất: chặn bởi số dư, và bởi hạn mức mỗi lần của cấp. */
  const maxOut = limit === null ? wallet.available_balance : Math.min(wallet.available_balance, limit);

  const bankValid = bankName.trim().length >= 2 && bankAccountNumber.trim().length >= 4 && bankAccountHolder.trim().length >= 2;

  const submit = async () => {
    if (!valid || overBalance || overLimit || !bankValid) return;
    setBusy(true);
    setErr("");
    setOk("");
    try {
      await api.requestWithdraw(parsed, {
        bank_name: bankName.trim(),
        bank_account_number: bankAccountNumber.trim(),
        bank_account_holder: bankAccountHolder.trim(),
      });
      setAmount(0);
      setOk(t("withdrawSubmitted"));
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("withdrawFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-[24px] font-semibold tracking-tight">{t("withdrawTitle")}</h1>
        <p className="text-[12.5px] text-muted mt-0.5">
          {t("withdrawSubtitle")}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr] items-start">
        <div className="space-y-5">
          <Card className="p-5 aura">
            <div className="flex items-center gap-2 text-[11px] text-faint uppercase tracking-wider">
              <WalletIcon size={13} /> {t("availableBalance")}
            </div>
            <div className="font-mono text-[30px] font-semibold tabular tracking-tight mt-1">
              {formatBrowseMoney(wallet.available_balance, { locale })}
            </div>
            {wallet.locked_balance > 0 && (
              <p className="text-[12px] text-muted mt-2">
                {t("lockedPending", { amount: formatBrowseMoney(wallet.locked_balance, { locale }) })}
              </p>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="text-[13px] font-semibold">{t("submitWithdrawal")}</h2>

            <Input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder={t("bankName")}
            />
            <Input
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              placeholder={t("bankAccount")}
              className="font-mono tabular"
            />
            <Input
              value={bankAccountHolder}
              onChange={(e) => setBankAccountHolder(e.target.value)}
              placeholder={t("accountHolder")}
            />

            <div>
              <DisplayCurrencyInput
                amountVnd={amount}
                onAmountVndChange={setAmount}
                invalid={overBalance || overLimit}
              />
              <div className="flex items-center justify-between gap-3 mt-1.5">
                <p className="text-[11.5px] text-faint">
                  {policy ? (
                    limit === null ? (
                      t("withdrawUnlimitedPolicy", { tier: tierLabels[policy.tier] ?? policy.tier })
                    ) : (
                      t("withdrawLimitPolicy", {
                        amount: formatBrowseMoney(limit, { locale }),
                        tier: tierLabels[policy.tier] ?? policy.tier,
                      })
                    )
                  ) : null}
                </p>
                {maxOut > 0 && (
                  <button
                    onClick={() => setAmount(maxOut)}
                    className="shrink-0 text-[11.5px] text-iris-hi hover:underline cursor-pointer"
                  >
                    {t("withdrawMaximum")}
                  </button>
                )}
              </div>
            </div>

            {overBalance && (
              <p className="text-[12px] text-bad">
                {t("withdrawOverBalance", { amount: formatBrowseMoney(wallet.available_balance, { locale }) })}
              </p>
            )}
            {overLimit && !overBalance && limit !== null && (
              <p className="text-[12px] text-bad">
                {t("withdrawOverLimit", {
                  amount: formatBrowseMoney(limit, { locale }),
                  tier: tierLabels[policy!.tier] ?? policy!.tier,
                })}
              </p>
            )}
            {err && <p className="text-[12px] text-bad">{err}</p>}
            {ok && <p className="text-[12px] text-good">{ok}</p>}

            <Button
              block
              onClick={submit}
              disabled={busy || !valid || overBalance || overLimit || !bankValid}
            >
              {busy ? t("submittingWithdraw") : t("submitWithdrawal")}
            </Button>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-line bg-raised/30">
            <span className="text-[13px] font-semibold">{t("withdrawRequests")}</span>
          </div>
          {reqs.length === 0 ? (
            <p className="p-8 text-center text-[13px] text-muted">
              {t("noWithdrawals")}
            </p>
          ) : (
            <div className="divide-y divide-line">
              {reqs.map((r) => {
                const statuses = { pending: { label: t("pendingWithdrawal"), tone: "warn" as const }, approved: { label: t("approvedWithdrawal"), tone: "good" as const }, rejected: { label: t("rejectedWithdrawal"), tone: "bad" as const } };
                const s = statuses[r.status as keyof typeof statuses] ?? { label: r.status, tone: "warn" as const };
                return (
                  <div key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[14px] font-semibold tabular">{formatBrowseMoney(r.amount, { locale })}</div>
                      <div className="text-[11.5px] text-faint mt-0.5">
                        {formatDate(r.created_at)} · #{r.id}
                      </div>
                      {r.status === "rejected" && r.reject_reason && (
                        <div className="text-[12px] text-muted mt-1">
                          {t("withdrawRejectReason", { reason: r.reject_reason })}
                        </div>
                      )}
                    </div>
                    <Tag tone={s.tone} className="shrink-0">{s.label}</Tag>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
