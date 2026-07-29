/** Luật mua hàng của trang sản phẩm — toàn bộ QUYẾT ĐỊNH nằm ở đây dưới dạng
 *  hàm thuần, JSX chỉ render kết quả. Đây từng là chỗ sinh bug "nút mua chết"
 *  (mặc định chọn gói Liên hệ 0đ rồi disable nút): giờ mỗi luật có tên, đọc
 *  được như bảng, và test được không cần render.
 *
 *  Invariant: không import React, không side effect — chỉ Variant vào, quyết
 *  định ra. */

import type { Variant } from "@/lib/types";

/** Gói mua được ngay: có giá thật và (giao tay hoặc còn kho). */
export const purchasable = (v: Variant): boolean =>
  v.price > 0 && (v.delivery_mode !== "instant" || v.stock_count > 0);

/** Gói hết kho: chỉ áp dụng cho giao ngay — gói giao tay không có khái niệm kho. */
export const outOfStock = (v: Variant): boolean =>
  v.delivery_mode === "instant" && v.stock_count <= 0;

/** Gói mặc định khi mở trang — KHÔNG bao giờ mở trang bằng một CTA chết:
 *  ưu tiên gói mua được ngay → gói có giá (dù hết kho, để neo giá) → gói đầu. */
export function pickDefaultVariant(variants: Variant[]): Variant | null {
  return variants.find(purchasable) ?? variants.find((v) => v.price > 0) ?? variants[0] ?? null;
}

/** Trần số lượng: giao ngay bị chặn bởi kho; giao tay thả lỏng 999. */
export function maxQtyFor(v: Variant | null): number {
  if (!v) return 999;
  return v.delivery_mode === "instant" ? Math.max(1, v.stock_count) : 999;
}

export function clampQty(n: number, v: Variant | null): number {
  return Math.min(Math.max(1, n), maxQtyFor(v));
}

/** Gói giá 0đ = "Liên hệ": panel bỏ qty/total, CTA thành liên hệ người bán. */
export type PanelMode = "buy" | "contact";
export function panelMode(selected: Variant | null): PanelMode {
  return selected && selected.price === 0 ? "contact" : "buy";
}

export interface CtaState {
  label: string;
  disabled: boolean;
  /** login → đẩy sang /login?next=…; confirm → mở modal xác nhận; none → nút đứng im. */
  intent: "login" | "confirm" | "none";
}

/** Trạng thái nút mua chính. Bảng luật, đọc từ trên xuống, nhánh đầu thắng.
 *  Khách chưa đăng nhập KHÔNG bao giờ bị disable — bấm là ra trang login. */
export function ctaState({ loggedIn, placing, selected }: {
  loggedIn: boolean;
  placing: boolean;
  selected: Variant | null;
}): CtaState {
  if (placing) return { label: "Đang xử lý…", disabled: true, intent: "none" };
  if (!selected) return { label: "Đặt hàng", disabled: true, intent: "none" };
  if (!loggedIn) return { label: "Đăng nhập để mua", disabled: false, intent: "login" };
  if (outOfStock(selected)) return { label: "Hết hàng", disabled: true, intent: "none" };
  return {
    label: selected.delivery_mode === "instant" ? "Mua ngay" : "Đặt hàng",
    disabled: false,
    intent: "confirm",
  };
}
