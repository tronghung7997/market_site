"use client";

/** Rút tiền về ngân hàng (chỉ seller thấy): 3 trường ngân hàng + số tiền +
 *  lịch sử yêu cầu. Validation báo INLINE ngay dưới form thay cho alert()
 *  chặn màn hình như bản cũ. */

import { useState } from "react";
import { api, vnd } from "@/lib/api";
import type { Wallet, WithdrawRequest } from "@/lib/types";
import { Button, Card, Input, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";

const WITHDRAW_LABEL: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral" }> = {
  pending: { label: "Chờ duyệt", tone: "warn" },
  approved: { label: "Đã duyệt — chờ chi", tone: "good" },
  paid: { label: "Đã chi tiền", tone: "good" },
  rejected: { label: "Bị từ chối", tone: "bad" },
};

export function WithdrawCard({ wallet, onChanged }: {
  wallet: Wallet | null;
  onChanged: () => Promise<void>;
}) {
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
    // Validation nói tại chỗ, theo đúng thứ tự người dùng sửa được ngay.
    if (value <= 0) { setErr("Nhập số tiền muốn rút."); return; }
    if (value > available) { setErr("Số dư khả dụng không đủ để rút số tiền này."); return; }
    if (!bankName.trim() || !bankAccountNumber.trim() || !bankAccountHolder.trim()) {
      setErr("Điền đủ ngân hàng, số tài khoản và tên chủ tài khoản nhận tiền.");
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
      setMsg("Đã gửi yêu cầu rút tiền, chờ admin duyệt.");
      await onChanged();
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      setErr(`Gửi yêu cầu rút tiền thất bại: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-line bg-raised/30">
        <h3 className="text-[13px] font-semibold">Rút tiền về ngân hàng</h3>
      </div>
      <div className="p-5 space-y-3">
        {msg && (
          <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">✓ {msg}</div>
        )}
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
            Ngân hàng nhận tiền
          </label>
          <Input
            placeholder="vd Vietcombank"
            value={bankName}
            onChange={(e) => { setBankName(e.target.value); setErr(""); }}
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
            Số tài khoản
          </label>
          <Input
            placeholder="vd 0071000123456"
            value={bankAccountNumber}
            onChange={(e) => { setBankAccountNumber(e.target.value); setErr(""); }}
            disabled={loading}
            className="font-mono tabular"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
            Chủ tài khoản
          </label>
          <Input
            placeholder="Đúng tên in trên thẻ/tài khoản"
            value={bankAccountHolder}
            onChange={(e) => { setBankAccountHolder(e.target.value); setErr(""); }}
            disabled={loading}
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-faint font-medium">Số tiền rút</span>
            <button
              onClick={() => setAmount(String(available))}
              className="text-[11px] text-iris hover:text-iris-hi transition-colors cursor-pointer"
            >
              Rút tối đa {vnd(available)}
            </button>
          </div>
          <MoneyInput
            value={amount}
            onValueChange={(v) => { setAmount(v); setErr(""); }}
            placeholder="Nhập số tiền, vd 500.000"
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
          {loading ? "Đang gửi…" : "Gửi yêu cầu rút tiền"}
        </Button>
        <p className="text-[11px] text-faint">
          Tiền được khoá ngay khi gửi yêu cầu và chuyển về đúng tài khoản trên sau khi quản trị viên duyệt.
        </p>
      </div>
    </Card>
  );
}

export function WithdrawHistory({ withdrawals }: { withdrawals: WithdrawRequest[] }) {
  if (withdrawals.length === 0) return null;
  return (
    <Card className="p-5">
      <h3 className="text-[13px] font-semibold mb-3">Lịch sử yêu cầu rút tiền</h3>
      <div className="space-y-2.5">
        {withdrawals.map((w) => (
          <div key={w.id} className="flex items-center justify-between text-[13px]">
            <div>
              <div className="font-mono font-medium tabular">{vnd(w.amount)}</div>
              <div className="text-[11px] text-faint">
                {new Date(w.created_at).toLocaleDateString("vi-VN")}
              </div>
            </div>
            <Tag tone={WITHDRAW_LABEL[w.status]?.tone ?? "neutral"}>
              {WITHDRAW_LABEL[w.status]?.label ?? w.status}
            </Tag>
          </div>
        ))}
      </div>
    </Card>
  );
}
