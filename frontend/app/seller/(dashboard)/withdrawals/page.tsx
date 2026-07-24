"use client";

import { useCallback, useEffect, useState } from "react";
import { api, vnd, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import type { Wallet, WithdrawRequest } from "@/lib/types";
import { Button, Card, Input, Spinner, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import { Wallet as WalletIcon } from "@/components/Icons";

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" }> = {
  pending: { label: "Chờ duyệt", tone: "warn" },
  approved: { label: "Đã duyệt", tone: "good" },
  rejected: { label: "Bị từ chối", tone: "bad" },
};

const TIER_LABEL: Record<string, string> = {
  new: "Người bán mới",
  verified: "Đã xác minh",
  trusted: "Tin cậy",
  enterprise: "Doanh nghiệp",
};

export default function SellerWithdrawalsPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [reqs, setReqs] = useState<WithdrawRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    const [w, list] = await Promise.all([api.wallet(), api.myWithdrawals()]);
    setWallet(w);
    setReqs(list);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !wallet) return <Spinner label="Đang tải" />;

  const policy = wallet.withdraw_policy;
  const limit = policy?.limit_per_request ?? null;
  const parsed = Number(amount.replace(/\D/g, ""));
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
      setAmount("");
      setOk("Đã gửi yêu cầu. Tiền được khoá lại cho tới khi quản trị viên duyệt.");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không gửi được yêu cầu, thử lại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-[24px] font-semibold tracking-tight">Rút tiền</h1>
        <p className="text-[12.5px] text-muted mt-0.5">
          Tiền được khoá ngay khi bạn gửi yêu cầu, và chuyển đi sau khi quản trị viên duyệt.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr] items-start">
        <div className="space-y-5">
          <Card className="p-5 aura">
            <div className="flex items-center gap-2 text-[11px] text-faint uppercase tracking-wider">
              <WalletIcon size={13} /> Số dư khả dụng
            </div>
            <div className="font-mono text-[30px] font-semibold tabular tracking-tight mt-1">
              {vnd(wallet.available_balance)}
            </div>
            {wallet.locked_balance > 0 && (
              <p className="text-[12px] text-muted mt-2">
                <span className="font-mono tabular text-warn">{vnd(wallet.locked_balance)}</span>{" "}
                đang khoá chờ duyệt — chưa rút thêm phần này được.
              </p>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="text-[13px] font-semibold">Gửi yêu cầu rút</h2>

            <Input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Ngân hàng nhận tiền (vd Vietcombank)"
            />
            <Input
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              placeholder="Số tài khoản"
              className="font-mono tabular"
            />
            <Input
              value={bankAccountHolder}
              onChange={(e) => setBankAccountHolder(e.target.value)}
              placeholder="Chủ tài khoản (đúng tên trên bank)"
            />

            <div>
              <MoneyInput
                value={amount.replace(/\D/g, "")}
                onValueChange={setAmount}
                placeholder="Số tiền muốn rút"
                invalid={overBalance || overLimit}
              />
              <div className="flex items-center justify-between gap-3 mt-1.5">
                <p className="text-[11.5px] text-faint">
                  {policy ? (
                    limit === null ? (
                      <>Cấp {TIER_LABEL[policy.tier] ?? policy.tier} — không giới hạn mỗi lần</>
                    ) : (
                      <>
                        Tối đa <span className="font-mono tabular">{vnd(limit)}</span> mỗi lần
                        {" "}(cấp {TIER_LABEL[policy.tier] ?? policy.tier})
                      </>
                    )
                  ) : null}
                </p>
                {maxOut > 0 && (
                  <button
                    onClick={() => setAmount(String(maxOut))}
                    className="shrink-0 text-[11.5px] text-iris-hi hover:underline cursor-pointer"
                  >
                    Rút tối đa
                  </button>
                )}
              </div>
            </div>

            {overBalance && (
              <p className="text-[12px] text-bad">
                Vượt số dư khả dụng. Nhiều nhất bạn rút được {vnd(wallet.available_balance)}.
              </p>
            )}
            {overLimit && !overBalance && limit !== null && (
              <p className="text-[12px] text-bad">
                Vượt hạn mức mỗi lần của cấp {TIER_LABEL[policy!.tier] ?? policy!.tier}. Chia nhỏ
                thành nhiều lần, mỗi lần tối đa {vnd(limit)}.
              </p>
            )}
            {err && <p className="text-[12px] text-bad">{err}</p>}
            {ok && <p className="text-[12px] text-good">{ok}</p>}

            <Button
              block
              onClick={submit}
              disabled={busy || !valid || overBalance || overLimit || !bankValid}
            >
              {busy ? "Đang gửi…" : "Gửi yêu cầu rút"}
            </Button>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-line bg-raised/30">
            <span className="text-[13px] font-semibold">Yêu cầu đã gửi</span>
          </div>
          {reqs.length === 0 ? (
            <p className="p-8 text-center text-[13px] text-muted">
              Chưa có yêu cầu nào. Số tiền bạn rút sẽ hiện ở đây kèm trạng thái duyệt.
            </p>
          ) : (
            <div className="divide-y divide-line">
              {reqs.map((r) => {
                const s = STATUS[r.status] ?? { label: r.status, tone: "warn" as const };
                return (
                  <div key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[14px] font-semibold tabular">{vnd(r.amount)}</div>
                      <div className="text-[11.5px] text-faint mt-0.5">
                        {formatDate(r.created_at)} · #{r.id}
                      </div>
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
