/**
 * Format money for Vietnamese dong
 * 7000 → "7.000 ₫"
 */
export function vnd(amount: number, locale = "en"): string {
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
    style: "currency", currency: "VND", maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format date to Vietnamese locale
 */
export function formatDate(date: string | Date, locale = "en"): string {
  return new Date(date).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US");
}

/**
 * Format datetime to Vietnamese locale
 */
export function formatDateTime(date: string | Date, locale = "en"): string {
  return new Date(date).toLocaleString(locale === "vi" ? "vi-VN" : "en-US");
}

/**
 * Get days ago string
 */
export function daysAgo(date: string | Date, locale = "en"): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (locale === "vi") {
    if (diffDays === 0) return "Hôm nay";
    if (diffDays === 1) return "Hôm qua";
    if (diffDays < 7) return `${diffDays} ngày trước`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} tuần trước`;
  } else {
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  }
  return formatDate(date, locale);
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Spec key → nhãn tiếng Việt cho các key thường gặp; key lạ thì thay "_"
 * bằng khoảng trắng. Dùng chung giữa trang mua và preview ở trang seller
 * sửa sản phẩm — hai nơi phải hiện giống hệt nhau, không thì preview nói dối.
 */
export function formatSpecKey(key: string, locale = "en"): string {
  const viMap: Record<string, string> = {
    format: "Định dạng", platform: "Nền tảng", age: "Tuổi TK",
    verified: "Xác minh", country: "Quốc gia", type: "Loại",
    friends: "Bạn bè", posts: "Bài viết", compatibility: "Tương thích",
    protocol: "Giao thức", provider: "Nhà mạng", bandwidth: "Băng thông",
    countries: "Quốc gia", uptime: "Uptime", cpu: "CPU", ram: "RAM",
    storage: "Lưu trữ", location: "Vị trí", os: "Hệ điều hành",
    network: "Mạng", currency: "Tiền tệ", min_load: "Nạp min",
    max_load: "Nạp max", kyc: "KYC",
  };
  const enMap: Record<string, string> = {
    format: "Format", platform: "Platform", age: "Account age", verified: "Verified", country: "Country", type: "Type",
    friends: "Friends", posts: "Posts", compatibility: "Compatibility", protocol: "Protocol", provider: "Provider",
    bandwidth: "Bandwidth", countries: "Countries", uptime: "Uptime", cpu: "CPU", ram: "RAM", storage: "Storage",
    location: "Location", os: "Operating system", network: "Network", currency: "Currency", min_load: "Minimum load",
    max_load: "Maximum load", kyc: "KYC",
  };
  return (locale === "vi" ? viMap : enMap)[key] ?? key.replace(/_/g, " ");
}
