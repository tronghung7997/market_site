/** service_type labels — one source for buyer + admin. Locale-aware. */

const BY_LOCALE: Record<"en" | "vi", Record<string, string>> = {
  en: {
    account: "Account", proxy: "Proxy", token: "Token", endpoint: "Endpoint",
    cloud: "Cloud", payment: "Payment", takedown: "Takedown", other: "Other",
  },
  vi: {
    account: "Tài khoản", proxy: "Proxy", token: "Token", endpoint: "Endpoint",
    cloud: "Cloud", payment: "Thanh toán", takedown: "Takedown", other: "Khác",
  },
};

/** Legacy export shape used by admin Object.entries dropdowns (VI labels, key order preserved). */
export const SERVICE_LABELS: Record<string, string> = BY_LOCALE.vi;

/** Prefer this helper; pass active locale from useLocale(). */
export function serviceLabel(type: string | null | undefined, locale: string = "en"): string {
  const loc = locale === "vi" ? "vi" : "en";
  const map = BY_LOCALE[loc];
  return map[type ?? "other"] ?? map.other;
}
