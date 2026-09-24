import type { AdminOrderActionKey, AdminOrderCase } from "@/lib/types";

export const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xử lý",
  processing: "Đang xử lý",
  delivered: "Đã giao · giữ ký quỹ",
  completed: "Hoàn tất",
  disputed: "Khiếu nại",
  refunded: "Đã hoàn tiền",
  cancelled: "Đã huỷ",
};

export const ESCROW_LABEL: Record<string, string> = {
  held: "Đang giữ ký quỹ",
  released: "Đã giải ngân cho người bán",
  refunded: "Đã hoàn cho người mua",
  awaiting_delivery: "Chờ giao hàng",
  settled: "Đã quyết toán",
};

export interface Step {
  key: string;
  label: string;
  at: string | null;
  state: "done" | "current" | "todo" | "failed";
}

/** The order's lifecycle as a stepper: placed → delivered → escrow → closed.
 *  Timestamps come from the ledger and system events, not guesses. */
export function lifecycle(c: AdminOrderCase): Step[] {
  const st = c.order_status;
  const eventAt = (...names: string[]) =>
    c.events.find((e) => names.includes(String((e.metadata ?? {}).event)))?.created_at ?? null;
  const releasedAt = c.ledger.find((r) => r.type === "purchase_release" || r.type === "platform_fee")?.created_at ?? null;
  const refundedAt = c.ledger.find((r) => r.type === "refund")?.created_at ?? null;
  const delivered = ["delivered", "completed", "disputed", "refunded"].includes(st) && !(st === "refunded" && !eventAt("resources_assigned", "order_delivered", "order_provisioned"));
  const closedFailed = st === "cancelled" || st === "refunded";
  const steps: Step[] = [
    { key: "placed", label: "Đặt & thanh toán", at: c.created_at, state: "done" },
    {
      key: "delivered", label: "Giao hàng",
      at: eventAt("resources_assigned", "order_delivered", "order_provisioned", "order_delivered_manual"),
      state: delivered ? "done" : st === "cancelled" ? "failed" : "current",
    },
    {
      key: "escrow", label: c.money.escrow_expires_at ? `Ký quỹ đến ${shortDate(c.money.escrow_expires_at)}` : "Ký quỹ",
      at: null,
      state: st === "delivered" || st === "disputed" ? "current" : delivered ? "done" : closedFailed ? "failed" : "todo",
    },
    {
      key: "closed",
      label: st === "completed" ? "Giải ngân cho người bán" : st === "refunded" ? "Hoàn tiền cho người mua" : st === "cancelled" ? "Đã huỷ" : "Kết thúc",
      at: releasedAt ?? refundedAt ?? (closedFailed ? c.updated_at : null),
      state: st === "completed" ? "done" : closedFailed ? "failed" : "todo",
    },
  ];
  return steps;
}

export interface ActionDef {
  key: AdminOrderActionKey;
  label: string;
  hint: string;
  tone: "danger" | "primary" | "secondary";
  /** Money-moving or irreversible actions ask for a reason and a confirmation. */
  confirm: boolean;
  preview?: (c: AdminOrderCase, input: { days: number }) => string;
}

const vnd = (v: number | null | undefined) => `${Math.round(v ?? 0).toLocaleString("vi-VN")} ₫`;

export const ACTIONS: ActionDef[] = [
  {
    key: "release", label: "Giải ngân cho người bán", tone: "primary", confirm: true,
    hint: "Xác nhận thay người mua khi đã chắc hàng ổn — tiền rời ký quỹ ngay.",
    preview: (c) => `Người bán nhận ${vnd(c.money.projected_seller_payout)}, phí sàn ${vnd(c.money.projected_platform_fee)}. Đơn chuyển sang Hoàn tất.`,
  },
  {
    key: "refund", label: "Huỷ & hoàn tiền cho người mua", tone: "danger", confirm: true,
    hint: "Hoàn toàn bộ phần còn trong ký quỹ. Proxy/API key đã cấp sẽ bị thu hồi.",
    preview: (c) => `Người mua nhận lại ${vnd(c.money.remaining)}. Người bán không nhận tiền. Không hoàn tác được.`,
  },
  {
    key: "extend_escrow", label: "Gia hạn ký quỹ", tone: "secondary", confirm: true,
    hint: "Hoãn tự động giải ngân để có thêm thời gian kiểm tra.",
    preview: (c, { days }) => `Hạn ký quỹ lùi thêm ${days} ngày${c.money.escrow_expires_at ? ` (hiện tại ${shortDate(c.money.escrow_expires_at)})` : ""}.`,
  },
  {
    key: "retry_provision", label: "Cấp hàng lại", tone: "secondary", confirm: false,
    hint: "Gọi lại nguồn hàng cho đơn đang kẹt ở bước chờ.",
  },
  {
    key: "revoke_gateway_key", label: "Thu hồi API key", tone: "danger", confirm: true,
    hint: "Dùng khi phát hiện lạm dụng. Người mua phải liên hệ hỗ trợ để cấp lại.",
    preview: () => "API key hiện tại ngừng hoạt động ngay lập tức.",
  },
];

export const LEDGER_DIRECTION: Record<string, "in" | "out" | "neutral"> = {
  purchase_hold: "in",
  purchase_release: "out",
  platform_fee: "out",
  refund: "out",
  affiliate_commission: "out",
  affiliate_clawback: "in",
};

export const TASK_STATUS: Record<string, string> = {
  pending: "Chờ nhận", assigned: "Đã giao người làm", processing: "Đang làm", completed: "Hoàn thành", failed: "Thất bại",
};

export const RESOURCE_STATUS: Record<string, string> = {
  available: "Còn trong kho", assigned: "Đã giao", expired: "Hết hạn", error: "Báo lỗi",
};

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatVnd(v: number | null | undefined): string {
  return vnd(v);
}

/** Things an operator should notice before anything else. */
export function attention(c: AdminOrderCase, now = Date.now()): { tone: "bad" | "warn" | "info"; text: string; href?: string; cta?: string }[] {
  const out: { tone: "bad" | "warn" | "info"; text: string; href?: string; cta?: string }[] = [];
  const open = c.disputes.find((d) => d.status === "open");
  if (open) out.push({ tone: "warn", text: `Đơn đang có khiếu nại mở: "${open.reason}". Quyết định tiền nằm trong hồ sơ khiếu nại.`, href: open.href, cta: "Mở hồ sơ" });
  if (c.money.escrow_overdue) out.push({ tone: "bad", text: "Đã quá hạn ký quỹ nhưng chưa giải ngân — job tự động có thể đã lỗi." });
  if (c.order_status === "pending" && now - new Date(c.created_at).getTime() > 15 * 60_000) {
    out.push({ tone: "bad", text: "Đơn chờ cấp hàng hơn 15 phút — kiểm tra nguồn hàng hoặc cấp lại." });
  }
  if (c.order_status === "processing" && c.sla_hours) {
    const due = new Date(c.created_at).getTime() + c.sla_hours * 3_600_000;
    if (due < now) out.push({ tone: "bad", text: `Người bán quá hạn giao thủ công (SLA ${c.sla_hours} giờ).` });
    else out.push({ tone: "info", text: `Người bán cần giao trước ${shortDate(new Date(due).toISOString())}.` });
  }
  if (c.money.refunded > 0 && c.money.refunded < c.money.total) out.push({ tone: "info", text: `Đơn đã được hoàn một phần ${vnd(c.money.refunded)}.` });
  if (c.provider && !c.provider.is_active) out.push({ tone: "warn", text: `Nguồn hàng "${c.provider.name}" đang tắt.`, href: c.provider.href, cta: "Mở nguồn hàng" });
  return out;
}
