/** Nhãn tiếng Việt cho service_type của sản phẩm — một nguồn, thay 3 bản chép
 *  (trang sản phẩm buyer + 2 trang admin products). */
/** Thứ tự key GIỮ NGUYÊN theo bản admin cũ — trang admin dựng <option> bằng
 *  Object.entries nên đổi thứ tự là đổi dropdown; buyer chỉ lookup, không sao. */
export const SERVICE_LABELS: Record<string, string> = {
  account: "Tài khoản", proxy: "Proxy", token: "Token", endpoint: "Endpoint",
  cloud: "Cloud", payment: "Thanh toán", takedown: "Takedown", other: "Khác",
};

export function serviceLabel(type: string | null | undefined): string {
  return SERVICE_LABELS[type ?? "other"] ?? "Khác";
}
