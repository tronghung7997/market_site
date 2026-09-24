import type { AdminProductActivity, AdminProductBulkAction, AdminProductBulkResult } from "@/lib/types";

/* Logic thuần của khu quản lý sản phẩm admin — không React, không fetch,
   để test trực tiếp (tests/admin-products.test.ts). */

export type ProductStatusKey = "active" | "draft" | "paused" | "suspended";

export const STATUS_META: Record<ProductStatusKey, { label: string; tone: "good" | "neutral" | "warn" | "bad"; dot: string }> = {
  active: { label: "Đang bán", tone: "good", dot: "bg-good" },
  draft: { label: "Nháp", tone: "neutral", dot: "bg-slate-400" },
  paused: { label: "Tạm dừng", tone: "warn", dot: "bg-warn" },
  suspended: { label: "Bị khoá", tone: "bad", dot: "bg-bad" },
};

export function statusMeta(status: string) {
  return STATUS_META[status as ProductStatusKey] ?? { label: status, tone: "neutral" as const, dot: "bg-slate-300" };
}

/** Tab trạng thái của bảng. `needs_setup` lọc theo cấu hình, không phải ProductStatus. */
export const STATUS_TABS = [
  { key: "all", label: "Tất cả" },
  { key: "active", label: "Đang bán" },
  { key: "needs_setup", label: "Cần thiết lập" },
  { key: "paused", label: "Tạm dừng" },
  { key: "draft", label: "Nháp" },
  { key: "suspended", label: "Bị khoá" },
] as const;

export type StatusTabKey = (typeof STATUS_TABS)[number]["key"];

export const SORT_OPTIONS = [
  { key: "newest", label: "Mới tạo trước", sortBy: "created_at", sortDir: "desc" },
  { key: "oldest", label: "Cũ nhất trước", sortBy: "created_at", sortDir: "asc" },
  { key: "orders", label: "Nhiều đơn nhất", sortBy: "order_count", sortDir: "desc" },
  { key: "revenue", label: "Doanh thu cao nhất", sortBy: "revenue", sortDir: "desc" },
  { key: "title", label: "Tên A → Z", sortBy: "title", sortDir: "asc" },
  { key: "seller", label: "Người bán A → Z", sortBy: "seller_email", sortDir: "asc" },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["key"];

export const PAGE_SIZES = [20, 50, 100] as const;

export interface ProductListQuery {
  q: string;
  status: StatusTabKey;
  seller: string | null;
  provider: string | null;
  service: string | null;
  categoryId: number | null;
  sort: SortKey;
  page: number;
  size: number;
}

export const DEFAULT_QUERY: ProductListQuery = {
  q: "", status: "all", seller: null, provider: null, service: null,
  categoryId: null, sort: "newest", page: 1, size: 20,
};

function positiveInt(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** URL → bộ lọc. Giá trị lạ rơi về mặc định thay vì làm hỏng trang. */
export function parseListQuery(params: URLSearchParams): ProductListQuery {
  const status = params.get("status");
  const sort = params.get("sort");
  const size = positiveInt(params.get("size"));
  return {
    q: params.get("q")?.trim() ?? "",
    status: STATUS_TABS.some((t) => t.key === status) ? (status as StatusTabKey) : "all",
    seller: params.get("seller") || null,
    provider: params.get("provider") || null,
    service: params.get("service") || null,
    // `category_id` là tên cũ — trang Danh mục vẫn link bằng tên này.
    categoryId: positiveInt(params.get("category_id")),
    sort: SORT_OPTIONS.some((o) => o.key === sort) ? (sort as SortKey) : "newest",
    page: positiveInt(params.get("page")) ?? 1,
    size: size != null && (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_QUERY.size,
  };
}

/** Bộ lọc → URL, bỏ mọi giá trị mặc định cho link gọn. */
export function listQueryToParams(query: ProductListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status !== "all") params.set("status", query.status);
  if (query.seller) params.set("seller", query.seller);
  if (query.provider) params.set("provider", query.provider);
  if (query.service) params.set("service", query.service);
  if (query.categoryId) params.set("category_id", String(query.categoryId));
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.size !== DEFAULT_QUERY.size) params.set("size", String(query.size));
  return params;
}

/** Đổi bộ lọc nào (trừ trang) thì quay về trang 1. */
export function updateQuery(query: ProductListQuery, patch: Partial<ProductListQuery>): ProductListQuery {
  const next = { ...query, ...patch };
  if (!("page" in patch)) next.page = 1;
  return next;
}

export function activeFilterCount(query: ProductListQuery): number {
  return [query.q, query.seller, query.provider, query.service, query.categoryId].filter(Boolean).length;
}

export function sortParams(sort: SortKey) {
  const option = SORT_OPTIONS.find((o) => o.key === sort) ?? SORT_OPTIONS[0];
  return { sortBy: option.sortBy, sortDir: option.sortDir };
}

export const BULK_ACTION_LABELS: Record<AdminProductBulkAction, string> = {
  activate: "Mở bán",
  pause: "Tạm dừng",
  draft: "Chuyển về nháp",
  suspend: "Khoá",
  set_category: "Đổi danh mục",
};

/** Câu báo kết quả sau khi chạy thao tác hàng loạt (hoặc thao tác một dòng). */
export function bulkResultMessage(result: AdminProductBulkResult, action: AdminProductBulkAction): {
  tone: "good" | "warn" | "bad";
  text: string;
} {
  const updated = result.updated.length;
  const setup = result.skipped.filter((s) => s.reason === "needs_setup").length;
  const unchanged = result.skipped.filter((s) => s.reason === "unchanged").length;
  const missing = result.skipped.filter((s) => s.reason === "not_found").length;
  const verb = BULK_ACTION_LABELS[action].toLowerCase();
  const parts: string[] = [];
  if (updated > 0) parts.push(`Đã ${verb} ${updated} sản phẩm`);
  if (setup > 0) parts.push(`${setup} sản phẩm chưa thiết lập xong nên chưa mở bán`);
  if (unchanged > 0) parts.push(`${unchanged} sản phẩm đã ở trạng thái đó`);
  if (missing > 0) parts.push(`${missing} sản phẩm không còn tồn tại`);
  if (parts.length === 0) return { tone: "warn", text: "Không có sản phẩm nào thay đổi." };
  const tone = updated === 0 ? (setup > 0 || missing > 0 ? "bad" : "warn") : setup > 0 || missing > 0 ? "warn" : "good";
  return { tone, text: `${parts.join(" · ")}.` };
}

/** Thao tác trạng thái hợp lý cho một sản phẩm, theo thứ tự hiện trên nút. */
export function statusActionsFor(status: string): { action: Exclude<AdminProductBulkAction, "set_category">; label: string; danger?: boolean }[] {
  const all = [
    { action: "activate" as const, label: status === "suspended" ? "Mở khoá & bán lại" : "Mở bán", target: "active" },
    { action: "pause" as const, label: "Tạm dừng bán", target: "paused" },
    { action: "draft" as const, label: "Chuyển về nháp", target: "draft" },
    { action: "suspend" as const, label: "Khoá sản phẩm", target: "suspended", danger: true },
  ];
  return all.filter((a) => a.target !== status).map(({ target: _target, ...rest }) => rest);
}

const EVENT_LABELS: Record<string, string> = {
  admin_product_status_changed: "Đổi trạng thái",
  admin_product_category_changed: "Đổi danh mục",
  admin_product_content_updated: "Sửa nội dung",
};

const FIELD_LABELS: Record<string, string> = {
  title: "tên", description: "mô tả", highlight_text: "dòng nổi bật", features: "tính năng",
  specs: "thông số", warranty_text: "bảo hành", service_type: "loại dịch vụ", escrow_days: "số ngày ký quỹ",
  slug: "đường dẫn", cover_id: "ảnh bìa", images: "ảnh",
};

/** Một dòng lịch sử → tiêu đề + chi tiết dễ đọc. */
export function describeActivity(
  entry: AdminProductActivity,
  categoryName: (id: number) => string | undefined = () => undefined,
): { title: string; detail: string | null } {
  const title = EVENT_LABELS[entry.event ?? ""] ?? entry.event ?? "Thao tác";
  const d = entry.details;
  let detail: string | null = null;
  if (entry.event === "admin_product_status_changed") {
    detail = `${statusMeta(String(d.from)).label} → ${statusMeta(String(d.to)).label}`;
  } else if (entry.event === "admin_product_category_changed") {
    const name = (id: unknown) => (typeof id === "number" ? categoryName(id) ?? `#${id}` : "—");
    detail = `${name(d.from)} → ${name(d.to)}`;
  } else if (entry.event === "admin_product_content_updated" && Array.isArray(d.fields)) {
    detail = (d.fields as string[]).map((f) => FIELD_LABELS[f] ?? f).join(", ");
    if (typeof d.locale === "string") detail += ` (${d.locale.toUpperCase()})`;
  }
  const extras = [d.bulk ? "thao tác hàng loạt" : null, typeof d.reason === "string" ? `Lý do: ${d.reason}` : null].filter(Boolean);
  if (extras.length) detail = [detail, ...extras].filter(Boolean).join(" · ");
  return { title, detail };
}
