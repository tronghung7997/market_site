"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { DepositIntent, Transaction, Wallet, WithdrawRequest } from "@/lib/types";
import { Button, Card, Input, Spinner, Tag } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { MoneyInput } from "@/components/MoneyInput";
import { Wallet as WalletIcon } from "@/components/Icons";

/** "còn 12 phút" / "còn 45 giây" — deadline lệnh nạp, tính lại mỗi lần poll. */
function timeLeft(expiresAt: string): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  if (ms < 60_000) return `còn ${Math.ceil(ms / 1000)} giây`;
  return `còn ${Math.ceil(ms / 60_000)} phút`;
}

const LABEL: Record<string, string> = {
  topup: "Nạp tiền", deposit: "Nạp tiền (chuyển khoản)", purchase_release: "Nhận thanh toán", refund: "Hoàn tiền",
  purchase_hold: "Tạm giữ mua hàng", withdraw: "Rút tiền", platform_fee: "Phí nền tảng",
  withdraw_lock: "Khoá tiền chờ duyệt rút", withdraw_unlock: "Huỷ khoá rút tiền",
  affiliate_commission: "Hoa hồng giới thiệu",
  adjustment_credit: "Đối soát số dư", adjustment_debit: "Đối soát số dư",
};
type Tone = "good" | "bad" | "warn" | "iris" | "neutral";
const TONE: Record<string, Tone> = {
  topup: "good", deposit: "good", purchase_release: "good", refund: "good",
  affiliate_commission: "good", withdraw_unlock: "good",
  purchase_hold: "bad", withdraw: "bad", withdraw_lock: "warn",
  platform_fee: "neutral", adjustment_credit: "neutral", adjustment_debit: "neutral",
};

const WITHDRAW_LABEL: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Chờ duyệt", tone: "warn" },
  approved: { label: "Đã duyệt — chờ chi", tone: "good" },
  paid: { label: "Đã chi tiền", tone: "good" },
  rejected: { label: "Bị từ chối", tone: "bad" },
};

const DEPOSIT_LABEL: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Chờ thanh toán", tone: "warn" },
  paid: { label: "Đã nhận tiền", tone: "good" },
  cancelled: { label: "Đã huỷ", tone: "neutral" },
  expired: { label: "Hết hạn", tone: "bad" },
};

// purchase_hold không bao giờ đổi type sau khi tạo — vì đây là bản ghi lịch sử
// bất biến — nên hiển thị dựa trên trạng thái ĐƠN HÀNG hiện tại (order_status,
// backend tra ngược qua reference_id) thay vì tên type tĩnh, tránh nhãn
// "tạm giữ" gây hiểu nhầm mãi mãi kể cả khi đơn đã hoàn tất hoặc bị huỷ.
const HOLD_BY_ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Đang xử lý đơn hàng", tone: "warn" },
  processing: { label: "Đang xử lý đơn hàng", tone: "warn" },
  delivered: { label: "Tạm giữ — chờ bạn xác nhận", tone: "warn" },
  completed: { label: "Đã thanh toán cho người bán", tone: "good" },
  disputed: { label: "Tạm giữ — đang khiếu nại", tone: "warn" },
  refunded: { label: "Đã hoàn tiền", tone: "neutral" },
  cancelled: { label: "Đã hoàn tiền", tone: "neutral" },
};

function describeTransaction(t: Transaction): { label: string; tone: Tone } {
  if (t.type === "purchase_hold" && t.order_status && HOLD_BY_ORDER_STATUS[t.order_status]) {
    return HOLD_BY_ORDER_STATUS[t.order_status];
  }
  return { label: LABEL[t.type] ?? t.type, tone: TONE[t.type] ?? "neutral" };
}

const PRESET_AMOUNTS = [100000, 500000, 1000000, 5000000];

export default function WalletPage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [customAmount, setCustomAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [deposits, setDeposits] = useState<DepositIntent[]>([]);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositMsg, setDepositMsg] = useState("");
  const [depositErr, setDepositErr] = useState("");
  const [walletError, setWalletError] = useState(false);

  const isSeller = account?.roles.includes("seller");

  const refreshWallet = async () => {
    // allSettled từng nguồn: một endpoint phụ lỗi không được kéo sập số dư —
    // Promise.all cũ làm trang hiện "0đ" dù ví có tiền (review 24/07 #5).
    // Nguồn nào lỗi thì GIỮ dữ liệu cũ, chỉ số dư lỗi mới hiện banner.
    const [w, t, d] = await Promise.allSettled([api.wallet(), api.transactions(), api.myDeposits()]);
    if (w.status === "fulfilled") { setWallet(w.value); setWalletError(false); }
    else { setWalletError(true); console.error("Failed to load wallet:", w.reason); }
    if (t.status === "fulfilled") setTxs(t.value);
    if (d.status === "fulfilled") setDeposits(d.value);
    if (account?.roles.includes("seller")) {
      try {
        setWithdrawals(await api.myWithdrawals());
      } catch (err) {
        console.error("Failed to load withdrawals:", err);
      }
    }
  };

  // Đang có lệnh nạp chờ thanh toán → poll để số dư tự nhảy khi webhook về,
  // buyer không phải bấm refresh sau khi quét QR.
  const hasPendingDeposit = deposits.some((d) => d.status === "pending");
  useEffect(() => {
    if (!hasPendingDeposit) return;
    const timer = setInterval(() => { refreshWallet(); }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingDeposit]);

  const handleCreateDeposit = async () => {
    const amount = parseInt(depositAmount) || 0;
    if (amount < 10000) {
      alert("Số tiền nạp tối thiểu 10.000đ");
      return;
    }
    setDepositLoading(true);
    setDepositMsg("");
    setDepositErr("");
    // Mở tab TRƯỚC await, ngay trong user gesture — window.open sau await bị
    // popup blocker chặn nếu PayOS phản hồi chậm (review 24/07 #5).
    const payTab = window.open("about:blank", "_blank");
    try {
      const intent = await api.createDeposit(amount);
      setDepositAmount("");
      setDepositMsg("Đã tạo lệnh nạp — quét mã QR bên dưới, hoặc mở trang thanh toán ở tab vừa bật.");
      if (intent.checkout_url && payTab) payTab.location.href = intent.checkout_url;
      await refreshWallet();
    } catch (err) {
      // KHÔNG đóng tab và KHÔNG bật hộp thoại alert.
      //
      // Trang thanh toán nằm ở domain nhà cung cấp nên máy trong mạng nội bộ
      // mở ra là lỗi mạng — nhưng đó là tab người dùng cần GIỮ LẠI: chỉ việc
      // đổi sang mạng có internet rồi F5 chính tab đó là vào được. Đóng hộ
      // (hoặc chặn màn hình bằng alert) là cướp mất thao tác đó.
      //
      // Lưu ý: JS không đọc được kết quả tải của tab khác origin, nên nhánh
      // này CHỈ chạy khi API tạo lệnh nạp hỏng — báo bằng dòng chữ tại chỗ,
      // để người dùng vẫn thấy và thao tác được với phần còn lại của trang.
      setDepositErr(err instanceof Error ? err.message : "Tạo lệnh nạp thất bại, thử lại sau.");
    } finally {
      setDepositLoading(false);
    }
  };

  const handleCancelDeposit = async (id: number) => {
    try {
      await api.cancelDeposit(id);
      await refreshWallet();
    } catch (err) {
      alert(`Huỷ lệnh nạp thất bại: ${err instanceof Error ? err.message : "Unknown error"}`);
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
    if (amount > (wallet?.available_balance ?? 0)) {
      alert("Số dư không đủ để rút số tiền này");
      return;
    }
    if (!bankName.trim() || !bankAccountNumber.trim() || !bankAccountHolder.trim()) {
      alert("Vui lòng điền đủ thông tin ngân hàng nhận tiền");
      return;
    }
    setWithdrawLoading(true);
    setWithdrawMsg("");
    try {
      await api.requestWithdraw(amount, {
        bank_name: bankName.trim(),
        bank_account_number: bankAccountNumber.trim(),
        bank_account_holder: bankAccountHolder.trim(),
      });
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

          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-line bg-raised/30 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Nạp tiền vào ví</h3>
              <Tag tone="iris">Chuyển khoản QR</Tag>
            </div>
            <div className="p-5 space-y-4">
              {/* Bước 1 — số tiền. Preset điền vào ô để người dùng còn chỉnh,
                  không tạo lệnh ngay: bấm nhầm 5 triệu không thành lệnh treo. */}
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-faint font-medium">Số tiền nạp</span>
                  <span className="text-[11px] text-faint">tối thiểu {vnd(10000)}</span>
                </div>
                <MoneyInput
                  value={depositAmount}
                  onValueChange={setDepositAmount}
                  placeholder="Nhập số tiền, vd 100.000"
                  disabled={depositLoading}
                />
                <div className="flex gap-1.5 mt-2">
                  {PRESET_AMOUNTS.map((amount) => (
                    <button
                      key={amount}
                      onClick={() => setDepositAmount(String(amount))}
                      disabled={depositLoading}
                      className={cn(
                        "flex-1 h-7 rounded-md border text-[11.5px] font-mono tabular transition-colors cursor-pointer",
                        depositAmount === String(amount)
                          ? "border-iris bg-iris-soft text-iris font-semibold"
                          : "border-line bg-surface text-muted hover:border-iris/40 hover:text-fg",
                      )}
                    >
                      {amount >= 1_000_000 ? `${amount / 1_000_000} triệu` : `${amount / 1000}K`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bước 2 — một nút, một việc */}
              <Button
                variant="primary"
                size="md"
                block
                onClick={handleCreateDeposit}
                disabled={depositLoading || !depositAmount || Number(depositAmount) < 10000}
              >
                {depositLoading
                  ? "Đang tạo mã QR…"
                  : depositAmount
                    ? `Tạo mã QR nạp ${vnd(Number(depositAmount))}`
                    : "Tạo mã QR thanh toán"}
              </Button>
              <p className="text-[11.5px] text-faint leading-relaxed">
                Quét mã bằng app ngân hàng bất kỳ. Tiền vào ví <span className="text-fg font-medium">tự động sau vài giây</span> — không cần bấm gì thêm.
              </p>

              {depositMsg && (
                <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">✓ {depositMsg}</div>
              )}
              {depositErr && (
                <div className="p-2.5 rounded-lg bg-bad-soft text-bad text-[12px]">{depositErr}</div>
              )}

              {/* Bước 3 — lệnh đang chờ: phần tử sống của cả flow */}
              {deposits.filter((d) => d.status === "pending").map((d) => {
                const remaining = timeLeft(d.expires_at);
                return (
                  <div key={d.id} className="rounded-lg border border-iris/30 bg-iris-soft/40 overflow-hidden">
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-mono text-[17px] font-semibold tabular leading-tight">{vnd(d.amount)}</div>
                        <div className="text-[11px] text-muted mt-0.5">
                          {remaining ? `Đang chờ thanh toán · ${remaining}` : "Sắp hết hạn…"}
                        </div>
                      </div>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-iris opacity-60" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-iris" />
                      </span>
                    </div>
                    {/* QR ngay tại chỗ — nguồn ảnh là data URI backend dựng,
                        không phải link ngoài, nên máy không ra được internet
                        vẫn quét được bằng app ngân hàng trên điện thoại. */}
                    {d.qr_svg && (
                      <div className="px-4 pb-3 flex flex-col items-center gap-2">
                        <img
                          src={d.qr_svg}
                          alt={`Mã QR chuyển khoản ${vnd(d.amount)}`}
                          width={168}
                          height={168}
                          className="rounded-lg bg-white p-2 border border-line"
                        />
                        <p className="text-[12px] text-muted text-center leading-relaxed">
                          Mở app ngân hàng, quét mã này và chuyển đúng{" "}
                          <span className="font-medium text-ink">{vnd(d.amount)}</span>.
                          <br />
                          Giữ nguyên nội dung chuyển khoản.
                        </p>
                      </div>
                    )}
                    <div className="px-4 pb-3 flex items-center gap-2">
                      {/* Link CỐ ĐỊNH theo lệnh nạp: tab mở lúc tạo lệnh có
                          thể lỗi mạng (trang thanh toán nằm ngoài internet),
                          nên luôn để sẵn đường mở lại — không phải tạo lệnh
                          mới chỉ vì lỡ đóng tab. */}
                      {d.checkout_url && (
                        <a href={d.checkout_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                          <Button variant="secondary" size="sm" block>Mở trang thanh toán ↗</Button>
                        </a>
                      )}
                      <button
                        onClick={() => handleCancelDeposit(d.id)}
                        className="text-[12px] text-faint hover:text-bad transition-colors cursor-pointer px-2 h-8"
                      >
                        Huỷ
                      </button>
                    </div>
                  </div>
                );
              })}

              {deposits.filter((d) => d.status !== "pending").length > 0 && (
                <div className="pt-1 space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wider text-faint font-medium">Lệnh gần đây</div>
                  {deposits.filter((d) => d.status !== "pending").slice(0, 3).map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-[12.5px]">
                      <span className="font-mono tabular">{vnd(d.paid_amount ?? d.amount)}</span>
                      <Tag tone={DEPOSIT_LABEL[d.status]?.tone ?? "neutral"}>
                        {DEPOSIT_LABEL[d.status]?.label ?? d.status}
                      </Tag>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Nạp demo dev-only: giấu sau disclosure cho trang bớt nhiễu;
              backend trả 403 khi ENABLE_DEMO_TOPUP tắt (prod). */}
          <details className="group">
            <summary className="cursor-pointer text-[12px] text-faint hover:text-muted transition-colors list-none flex items-center gap-1.5 px-1">
              <span className="inline-block transition-transform group-open:rotate-90">▸</span>
              Nạp nhanh cho môi trường dev
            </summary>
            <Card className="p-4 mt-2 border-dashed">
              {successMsg && (
                <div className="p-2.5 mb-2 rounded-lg bg-good-soft text-good text-[12px]">✓ {successMsg}</div>
              )}
              <div className="flex gap-2">
                <MoneyInput
                  value={customAmount}
                  onValueChange={setCustomAmount}
                  placeholder="Số tiền demo"
                  disabled={topupLoading}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => handleTopup(parseInt(customAmount) || 0)}
                  disabled={topupLoading || !customAmount}
                >
                  {topupLoading ? "…" : "Nạp"}
                </Button>
              </div>
              <p className="text-[11px] text-faint mt-2">Chỉ hoạt động ở môi trường dev — production sẽ bị từ chối.</p>
            </Card>
          </details>

          {isSeller && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-line bg-raised/30">
                <h3 className="text-[13px] font-semibold">Rút tiền về ngân hàng</h3>
              </div>
              <div className="p-5 space-y-3">
                {withdrawMsg && (
                  <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">
                    ✓ {withdrawMsg}
                  </div>
                )}
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
                    Ngân hàng nhận tiền
                  </label>
                  <Input
                    placeholder="vd Vietcombank"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    disabled={withdrawLoading}
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
                    Số tài khoản
                  </label>
                  <Input
                    placeholder="vd 0071000123456"
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    disabled={withdrawLoading}
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
                    onChange={(e) => setBankAccountHolder(e.target.value)}
                    disabled={withdrawLoading}
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-faint font-medium">Số tiền rút</span>
                    <button
                      onClick={() => setWithdrawAmount(String(wallet?.available_balance ?? 0))}
                      className="text-[11px] text-iris hover:text-iris-hi transition-colors cursor-pointer"
                    >
                      Rút tối đa {vnd(wallet?.available_balance ?? 0)}
                    </button>
                  </div>
                  <MoneyInput
                    value={withdrawAmount}
                    onValueChange={setWithdrawAmount}
                    placeholder="Nhập số tiền, vd 500.000"
                    disabled={withdrawLoading}
                    invalid={!!withdrawAmount && Number(withdrawAmount) > (wallet?.available_balance ?? 0)}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="md"
                  block
                  onClick={handleWithdraw}
                  disabled={withdrawLoading || !withdrawAmount}
                >
                  {withdrawLoading ? "Đang gửi…" : "Gửi yêu cầu rút tiền"}
                </Button>
                <p className="text-[11px] text-faint">
                  Tiền được khoá ngay khi gửi yêu cầu và chuyển về đúng tài khoản trên sau khi quản trị viên duyệt.
                </p>
              </div>
            </Card>
          )}

          {isSeller && withdrawals.length > 0 && (
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
                  +{vnd(txs.filter((t) => t.direction === "in").reduce((s, t) => s + t.amount, 0))}
                </div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-faint">Tổng tiền ra</div>
                <div className="font-mono text-[16px] font-semibold text-bad tabular mt-0.5">
                  −{vnd(txs.filter((t) => t.direction === "out").reduce((s, t) => s + t.amount, 0))}
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
                  // `neutral` (rút tiền đã duyệt) không đổi số dư khả dụng — tiền
                  // đã rời ví từ lúc khoá. Vẽ dấu − cho nó là đếm hai lần bằng mắt.
                  const sign = t.direction === "in" ? "+" : t.direction === "out" ? "−" : "•";
                  const date = new Date(t.created_at);
                  const description = t.description ?? LABEL[t.type] ?? t.type;
                  const status = describeTransaction(t);
                  return (
                    <div key={t.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div className={cn(
                        "grid place-items-center h-9 w-9 shrink-0 rounded-lg text-[13px] font-bold",
                        t.direction === "in" ? "bg-good-soft text-good"
                          : t.direction === "out" ? "bg-bad-soft text-bad"
                          : "bg-raised text-faint",
                      )}>
                        {sign}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Tooltip text={description}>
                            <span className="min-w-0 text-[13px] font-medium truncate cursor-default">
                              {description}
                            </span>
                          </Tooltip>
                          <Tag tone={status.tone} className="shrink-0">{status.label}</Tag>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11.5px] text-faint">
                          <span>{date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                          <span>{date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                          {t.reference_id && <span className="font-mono">Ref: {t.reference_id}</span>}
                        </div>
                      </div>
                      <span className={cn(
                        "font-mono text-[14px] font-semibold tabular shrink-0 w-[112px] text-right",
                        t.direction === "in" ? "text-good" : t.direction === "out" ? "text-bad" : "text-faint",
                      )}>
                        {t.direction === "neutral" ? "" : sign}{vnd(t.amount)}
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
