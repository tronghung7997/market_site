"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Transaction, Wallet } from "@/lib/types";
import { Button, Card, Input, Spinner, Tag } from "@/components/ui";
import { Wallet as WalletIcon } from "@/components/Icons";

const CREDIT = new Set(["topup", "purchase_release", "refund"]);
const LABEL: Record<string, string> = {
  topup: "Nạp tiền", purchase_release: "Nhận thanh toán", refund: "Hoàn tiền",
  purchase_hold: "Tạm giữ mua hàng", withdraw: "Rút tiền", platform_fee: "Phí nền tảng",
};
const TONE: Record<string, "good" | "bad" | "neutral"> = {
  topup: "good", purchase_release: "good", refund: "good",
  purchase_hold: "bad", withdraw: "bad", platform_fee: "neutral",
};

const PRESET_AMOUNTS = [100000, 500000, 1000000, 5000000];

export default function WalletPage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [customAmount, setCustomAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState("");

  const isSeller = account?.roles.includes("seller");

  const refreshWallet = async () => {
    try {
      const [w, t] = await Promise.all([api.wallet(), api.transactions()]);
      setWallet(w); setTxs(t);
    } catch (err) {
      console.error("Failed to refresh wallet:", err);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!account) { router.push("/login"); return; }
    (async () => {
      try {
        await refreshWallet();
      } finally { setLoading(false); }
    })();
  }, [account, authLoading, router]);

  const handleTopup = async (amount: number) => {
    if (amount <= 0) {
      alert("Vui lòng nhập số tiền hợp lệ");
      return;
    }
    setTopupLoading(true);
    setSuccessMsg("");
    try {
      await api.demoTopup(amount);
      setCustomAmount("");
      setSuccessMsg(`Nạp tiền ${vnd(amount)} thành công!`);
      await refreshWallet();
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      alert(`Nạp tiền thất bại: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setTopupLoading(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseInt(withdrawAmount) || 0;
    if (amount <= 0) {
      alert("Vui lòng nhập số tiền hợp lệ");
      return;
    }
    if (amount > (wallet?.balance ?? 0)) {
      alert("Số dư không đủ để rút số tiền này");
      return;
    }
    setWithdrawLoading(true);
    setWithdrawMsg("");
    try {
      await api.requestWithdraw(amount);
      setWithdrawAmount("");
      setWithdrawMsg("Đã gửi yêu cầu rút tiền, chờ admin duyệt.");
      await refreshWallet();
      setTimeout(() => setWithdrawMsg(""), 4000);
    } catch (err) {
      alert(`Gửi yêu cầu rút tiền thất bại: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setWithdrawLoading(false);
    }
  };

  if (authLoading || loading) return <div className="w-full mx-auto max-w-[1200px] px-6 py-16"><Spinner /></div>;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        {/* ─── Left: balance + topup ─── */}
        <div className="space-y-5">
          <Card className="aura p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <WalletIcon size={15} /> Số dư khả dụng
              </div>
              <Tag tone="good">● Hoạt động</Tag>
            </div>
            <div className="font-mono text-[36px] font-semibold tabular leading-none">{vnd(wallet?.balance ?? 0)}</div>
          </Card>

          <Card className="p-5">
            <h3 className="text-[13px] font-semibold mb-3">Nạp tiền</h3>
            <div className="space-y-3">
              {successMsg && (
                <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">
                  ✓ {successMsg}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {PRESET_AMOUNTS.map((amount) => (
                  <Button
                    key={amount}
                    variant="secondary"
                    size="sm"
                    block
                    onClick={() => handleTopup(amount)}
                    disabled={topupLoading}
                    className="text-xs"
                  >
                    {(amount / 1000).toLocaleString("vi-VN")}K
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Số tiền tuỳ chỉnh"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  disabled={topupLoading}
                  min="1"
                />
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => handleTopup(parseInt(customAmount) || 0)}
                  disabled={topupLoading || !customAmount}
                >
                  {topupLoading ? "…" : "Nạp"}
                </Button>
              </div>
              <p className="text-[11px] text-faint">
                Tối thiểu 1.000đ, không giới hạn tối đa
              </p>
            </div>
          </Card>

          {isSeller && (
            <Card className="p-5">
              <h3 className="text-[13px] font-semibold mb-3">Rút tiền</h3>
              <div className="space-y-3">
                {withdrawMsg && (
                  <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">
                    ✓ {withdrawMsg}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Số tiền muốn rút"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    disabled={withdrawLoading}
                    min="1"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={handleWithdraw}
                    disabled={withdrawLoading || !withdrawAmount}
                  >
                    {withdrawLoading ? "…" : "Rút"}
                  </Button>
                </div>
                <p className="text-[11px] text-faint">
                  Yêu cầu sẽ chờ admin duyệt trước khi tiền được trừ khỏi ví.
                </p>
              </div>
            </Card>
          )}
        </div>

        {/* ─── Right: transaction history ─── */}
        <div className="min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold">Lịch sử giao dịch</h3>
            <span className="text-[12px] text-muted">{txs.length} giao dịch</span>
          </div>

          {txs.length > 0 && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Card className="p-3.5">
                <div className="text-[11px] text-faint">Tổng tiền vào</div>
                <div className="font-mono text-[16px] font-semibold text-good tabular mt-0.5">
                  +{vnd(txs.filter((t) => CREDIT.has(t.type)).reduce((s, t) => s + t.amount, 0))}
                </div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-faint">Tổng tiền ra</div>
                <div className="font-mono text-[16px] font-semibold text-bad tabular mt-0.5">
                  −{vnd(txs.filter((t) => !CREDIT.has(t.type)).reduce((s, t) => s + t.amount, 0))}
                </div>
              </Card>
            </div>
          )}
          <Card className="overflow-hidden">
            {txs.length === 0 ? (
              <p className="p-6 text-[13px] text-muted">Chưa có giao dịch nào.</p>
            ) : (
              <div className="divide-y divide-line">
                {txs.map((t) => {
                  const isCredit = CREDIT.has(t.type);
                  const date = new Date(t.created_at);
                  return (
                    <div key={t.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div className={cn(
                        "grid place-items-center h-9 w-9 shrink-0 rounded-lg text-[13px] font-bold",
                        isCredit ? "bg-good-soft text-good" : "bg-bad-soft text-bad",
                      )}>
                        {isCredit ? "+" : "−"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium truncate">{t.description ?? LABEL[t.type] ?? t.type}</span>
                          <Tag tone={TONE[t.type] ?? "neutral"}>{LABEL[t.type] ?? t.type}</Tag>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11.5px] text-faint">
                          <span>{date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                          <span>{date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                          {t.reference_id && <span className="font-mono">Ref: {t.reference_id}</span>}
                        </div>
                      </div>
                      <span className={cn("font-mono text-[14px] font-semibold tabular shrink-0", isCredit ? "text-good" : "text-bad")}>
                        {isCredit ? "+" : "−"}{vnd(t.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
