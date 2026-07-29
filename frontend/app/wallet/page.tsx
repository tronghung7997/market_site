"use client";

/** Trang Ví — MỤC LỤC; dữ liệu chạy trên react-query (cache chung với TopNav):
 *
 *  - Số dư:      card đầu cột trái (kèm trạng thái lỗi riêng, không sập cả trang)
 *  - Nạp QR:     DepositCard (tạo/huỷ lệnh, đếm ngược, mở lại trang thanh toán)
 *  - Nạp demo:   DemoTopup (dev-only, giấu sau disclosure)
 *  - Rút tiền:   WithdrawCard + WithdrawHistory (chỉ seller)
 *  - Lịch sử:    TransactionList
 *
 *  Không có alert() nào — mọi lỗi/validation hiện inline tại chỗ nó xảy ra. */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { queryKeys } from "@/lib/query-keys";
import { useWalletBalance, useWalletDeposits, useWalletTransactions, useWalletWithdrawals } from "@/hooks/use-wallet";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import { Wallet as WalletIcon } from "@/components/Icons";
import DepositCard from "./DepositCard";
import TransactionList from "./TransactionList";
import { WithdrawCard, WithdrawHistory } from "./WithdrawCard";

export default function WalletPage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isSeller = !!account?.roles.includes("seller");
  const ready = !authLoading && !!account;

  // Bốn nguồn = bốn query độc lập — một endpoint phụ lỗi không kéo sập số dư
  // (đúng tinh thần Promise.allSettled cũ, react-query còn tự GIỮ data cũ khi
  // refetch lỗi). Cache dùng chung với TopNav: nơi nào invalidate ["wallet"]
  // là số dư ở đây lẫn trên nav cùng nhảy.
  const balanceQ = useWalletBalance(ready);
  const txQ = useWalletTransactions(ready);
  const depositsQ = useWalletDeposits(ready);
  const withdrawalsQ = useWalletWithdrawals(ready && isSeller);

  const wallet = balanceQ.data ?? null;
  const txs = txQ.data ?? [];
  const deposits = depositsQ.data ?? [];
  const withdrawals = withdrawalsQ.data ?? [];
  const walletError = balanceQ.isError;

  // Con cái (nạp/rút/demo) chỉ cần hô "tiền vừa đổi" — làm mới cả cụm ví.
  const onChanged = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.wallet() });
  };

  // Đang có lệnh nạp chờ thanh toán → poll cả cụm ví mỗi 5s để số dư tự nhảy
  // khi webhook về, buyer không phải bấm refresh sau khi quét QR.
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
        {/* ─── Cột trái: số dư + nạp + rút ─── */}
        <div className="space-y-5">
          <Card className="aura p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <WalletIcon size={15} /> Số dư khả dụng
              </div>
              <Tag tone="good">● Hoạt động</Tag>
            </div>
            {walletError ? (
              <div>
                <div className="font-mono text-[36px] font-semibold tabular leading-none text-faint">—</div>
                <p className="mt-2 text-[12px] text-bad">
                  Không tải được số dư — thử tải lại trang. Số dư của bạn không bị ảnh hưởng.
                </p>
              </div>
            ) : (
              <div className="font-mono text-[36px] font-semibold tabular leading-none">{vnd(wallet?.available_balance ?? 0)}</div>
            )}
            {(wallet?.locked_balance ?? 0) > 0 && (
              <p className="mt-2 text-[12px] text-faint">
                Đang khoá (chờ duyệt rút tiền): <span className="font-mono">{vnd(wallet!.locked_balance)}</span>
              </p>
            )}
          </Card>

          <DepositCard deposits={deposits} onChanged={onChanged} />

          <DemoTopup onChanged={onChanged} />

          {isSeller && <WithdrawCard wallet={wallet} onChanged={onChanged} />}
          {isSeller && <WithdrawHistory withdrawals={withdrawals} />}
        </div>

        {/* ─── Cột phải: lịch sử giao dịch ─── */}
        <TransactionList txs={txs} />
      </div>
    </div>
  );
}

/** Nạp demo dev-only: giấu sau disclosure cho trang bớt nhiễu; backend trả
 *  403 khi ENABLE_DEMO_TOPUP tắt (prod) — lỗi hiện inline, không alert. */
function DemoTopup({ onChanged }: { onChanged: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const handleTopup = async () => {
    const value = parseInt(amount) || 0;
    if (value <= 0) { setErr("Nhập số tiền demo hợp lệ."); return; }
    setLoading(true);
    setMsg("");
    setErr("");
    try {
      await api.demoTopup(value);
      setAmount("");
      setMsg(`Nạp tiền ${vnd(value)} thành công!`);
      await onChanged();
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setErr(`Nạp tiền thất bại: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <details className="group">
      <summary className="cursor-pointer text-[12px] text-faint hover:text-muted transition-colors list-none flex items-center gap-1.5 px-1">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>
        Nạp nhanh cho môi trường dev
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
            placeholder="Số tiền demo"
            disabled={loading}
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="md"
            onClick={handleTopup}
            disabled={loading || !amount}
          >
            {loading ? "…" : "Nạp"}
          </Button>
        </div>
        <p className="text-[11px] text-faint mt-2">Chỉ hoạt động ở môi trường dev — production sẽ bị từ chối.</p>
      </Card>
    </details>
  );
}
