// Nguồn duy nhất cho nhãn/mô tả chiến lược giá + adapter — dùng chung giữa
// trang admin (/admin/products/[id]) và trang seller (/seller/.../products/[id]).
// Trước đây mỗi trang tự khai một bản gần giống nhau, dễ lệch nội dung theo
// thời gian (VD: mô tả seller_pool khác nhau 3 chữ ở 3 nơi).

import { vnd } from "@/lib/api";

export const STRATEGY_INFO: Record<string, { label: string; description: string }> = {
  fixed: { label: "Cố định", description: "Giá đặt trên từng biến thể — khách chọn biến thể + số lượng." },
  config: { label: "Cấu hình", description: "Giá tính theo tuỳ chọn khách chọn (loại, mạng, thời hạn)." },
  credit: { label: "Gói credit", description: "Khách mua một gói request — mỗi lần dùng trừ dần credit." },
  task: { label: "Theo tác vụ", description: "Giá theo nền tảng và số URL — đội vận hành xử lý thủ công." },
};

export const STRATEGY_FORMULAS: Record<string, string> = {
  fixed: "Giá = variant.price × số lượng",
  config: "Giá = giá cơ bản × hệ số loại × hệ số mạng × (số ngày / 30) × số lượng",
  credit: "Giá = giá mỗi credit × số credit trong gói",
  task: "Giá = giá cơ bản × hệ số nền tảng × số URL",
};

export const ADAPTER_INFO: Record<string, { label: string; description: string }> = {
  seller_pool: { label: "Kho hàng của bạn", description: "Lấy trực tiếp từ tài nguyên bạn đã nạp ở trang Kho hàng." },
  mock: { label: "Demo", description: "Dữ liệu giả để thử nghiệm — chưa nối API nhà cung cấp thật." },
  manual: { label: "Xử lý thủ công", description: "Đội vận hành nhận việc và xử lý tay, không tự động." },
  topproxy: { label: "TopProxy (API thật)", description: "Cấp phát tự động qua API của TopProxy." },
  scrapecreators: { label: "ScrapeCreators (API thật)", description: "Cấp phát tự động qua API của ScrapeCreators." },
  seller_gateway: { label: "Gateway seller", description: "Mỗi lần buyer gọi, nền tảng forward qua API thật của seller và trừ credit — buyer không thấy base_url/api_key thật." },
  seller_task_webhook: { label: "Webhook tác vụ seller", description: "Gửi tác vụ cho backend seller xử lý tự động, seller báo kết quả qua webhook thay vì admin xử lý tay." },
  dproxy: { label: "DProxy", description: "Khi khách mua, hệ thống tự mua đúng 1 proxy từ DProxy và giao ngay. Mỗi sản phẩm bán đúng 1 gói." },
};

export const PARAM_LABELS: Record<string, string> = {
  base_price: "Giá cơ bản",
  credit_price: "Giá mỗi credit",
  type_mult: "Hệ số theo loại",
  network_mult: "Hệ số theo mạng",
  platform_mult: "Hệ số theo nền tảng",
  duration_options: "Tuỳ chọn thời hạn",
  packages: "Gói credit",
  volume_tiers: "Giảm giá theo số lượng",
  field_labels: "Nhãn hiển thị",
};

export function formatParamValue(val: unknown): string {
  if (typeof val === "number") return vnd(val);
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join(", ");
  if (typeof val === "object" && val !== null) {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "number" ? (v < 10 ? `×${v}` : vnd(v)) : v}`)
      .join(" · ");
  }
  return String(val);
}
