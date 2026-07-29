"use client";

/** Nạp tiền qua QR: nhập tiền (preset điền vào ô, không tạo lệnh ngay) →
 *  một nút tạo lệnh → khối lệnh đang chờ (đếm ngược, mở lại trang thanh toán,
 *  huỷ) → vài lệnh gần nhất. Mọi lỗi báo INLINE tại chỗ — tuyệt đối không
 *  alert() chặn màn hình (xem comment trong handleCreate về tab thanh toán). */

import { useState } from "react";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { timeLeftFine } from "@/lib/time";
import type { DepositIntent } from "@/lib/types";
import { Button, Card, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";

const PRESET_AMOUNTS = [100000, 500000, 1000000, 5000000];
const MIN_DEPOSIT = 10000;

const DEPOSIT_LABEL: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral" }> = {
  pending: { label: "Chờ thanh toán", tone: "warn" },
  paid: { label: "Đã nhận tiền", tone: "good" },
  cancelled: { label: "Đã huỷ", tone: "neutral" },
  expired: { label: "Hết hạn", tone: "bad" },
};

export default function DepositCard({ deposits, onChanged }: {
  deposits: DepositIntent[];
  /** Gọi lại sau khi tạo/huỷ lệnh để page tải lại ví + danh sách lệnh. */
  onChanged: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const handleCreate = async () => {
    const value = parseInt(amount) || 0;
    if (value < MIN_DEPOSIT) {
      setErr(`Số tiền nạp tối thiểu ${vnd(MIN_DEPOSIT)}.`);
      return;
    }
    setLoading(true);
    setMsg("");
    setErr("");
    // Mở tab TRƯỚC await, ngay trong user gesture — window.open sau await bị
    // popup blocker chặn nếu PayOS phản hồi chậm (review 24/07 #5).
    const payTab = window.open("about:blank", "_blank");
    try {
      const intent = await api.createDeposit(value);
      setAmount("");
      setMsg("Đã tạo lệnh nạp — quét QR ở tab trang thanh toán vừa mở.");
      if (intent.checkout_url && payTab) payTab.location.href = intent.checkout_url;
      await onChanged();
    } catch (e) {
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
      setErr(e instanceof Error ? e.message : "Tạo lệnh nạp thất bại, thử lại sau.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: number) => {
    setErr("");
    try {
      await api.cancelDeposit(id);
      await onChanged();
    } catch (e) {
      setErr(`Huỷ lệnh nạp thất bại: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
    }
  };

  const pending = deposits.filter((d) => d.status === "pending");
  const recent = deposits.filter((d) => d.status !== "pending").slice(0, 3);

  return (
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
            <span className="text-[11px] text-faint">tối thiểu {vnd(MIN_DEPOSIT)}</span>
          </div>
          <MoneyInput
            value={amount}
            onValueChange={(v) => { setAmount(v); setErr(""); }}
            placeholder="Nhập số tiền, vd 100.000"
            disabled={loading}
          />
          <div className="flex gap-1.5 mt-2">
            {PRESET_AMOUNTS.map((preset) => (
              <button
                key={preset}
                onClick={() => setAmount(String(preset))}
                disabled={loading}
                className={cn(
                  "flex-1 h-7 rounded-md border text-[11.5px] font-mono tabular transition-colors cursor-pointer",
                  amount === String(preset)
                    ? "border-iris bg-iris-soft text-iris font-semibold"
                    : "border-line bg-surface text-muted hover:border-iris/40 hover:text-fg",
                )}
              >
                {preset >= 1_000_000 ? `${preset / 1_000_000} triệu` : `${preset / 1000}K`}
              </button>
            ))}
          </div>
        </div>

        {/* Bước 2 — một nút, một việc */}
        <Button
          variant="primary"
          size="md"
          block
          onClick={handleCreate}
          disabled={loading || !amount || Number(amount) < MIN_DEPOSIT}
        >
          {loading
            ? "Đang tạo mã QR…"
            : amount
              ? `Tạo mã QR nạp ${vnd(Number(amount))}`
              : "Tạo mã QR thanh toán"}
        </Button>
        <p className="text-[11.5px] text-faint leading-relaxed">
          Quét mã bằng app ngân hàng bất kỳ. Tiền vào ví <span className="text-fg font-medium">tự động sau vài giây</span> — không cần bấm gì thêm.
        </p>

        {msg && (
          <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">✓ {msg}</div>
        )}
        {err && (
          <div className="p-2.5 rounded-lg bg-bad-soft text-bad text-[12px]">{err}</div>
        )}

        {/* Bước 3 — lệnh đang chờ: phần tử sống của cả flow */}
        {pending.map((d) => {
          const remaining = timeLeftFine(d.expires_at);
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
                  onClick={() => handleCancel(d.id)}
                  className="text-[12px] text-faint hover:text-bad transition-colors cursor-pointer px-2 h-8"
                >
                  Huỷ
                </button>
              </div>
            </div>
          );
        })}

        {recent.length > 0 && (
          <div className="pt-1 space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-faint font-medium">Lệnh gần đây</div>
            {recent.map((d) => (
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
  );
}
