import type { FacebookEntityType, FacebookLookupResponse } from "@/lib/types";

export const RECENT_LIMIT = 6;
export const RECENT_STORAGE_KEY = "gmmo.facebook-lookup.recent";

/** One remembered lookup — enough to re-run it and to show who it was. */
export interface RecentLookup {
  input: string;
  id: string;
  name: string | null;
  type: FacebookEntityType;
  at: string;
}

export function rememberLookup(list: RecentLookup[], result: FacebookLookupResponse): RecentLookup[] {
  const entry: RecentLookup = {
    input: result.query.input,
    id: result.entity.id,
    name: result.entity.name,
    type: result.entity.type,
    at: result.meta.fetched_at,
  };
  return [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, RECENT_LIMIT);
}

export function parseRecent(raw: string | null): RecentLookup[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentLookup =>
      item && typeof item === "object" && typeof item.input === "string" && typeof item.id === "string" && typeof item.at === "string",
    ).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/** Facts shown under the entity header; only the ones the provider filled in. */
export type EntityFact = { key: "likes" | "members" | "privacy" | "oldPageId"; value: string };

export function entityFacts(entity: FacebookLookupResponse["entity"], locale: string): EntityFact[] {
  const n = (v: number) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const facts: EntityFact[] = [];
  if (entity.likes != null) facts.push({ key: "likes", value: n(entity.likes) });
  if (entity.members != null) facts.push({ key: "members", value: n(entity.members) });
  if (entity.privacy) facts.push({ key: "privacy", value: entity.privacy });
  if (entity.old_page_id) facts.push({ key: "oldPageId", value: entity.old_page_id });
  return facts;
}
