"use client";

/** Lịch sử giao dịch ví: 2 ô tổng vào/ra + danh sách từng dòng.
 *  describeTransaction là nguồn sự thật cho nhãn/tông của một giao dịch —
 *  riêng purchase_hold hiển thị theo trạng thái ĐƠN hiện tại (xem comment). */

import { vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Transaction } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";

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

export default function TransactionList({ txs }: { txs: Transaction[] }) {
  return (
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
  );
}
