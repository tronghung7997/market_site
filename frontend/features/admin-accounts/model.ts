/** Admin accounts directory: URL state, saved views and row wording. Pure —
 *  covered by tests/admin-accounts-model.test.ts. Admin copy is Vietnamese. */

import type { AccountAdminRow, AccountsSummary } from "../../lib/types.ts";

export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const TIERS = ["new", "verified", "trusted", "enterprise"] as const;

export interface AccountsFilters {
  q: string;
  role: string;
  tier: string[];
  status: string;
  sort: string;
  page: number;
  perPage: number;
}

export const DEFAULT_FILTERS: AccountsFilters = { q: "", role: "", tier: [], status: "", sort: "newest", page: 1, perPage: 20 };

const ROLES = new Set(["buyer", "seller", "admin"]);
const STATUSES = new Set(["active", "locked", "unverified", "2fa", "internal", "risky", "new_7d"]);
const SORTS = new Set(["newest", "oldest", "last_login", "email", "balance"]);

export function parseAccountsUrl(params: URLSearchParams): AccountsFilters {
  const role = params.get("role") ?? "";
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "";
  const page = Number(params.get("page"));
  const perPage = Number(params.get("per_page"));
  return {
    q: params.get("q") ?? "",
    role: ROLES.has(role) ? role : "",
    tier: (params.get("tier") ?? "").split(",").filter((t) => (TIERS as readonly string[]).includes(t)),
    status: STATUSES.has(status) ? status : "",
    sort: SORTS.has(sort) ? sort : DEFAULT_FILTERS.sort,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : DEFAULT_FILTERS.perPage,
  };
}

/** Serialises over `current` (keeping unrelated params); defaults are omitted. */
export function accountsUrlSearch(f: AccountsFilters, current: URLSearchParams = new URLSearchParams()): string {
  const next = new URLSearchParams(current.toString());
  const put = (key: string, value: string, fallback = "") => { if (value && value !== fallback) next.set(key, value); else next.delete(key); };
  put("q", f.q.trim());
  put("role", f.role);
  put("tier", f.tier.join(","));
  put("status", f.status);
  put("sort", f.sort, DEFAULT_FILTERS.sort);
  put("page", String(f.page), "1");
  put("per_page", String(f.perPage), String(DEFAULT_FILTERS.perPage));
  next.delete("account");
  return next.toString();
}

export function accountsQuery(f: AccountsFilters) {
  return {
    search: f.q.trim() || undefined,
    role: f.role || undefined,
    tier: f.tier.length ? f.tier : undefined,
    status: f.status || undefined,
    sort: f.sort,
    page: f.page,
    per_page: f.perPage,
  };
}

export interface SavedView {
  key: string;
  label: string;
  role: string;
  status: string;
  count: (s: AccountsSummary) => number | undefined;
}

export const SAVED_VIEWS: SavedView[] = [
  { key: "all", label: "Tất cả", role: "", status: "", count: (s) => s.all },
  { key: "sellers", label: "Người bán", role: "seller", status: "", count: (s) => s.sellers },
  { key: "new", label: "Mới 7 ngày", role: "", status: "new_7d", count: (s) => s.new_7d },
  { key: "risky", label: "Đáng ngờ", role: "", status: "risky", count: (s) => s.risky },
  { key: "locked", label: "Đã khóa", role: "", status: "locked", count: (s) => s.locked },
  { key: "unverified", label: "Chưa xác minh", role: "", status: "unverified", count: (s) => s.unverified },
];

export function activeView(f: AccountsFilters): string | null {
  if (f.tier.length) return null;
  return SAVED_VIEWS.find((v) => v.role === f.role && v.status === f.status)?.key ?? null;
}

export const RISK_FLAG_LABEL: Record<string, string> = {
  failed_logins: "Nhiều lần sai mật khẩu",
  shared_phone: "Trùng SĐT tài khoản bị khóa",
};

function ddmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Khóa 12/09 bởi admin@x · lý do" — null while the account is active. */
export function lockLine(row: Pick<AccountAdminRow, "is_active" | "locked_at" | "locked_by_email" | "lock_reason">): string | null {
  if (row.is_active) return null;
  const parts = ["Khóa"];
  if (row.locked_at) parts.push(ddmm(row.locked_at));
  if (row.locked_by_email) parts.push(`bởi ${row.locked_by_email}`);
  const head = parts.join(" ");
  return row.lock_reason ? `${head} · ${row.lock_reason}` : head;
}

/* ---------------------------------------------------------------- Timeline */

const TIMELINE_KIND: Record<string, string> = {
  login: "Đăng nhập",
  login_failed: "Đăng nhập thất bại",
  order_bought: "Mua đơn",
  order_sold: "Bán đơn",
  dispute: "Khiếu nại",
  tier_change: "Đổi hạng",
  application_submitted: "Nộp đơn bán hàng",
  application_info_requested: "Được yêu cầu bổ sung",
  application_resubmitted: "Bổ sung đơn bán hàng",
  application_approved: "Đơn bán hàng được duyệt",
  application_rejected: "Đơn bán hàng bị từ chối",
  admin_action: "Thao tác admin",
};

/** One readable line per timeline event: a Vietnamese verb for the kind, then
 *  the backend's detail with order statuses translated and login noise dropped. */
export function timelineLine(ev: { kind: string; text: string | null }, statusLabel: (s: string) => string): string {
  const verb = TIMELINE_KIND[ev.kind] ?? ev.kind;
  let detail = ev.text ?? "";
  if (ev.kind === "order_bought" || ev.kind === "order_sold") {
    const [code, status] = detail.split(" · ");
    detail = status ? `${code} · ${statusLabel(status)}` : detail;
  } else if (ev.kind === "login" || ev.kind === "login_failed") {
    const ip = detail.split(" · ")[2];
    detail = ip ? `IP ${ip}` : "";
  }
  return detail ? `${verb} · ${detail}` : verb;
}
