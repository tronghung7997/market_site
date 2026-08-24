/** Allowlisted product covers. Backend stores only the id; files live in /public/covers. */

export const COVER_IDS = [
  "facebook",
  "instagram",
  "tiktok",
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

export function coverSrc(coverId: string | null | undefined): string | null {
  return isCoverId(coverId) ? `/covers/${coverId}.svg` : null;
}
