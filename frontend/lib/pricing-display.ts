// Giá "Chỉ từ" hiển thị trên card/danh sách — phải là SỐ TIỀN THẬT RẺ NHẤT
// buyer có thể trả, không phải một tham số nội bộ của công thức giá.
//
// Vì sao không hiện thẳng base_price: với strategy "config", giá = base ×
// type_mult × network_mult × (days/30); sản phẩm bán kỳ hạn ngắn (vd key xoay
// 24 giờ, base 120.000 để ra 4.000đ/ngày) sẽ hiện "Từ 120.000đ" trong khi
// buyer thật sự chỉ trả 4.000đ — sai lệch 30 lần. Cùng lý do CreditPricing
// từng phải nhân credit_price với gói nhỏ nhất (xem app/products/[id]).

type PricingParams = Record<string, unknown> | null | undefined;

interface PricedProduct {
  variants?: { price: number }[] | null;
  pricing_strategy?: string | null;
  pricing_params?: PricingParams;
}

function minOfMult(mult: unknown): number {
  if (mult && typeof mult === "object") {
    const values = Object.values(mult as Record<string, unknown>).filter(
      (v): v is number => typeof v === "number" && v > 0,
    );
    if (values.length) return Math.min(...values);
  }
  return 1;
}

function configMinPrice(params: Record<string, unknown>): number {
  const base = typeof params.base_price === "number" ? params.base_price : 0;
  if (base <= 0) return 0;
  const durations = Array.isArray(params.duration_options)
    ? (params.duration_options as { days?: unknown }[])
        .map((d) => (typeof d.days === "number" ? d.days : 0))
        .filter((d) => d > 0)
    : [];
  const minDays = durations.length ? Math.min(...durations) : 30;
  return Math.round(base * minOfMult(params.type_mult) * minOfMult(params.network_mult) * (minDays / 30));
}

function creditMinPrice(params: Record<string, unknown>): number {
  const unit = typeof params.credit_price === "number" ? params.credit_price : 0;
  const packages = Array.isArray(params.packages)
    ? (params.packages as { size?: unknown }[])
        .map((p) => (typeof p.size === "number" ? p.size : 0))
        .filter((s) => s > 0)
    : [];
  if (unit > 0 && packages.length) return unit * Math.min(...packages);
  return 0;
}

/** Giá thấp nhất buyer có thể trả thật — 0 nghĩa là không xác định được ("Báo giá"). */
export function effectiveMinPrice(p: PricedProduct): number {
  const priced = (p.variants ?? []).filter((v) => v.price > 0);
  if (priced.length) return Math.min(...priced.map((v) => v.price));

  const params = (p.pricing_params ?? null) as Record<string, unknown> | null;
  if (!params) return 0;
  switch (p.pricing_strategy) {
    case "config":
      return configMinPrice(params);
    case "credit":
      return creditMinPrice(params);
    default:
      return typeof params.base_price === "number" ? params.base_price : 0;
  }
}

/** Sản phẩm fulfillment qua provider/adapter (strategy khác fixed) — không có
 * tồn kho variant để đếm, coi như luôn sẵn hàng giao tự động. */
export function isAdapterFulfilled(p: PricedProduct): boolean {
  return p.pricing_strategy != null && p.pricing_strategy !== "fixed";
}
