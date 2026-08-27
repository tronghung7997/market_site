/** Allowlisted product covers. Backend stores only the id; files live in /public/covers. */

export const COVER_IDS = [
  "facebook",
  "instagram",
  "tiktok",
  "telegram",
  "youtube",
  "x",
  "proxy",
  "token",
  "endpoint",
  "cloud",
  "payment",
  "takedown",
  "account",
  "other",
] as const;

export type CoverId = (typeof COVER_IDS)[number];

const COVER_ID_SET = new Set<string>(COVER_IDS);

export function isCoverId(value: unknown): value is CoverId {
  return typeof value === "string" && COVER_ID_SET.has(value);
}

export function parseCoverId(source: unknown): CoverId | null {
  if (isCoverId(source)) return source;
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  if (isCoverId(record.cover_id)) return record.cover_id;
  if (isCoverId(record.image)) return record.image;
  if (record.images && typeof record.images === "object" && !Array.isArray(record.images)) {
    const nested = (record.images as Record<string, unknown>).cover_id;
    if (isCoverId(nested)) return nested;
  }
  return null;
}

export function inferCoverFromText(text: string | null | undefined): CoverId | null {
  if (!text) return null;
  const s = text.toLowerCase();
  if (s.includes("facebook") || s.includes("fb ") || s.includes("fb cổ") || s.includes("via fb")) return "facebook";
  if (s.includes("instagram") || s.includes("insta") || s.includes("ig ")) return "instagram";
  if (s.includes("tiktok") || s.includes("douyin")) return "tiktok";
  if (s.includes("telegram")) return "telegram";
  if (s.includes("youtube") || s.includes("ytb")) return "youtube";
  if (s.includes("twitter") || s.includes(" x ") || s.startsWith("x ") || s.includes(" x cổ") || s.includes("x/twitter") || s.includes("x (twitter)")) return "x";
  if (s.includes("proxy") || s.includes("vpn") || s.includes("ipv4") || s.includes("ipv6") || s.includes("socks5") || s.includes("dproxy") || s.includes("topproxy")) return "proxy";
  if (s.includes("token") || s.includes("api key") || s.includes("chatgpt") || s.includes("openai") || s.includes("claude") || s.includes("gemini")) return "token";
  if (s.includes("endpoint") || s.includes("api") || s.includes("webhook") || s.includes("scrape") || s.includes("scrapecreators")) return "endpoint";
  if (s.includes("cloud") || s.includes("vps") || s.includes("aws") || s.includes("azure") || s.includes("server")) return "cloud";
  if (s.includes("payment") || s.includes("visa") || s.includes("mastercard") || s.includes("thanh toán") || s.includes("thẻ")) return "payment";
  if (s.includes("takedown") || s.includes("report") || s.includes("dmca") || s.includes("gỡ bài") || s.includes("rip")) return "takedown";
  if (s.includes("mạng xã hội") || s.includes("social")) return "account";
  if (s.includes("account") || s.includes("tài khoản") || s.includes("acc") || s.includes("clone") || s.includes("via") || s.includes("mail") || s.includes("gmail") || s.includes("netflix") || s.includes("spotify")) return "account";
  return null;
}

export function inferCoverId(source: unknown, title?: string): CoverId {
  const parsed = parseCoverId(source);
  if (parsed) return parsed;
  if (source && typeof source === "object") {
    const record = source as Record<string, unknown>;
    const st = typeof record.service_type === "string" ? record.service_type : null;
    if (isCoverId(st)) return st;
    const cat = typeof record.category === "string" ? record.category : null;
    const fromCat = inferCoverFromText(cat);
    if (fromCat) return fromCat;
    const t = typeof record.title === "string" ? record.title : title;
    const fromTitle = inferCoverFromText(t);
    if (fromTitle) return fromTitle;
  }
  const fromTitle = inferCoverFromText(title);
  if (fromTitle) return fromTitle;
  return "other";
}

export const COVER_GROUPS = {
  social: ["facebook", "instagram", "tiktok", "telegram", "youtube", "x"],
  infra: ["proxy", "token", "endpoint", "cloud"],
  service: ["payment", "takedown", "account", "other"],
} as const satisfies Record<string, readonly CoverId[]>;

export const COVER_LABELS: Record<CoverId, { vi: string; en: string }> = {
  facebook: { vi: "Facebook", en: "Facebook" },
  instagram: { vi: "Instagram", en: "Instagram" },
  tiktok: { vi: "TikTok", en: "TikTok" },
  telegram: { vi: "Telegram", en: "Telegram" },
  youtube: { vi: "YouTube", en: "YouTube" },
  x: { vi: "X", en: "X" },
  proxy: { vi: "Proxy", en: "Proxy" },
  token: { vi: "Token", en: "Token" },
  endpoint: { vi: "API / Endpoint", en: "API / Endpoint" },
  cloud: { vi: "Cloud", en: "Cloud" },
  payment: { vi: "Thanh toán", en: "Payment" },
  takedown: { vi: "Takedown", en: "Takedown" },
  account: { vi: "Tài khoản", en: "Account" },
  other: { vi: "Khác", en: "Other" },
};

export function categoryCoverId(category: {
  icon?: string | null;
  name?: string | null;
  slug?: string | null;
}): CoverId {
  if (isCoverId(category.icon)) return category.icon;
  return inferCoverFromText(`${category.name ?? ""} ${category.slug ?? ""}`) ?? "other";
}

export function coverSrc(coverId: string | null | undefined): string | null {
  return isCoverId(coverId) ? `/covers/${coverId}.svg` : null;
}
