"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { queryKeys } from "@/lib/query-keys";
import { useWalletBalance, useWalletDeposits, useWalletTransactions, useWalletWithdrawals } from "@/hooks/use-wallet";
import { Banner, Button, Card, Spinner, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import { ArrowRight, Info, Wallet as WalletIcon } from "@/components/Icons";
import DepositCard from "./DepositCard";
import TransactionList from "./TransactionList";
import { WithdrawCard, WithdrawHistory } from "./WithdrawCard";
import { DepositHistory, TopUpGuide } from "./WalletGuide";
import { needsDepositCheck } from "./deposit-history";

/** Top-up history: the latest 20, then up to 100 on request (the API cap). */
const DEPOSIT_PAGE = 20;
const DEPOSIT_MAX = 100;

/** `?amount=` from the checkout shortfall link (ledger VND, positive integer). */
function prefillAmount(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `?return=` must be a local path: never an absolute or protocol-relative URL. */
function localReturnPath(raw: string | null): string | null {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

export default function WalletPage() {
  // useSearchParams (checkout prefill/return link) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="w-full mx-auto max-w-[1200px] px-6 py-16"><Spinner /></div>}>
      <WalletPageInner />
    </Suspense>
  );
}

function WalletPageInner() {
  const t = useTranslations("wallet");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isSeller = !!account?.roles.includes("seller");
  const searchParams = useSearchParams();
  const prefill = prefillAmount(searchParams.get("amount"));
  const returnPath = localReturnPath(searchParams.get("return"));
  const ready = !authLoading && !!account;

  const balanceQ = useWalletBalance(ready);
  const txQ = useWalletTransactions(ready);
  const [depositLimit, setDepositLimit] = useState(DEPOSIT_PAGE);
  const depositsQ = useWalletDeposits(ready, depositLimit);
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
  // The newest request worth a credit check, to prefill the support message.
  const checkable = deposits.find((d) => needsDepositCheck(d, Date.now()));
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
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-8 sm:py-10">
      {returnPath && (
        <Banner
          tone="iris"
          icon={<Info size={15} />}
          title={t("returnTitle")}
          className="mb-5"
          action={
            <Link href={returnPath} className="inline-flex items-center gap-1 text-[12.5px] font-medium underline underline-offset-2">
              {t("returnAction")} <ArrowRight size={13} />
            </Link>
          }
        >
          <span className="text-fg/80">{t("returnBody")}</span>
        </Banner>
      )}
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
            {(wallet?.pending_deposits ?? 0) > 0 && (
              <p className="mt-2 text-[12px] text-iris-hi">
                {t("pendingCredit", { amount: formatBrowseMoney(wallet!.pending_deposits!, { locale }) })}
              </p>
            )}
            {(wallet?.locked_balance ?? 0) > 0 && (
              <p className="mt-2 text-[12px] text-faint">
                {t("locked", { amount: formatBrowseMoney(wallet!.locked_balance, { locale }) })}
              </p>
            )}
            {(wallet?.escrow_paid ?? 0) > 0 && (
              <p className="mt-1 text-[12px] text-faint">
                {t("escrowPaid", { amount: formatBrowseMoney(wallet!.escrow_paid, { locale }) })}
              </p>
            )}
            {isSeller && (wallet?.escrow_incoming ?? 0) > 0 && (
              <p className="mt-1 text-[12px] text-faint">
                {t("escrowIncoming", { amount: formatBrowseMoney(wallet!.escrow_incoming, { locale }) })}
              </p>
            )}
          </Card>

          <DepositCard deposits={deposits} onChanged={onChanged} prefillVnd={prefill} />
          {process.env.NEXT_PUBLIC_ENABLE_DEMO_TOPUP === "true" && <DemoTopup onChanged={onChanged} />}
          {isSeller && <WithdrawCard wallet={wallet} onChanged={onChanged} />}
          {isSeller && <WithdrawHistory withdrawals={withdrawals} />}
        </div>

        <div className="min-w-0 space-y-6">
          <TopUpGuide checkable={checkable} />
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-semibold">{t("txTitle")}</span>
              <Button variant="ghost" size="sm" onClick={() => router.push("/transactions")}>{t("txViewAll")}</Button>
            </div>
            <TransactionList txs={txs.slice(0, 6)} showHeader={false} />
          </div>
          <DepositHistory
            deposits={deposits}
            loading={depositsQ.isPending}
            error={depositsQ.isError}
            canLoadMore={deposits.length >= depositLimit && depositLimit < DEPOSIT_MAX}
            onLoadMore={() => setDepositLimit(DEPOSIT_MAX)}
            loadingMore={depositsQ.isFetching && deposits.length < depositLimit}
          />
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
