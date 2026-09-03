"use client";

import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { queryKeys } from "@/lib/query-keys";
import { useWalletBalance, useWalletDeposits, useWalletTransactions, useWalletWithdrawals } from "@/hooks/use-wallet";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import { Wallet as WalletIcon } from "@/components/Icons";
import DepositCard from "./DepositCard";
import TransactionList from "./TransactionList";
import { WithdrawCard, WithdrawHistory } from "./WithdrawCard";

export default function WalletPage() {
  const t = useTranslations("wallet");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isSeller = !!account?.roles.includes("seller");
  const ready = !authLoading && !!account;

  const balanceQ = useWalletBalance(ready);
  const txQ = useWalletTransactions(ready);
  const depositsQ = useWalletDeposits(ready);
  const withdrawalsQ = useWalletWithdrawals(ready && isSeller);

  const wallet = balanceQ.data ?? null;
  const txs = txQ.data ?? [];
  const deposits = depositsQ.data ?? [];
  const withdrawals = withdrawalsQ.data ?? [];
  const walletError = balanceQ.isError;

  const onChanged = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.wallet() });
  };

  const hasPendingDeposit = deposits.some((d) => d.status === "pending");
  useEffect(() => {
    if (!hasPendingDeposit) return;
    const timer = setInterval(() => { queryClient.invalidateQueries({ queryKey: queryKeys.wallet() }); }, 5000);
    return () => clearInterval(timer);
  }, [hasPendingDeposit, queryClient]);

  useEffect(() => {
    if (authLoading) return;
    if (!account) router.push("/login");
  }, [account, authLoading, router]);

  if (authLoading || balanceQ.isPending || txQ.isPending) return <div className="w-full mx-auto max-w-[1200px] px-6 py-16"><Spinner /></div>;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        <div className="space-y-5">
          <Card className="aura p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <WalletIcon size={15} /> {t("available")}
              </div>
              <Tag tone="good">{t("active")}</Tag>
            </div>
            {walletError ? (
              <div>
                <div className="font-mono text-[36px] font-semibold tabular leading-none text-faint">—</div>
                <p className="mt-2 text-[12px] text-bad">{t("balanceLoadError")}</p>
              </div>
            ) : (
              <div className="font-mono text-[36px] font-semibold tabular leading-none">
                {formatBrowseMoney(wallet?.available_balance ?? 0, { locale })}
              </div>
            )}
            {(wallet?.locked_balance ?? 0) > 0 && (
              <p className="mt-2 text-[12px] text-faint">
                {t("locked", { amount: formatBrowseMoney(wallet!.locked_balance, { locale }) })}
              </p>
            )}
          </Card>

          <DepositCard deposits={deposits} onChanged={onChanged} />
          {process.env.NEXT_PUBLIC_ENABLE_DEMO_TOPUP === "true" && <DemoTopup onChanged={onChanged} />}
          {isSeller && <WithdrawCard wallet={wallet} onChanged={onChanged} />}
          {isSeller && <WithdrawHistory withdrawals={withdrawals} />}
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold">{t("txTitle")}</span>
            <Button variant="ghost" size="sm" onClick={() => router.push("/transactions")}>{t("txViewAll")}</Button>
          </div>
          <TransactionList txs={txs.slice(0, 6)} showHeader={false} />
        </div>
      </div>
    </div>
  );
}

function DemoTopup({ onChanged }: { onChanged: () => Promise<void> }) {
  const t = useTranslations("wallet");
  const apiErrorMessage = useApiErrorMessage();
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const handleTopup = async () => {
    const value = parseInt(amount) || 0;
    if (value <= 0) { setErr(t("demoErrAmount")); return; }
    setLoading(true);
    setMsg("");
    setErr("");
    try {
      await api.demoTopup(value);
      setAmount("");
      setMsg(t("demoSuccess", { amount: formatLedgerMoney(value, locale) }));
      await onChanged();
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setErr(t("demoFail", { error: apiErrorMessage(e, "—") }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <details className="group">
      <summary className="cursor-pointer text-[12px] text-faint hover:text-muted transition-colors list-none flex items-center gap-1.5 px-1">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>
        {t("demoTitle")}
      </summary>
      <Card className="p-4 mt-2 border-dashed">
        {msg && (
          <div className="p-2.5 mb-2 rounded-lg bg-good-soft text-good text-[12px]">✓ {msg}</div>
        )}
        {err && (
          <div className="p-2.5 mb-2 rounded-lg bg-bad-soft text-bad text-[12px]">{err}</div>
        )}
        <div className="flex gap-2">
          <MoneyInput
            value={amount}
            onValueChange={(v) => { setAmount(v); setErr(""); }}
            placeholder={t("demoPlaceholder")}
            disabled={loading}
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="md"
            onClick={handleTopup}
            disabled={loading || !amount}
          >
            {loading ? "…" : t("demoTopup")}
          </Button>
        </div>
        <p className="text-[11px] text-faint mt-2">{t("demoHint")}</p>
      </Card>
    </details>
  );
}
