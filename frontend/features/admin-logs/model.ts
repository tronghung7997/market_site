import type { AdminLogEntry } from "@/lib/types";

type Md = Record<string, unknown>;

/** Keys shown elsewhere (as linked records, actor, or the technical block). */
const HIDDEN_KEYS = new Set([
  "event", "ip", "actor_id", "actor_type", "subject_type", "subject_id",
  "order_id", "dispute_id", "account_id", "seller_id", "buyer_id", "affiliate_id", "referrer_id", "target_account_id",
  "provider_id", "product_id", "variant_id", "resource_id", "replacement_resource_id", "withdraw_id",
  "withdraw_request_id", "intent_id", "deposit_id", "wallet_id",
]);

export const FIELD_LABEL: Record<string, string> = {
  amount: "Số tiền",
  refund_amount: "Tiền hoàn",
  fee_amount: "Phí",
  net_amount: "Thực nhận",
  remaining: "Còn lại",
  extra_days: "Ngày bảo hành thêm",
  reason: "Lý do",
  note: "Ghi chú",
  error: "Lỗi",
  outcome: "Kết quả",
  source: "Nguồn thao tác",
  resource_ids: "Tài nguyên",
  intent_ids: "Các lệnh nạp",
  task_count: "Số tác vụ",
  reference: "Mã tham chiếu",
  payout_reference: "Mã chi tiền",
  order_code: "Mã đơn cổng thanh toán",
  prefix: "Tiền tố key",
  application_id: "Đơn đăng ký bán",
  alert_id: "Cảnh báo",
  alert_type: "Loại cảnh báo",
  status: "Trạng thái",
  count: "Số lượng",
  quantity: "Số lượng",
  price: "Giá",
  days: "Số ngày",
  action: "Hành động",
  resource_count: "Số dòng",
  field: "Trường",
  matches: "Từ bị chặn",
  mismatches: "Số ví lệch",
};

const MONEY = new Set(["amount", "refund_amount", "fee_amount", "net_amount", "remaining", "price", "balance", "credit"]);
const ACTION: Record<string, string> = { replace: "Đổi hàng", refund: "Hoàn tiền", archive: "Lưu trữ", restore: "Khôi phục" };
const OUTCOME: Record<string, string> = { success: "Thành công", failure: "Thất bại", denied: "Bị từ chối", error: "Lỗi" };
const SOURCE: Record<string, string> = { admin: "Trang quản trị", public: "Người dùng", seller: "Người bán", system: "Hệ thống", job: "Job nền", webhook: "Webhook" };

export interface Field {
  key: string;
  label: string;
  value: string;
  tone?: "bad" | "good";
}

export interface Change {
  key: string;
  label: string;
  before: string;
  after: string;
}

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number" && MONEY.has(key)) return `${v.toLocaleString("vi-VN")} ₫`;
  if (typeof v === "number") return v.toLocaleString("vi-VN");
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (Array.isArray(v)) return v.length > 12 ? `${v.slice(0, 12).join(", ")} … (+${v.length - 12})` : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function humanKey(key: string): string {
  return FIELD_LABEL[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Split metadata into readable fields and before → after changes
 *  (old_x/new_x, before/after, from/to pairs). */
export function describeMetadata(md: Md | null | undefined): { fields: Field[]; changes: Change[] } {
  const m = md ?? {};
  const fields: Field[] = [];
  const changes: Change[] = [];
  const used = new Set<string>();
  for (const key of Object.keys(m)) {
    const pair = key.match(/^(old|previous|from)_(.+)$/);
    if (!pair) continue;
    const base = pair[2];
    const newKey = [`new_${base}`, `next_${base}`, `to_${base}`].find((k) => k in m);
    if (!newKey) continue;
    changes.push({ key: base, label: humanKey(base), before: show(base, m[key]), after: show(base, m[newKey]) });
    used.add(key);
    used.add(newKey);
  }
  if (m.old !== undefined && m.new !== undefined) {
    changes.push({ key: "value", label: "Giá trị", before: show("", m.old), after: show("", m.new) });
    used.add("old");
    used.add("new");
  }
  for (const [key, v] of Object.entries(m)) {
    if (HIDDEN_KEYS.has(key) || used.has(key)) continue;
    if (key === "outcome") {
      fields.push({ key, label: "Kết quả", value: OUTCOME[String(v)] ?? String(v), tone: v === "success" ? "good" : "bad" });
    } else if (key === "source") {
      fields.push({ key, label: "Nguồn thao tác", value: SOURCE[String(v)] ?? String(v) });
    } else if (key === "action") {
      fields.push({ key, label: "Hành động", value: ACTION[String(v)] ?? String(v) });
    } else if (key === "error") {
      fields.push({ key, label: "Lỗi", value: show(key, v), tone: "bad" });
    } else {
      fields.push({ key, label: humanKey(key), value: show(key, v) });
    }
  }
  return { fields, changes };
}

export function actorText(log: AdminLogEntry): string {
  if (log.actor) return log.actor.label;
  const t = String((log.metadata ?? {}).actor_type ?? "");
  if (log.job_id || t === "system" || t === "job" || t === "scheduler") return "Hệ thống (job nền)";
  if (t === "webhook") return "Webhook từ bên ngoài";
  // Older events did not record who acted; say so instead of guessing.
  return log.request_id ? "Không ghi nhận" : "Hệ thống";
}

export function refSearchText(log: AdminLogEntry): string {
  return [log.actor?.label, log.actor?.detail, ...log.refs.flatMap((r) => [r.label, r.detail ?? ""])].join(" ").toLowerCase();
}
