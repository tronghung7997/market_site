/**
 * Buyer proxy console — domain model, filters ↔ URL, display mapping and
 * bulk-result aggregation. Pure: no React, no network, loadable by the node
 * test runner.
 *
 * A `ProxyLine` is one delivered proxy (`GET /me/proxies`, one
 * `proxy_allocations` row, public id `ORD-XXXXXXXX#01`). Filtering, sorting
 * and paging happen on the server; this module only maps the URL onto that
 * query. The buyer never sees which upstream source produced a line: the wire
 * type has no provider field and nothing here derives one.
 */
import type {
  ProxyIpType, ProxyLine, ProxyLineQuery, ProxyLineSummary, ProxyRotation, ProxyTag, ProxyTagTone,
} from "@/lib/types";
// Relative so the model stays loadable by the node test runner (no path alias there).
import { lineLabel } from "../../lib/order-ref.ts";

export type { ProxyIpType, ProxyLine, ProxyLineSummary, ProxyRotation, ProxyTag };
export type TagTone = ProxyTagTone;

export const IP_TYPES = ["residential", "mobile", "datacenter"] as const satisfies readonly ProxyIpType[];
export const ROTATIONS = ["static", "rotating", "rotating_key"] as const satisfies readonly ProxyRotation[];
export const TAG_TONES: TagTone[] = ["iris", "good", "warn", "neutral", "ink"];

/* ---------------------------------------------------------------- filters */

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

/** `""` = all. `running` = allocated; `soon` = allocated and expiring within 3 days; `problem` = offline | error | expired. */
export const STATUS_TABS = ["", "running", "soon", "problem"] as const;
export type StatusTab = (typeof STATUS_TABS)[number];

export const EXPIRY_FILTERS = ["", "24h", "3d", "7d", "expired"] as const;
export type ExpiryFilter = (typeof EXPIRY_FILTERS)[number];

export const PROXY_SORTS = ["expiry_asc", "expiry_desc", "newest", "line"] as const;
export type ProxySort = (typeof PROXY_SORTS)[number];

export interface ProxyFilters {
  tab: StatusTab;
  search: string;
  /** Tag ids; `__none__` selects untagged lines. */
  tags: string[];
  ipTypes: ProxyIpType[];
  rotations: ProxyRotation[];
  expiry: ExpiryFilter;
  sort: ProxySort;
  page: number;
  perPage: number;
}

export const UNTAGGED = "__none__";

export const DEFAULT_FILTERS: ProxyFilters = {
  tab: "", search: "", tags: [], ipTypes: [], rotations: [], expiry: "", sort: "expiry_asc", page: 1, perPage: DEFAULT_PAGE_SIZE,
};

function listParam<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  const out: T[] = [];
  for (const part of (raw ?? "").split(",")) {
    const v = part.trim() as T;
    if (allowed.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** URL params use the API's own names (`status`, `q`, `tags`, `ip_type`,
 *  `rotation`, `expires`, `sort`, `page`, `per_page`), so a shared link and
 *  the request it triggers read the same. Unknown values fall back to defaults. */
export function parseProxyFilters(search: URLSearchParams): ProxyFilters {
  const tab = search.get("status") ?? "";
  const expiry = search.get("expires") ?? "";
  const sort = search.get("sort") ?? "";
  const page = Number(search.get("page"));
  const perPage = Number(search.get("per_page"));
  const tags = [...new Set((search.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  return {
    tab: (STATUS_TABS as readonly string[]).includes(tab) ? (tab as StatusTab) : "",
    search: (search.get("q") ?? "").trim(),
    tags,
    ipTypes: listParam(search.get("ip_type"), IP_TYPES),
    rotations: listParam(search.get("rotation"), ROTATIONS),
    expiry: (EXPIRY_FILTERS as readonly string[]).includes(expiry) ? (expiry as ExpiryFilter) : "",
    sort: (PROXY_SORTS as readonly string[]).includes(sort) ? (sort as ProxySort) : "expiry_asc",
    page: Number.isInteger(page) && page > 1 ? page : 1,
    perPage: (PAGE_SIZES as readonly number[]).includes(perPage) ? perPage : DEFAULT_PAGE_SIZE,
  };
}

/** Filters → `?query`. Defaults are dropped; the open line (`?line=`) is kept from `keep`. */
export function proxyFiltersToSearch(f: ProxyFilters, keep?: URLSearchParams): string {
  const q = new URLSearchParams();
  const line = keep?.get("line");
  if (line) q.set("line", line);
  if (f.tab) q.set("status", f.tab);
  if (f.search.trim()) q.set("q", f.search.trim());
  if (f.tags.length) q.set("tags", f.tags.join(","));
  if (f.ipTypes.length) q.set("ip_type", f.ipTypes.join(","));
  if (f.rotations.length) q.set("rotation", f.rotations.join(","));
  if (f.expiry) q.set("expires", f.expiry);
  if (f.sort !== "expiry_asc") q.set("sort", f.sort);
  if (f.page > 1) q.set("page", String(f.page));
  if (f.perPage !== DEFAULT_PAGE_SIZE) q.set("per_page", String(f.perPage));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Filters → `GET /me/proxies` query. Sort and paging are always explicit so
 *  the cache key is stable whatever the URL omitted. */
export function proxyFiltersToQuery(f: ProxyFilters): ProxyLineQuery {
  const query: ProxyLineQuery = { sort: f.sort, page: f.page, per_page: f.perPage };
  if (f.tab) query.status = f.tab;
  if (f.search.trim()) query.q = f.search.trim();
  if (f.tags.length) query.tags = f.tags;
  if (f.ipTypes.length) query.ip_type = f.ipTypes;
  if (f.rotations.length) query.rotation = f.rotations;
  if (f.expiry) query.expires = f.expiry;
  return query;
}

export function hasActiveProxyFilters(f: ProxyFilters): boolean {
  return Boolean(f.tab || f.search.trim() || f.tags.length || f.ipTypes.length || f.rotations.length || f.expiry);
}

/** `ORD-XXXXXXXX#01` → `ORD-XXXXXXXX`; null when the id is not a line id. */
export function lineOrderCode(lineId: string | null | undefined): string | null {
  const m = /^(ORD-[0-9A-Z]+)#\d+$/.exec((lineId ?? "").trim());
  return m ? m[1] : null;
}

/* ---------------------------------------------------------------- display */

/** i18n key under `buyerProxies.kind.*`, composed from the two dimensions:
 *  a rotating key reads as a key whatever its IP type; mobile and datacenter
 *  read by IP type alone; residential splits into static / rotating. */
export type ProxyKindLabel = "residential_static" | "residential_rotating" | "mobile" | "datacenter" | "rotating_key";

export function proxyKindLabel(line: Pick<ProxyLine, "ip_type" | "rotation">): ProxyKindLabel {
  if (line.rotation === "rotating_key") return "rotating_key";
  if (line.ip_type === "mobile") return "mobile";
  if (line.ip_type === "datacenter") return "datacenter";
  return line.rotation === "rotating" ? "residential_rotating" : "residential_static";
}

/** `#01` — the line inside its order, 1-based. */
export function lineNoLabel(line: Pick<ProxyLine, "line_no">): string {
  return lineLabel(line.line_no);
}

/** "Viettel · VN" / "Việt Nam" — network with the country code when it adds information. */
export function locationLabel(line: Pick<ProxyLine, "network" | "country">): string {
  const parts = [line.network?.trim(), line.country?.trim()].filter((p): p is string => Boolean(p));
  const unique = parts.filter((p, i) => parts.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i);
  return unique.join(" · ");
}

/* ---------------------------------------------------------------- derived */

const DAY = 86_400_000;

export function daysLeft(line: Pick<ProxyLine, "expires_at">, now = Date.now()): number {
  return (new Date(line.expires_at).getTime() - now) / DAY;
}

export function isExpired(line: Pick<ProxyLine, "expires_at" | "status">, now = Date.now()): boolean {
  return line.status === "expired" || line.status === "released" || new Date(line.expires_at).getTime() <= now;
}

/** Buyer-facing state: the backend status folded with the expiry clock
 *  (same buckets as the server's `status` tabs). */
export type LineState = "running" | "soon" | "offline" | "expired" | "error";

export function lineState(line: Pick<ProxyLine, "expires_at" | "status">, now = Date.now()): LineState {
  if (line.status === "error") return "error";
  if (isExpired(line, now)) return "expired";
  if (line.status === "offline") return "offline";
  return daysLeft(line, now) <= 3 ? "soon" : "running";
}

export function cooldownRemaining(line: Pick<ProxyLine, "cooldown_seconds" | "last_rotated_at">, now = Date.now()): number {
  if (!line.cooldown_seconds || !line.last_rotated_at) return 0;
  const elapsed = (now - new Date(line.last_rotated_at).getTime()) / 1000;
  return Math.max(0, Math.ceil(line.cooldown_seconds - elapsed));
}

export function canRotate(line: ProxyLine, now = Date.now()): boolean {
  const state = lineState(line, now);
  return line.rotation_available && state !== "expired" && state !== "error";
}

/** A rotating key that has not fetched its first proxy yet has no address. */
export function hasAddress(line: Pick<ProxyLine, "host" | "port">): boolean {
  return Boolean(line.host) && line.port > 0;
}

/** `host:port:user:pass` — the string every proxy tool accepts. */
export function connectionString(line: Pick<ProxyLine, "host" | "port" | "username" | "password">): string {
  const base = `${line.host}:${line.port}`;
  return line.username && line.password ? `${base}:${line.username}:${line.password}` : base;
}

/** Share of all lines that are running, for the summary strip (0–100). */
export function runningShare(summary: ProxyLineSummary): number {
  return summary.all ? Math.round((summary.running / summary.all) * 100) : 0;
}

/* ------------------------------------------------------------ bulk actions */

export type SkipReason = "cooldown" | "unsupported" | "expired" | "failed";
export type LineOutcome = "ok" | SkipReason;

export interface BulkResult {
  ok: string[];
  skipped: { id: string; reason: SkipReason }[];
}

export interface BulkCounts { ok: number; skipped: number; cooldown: number; unsupported: number; expired: number; failed: number }

export function bulkCounts(r: BulkResult): BulkCounts {
  const c: BulkCounts = { ok: r.ok.length, skipped: r.skipped.length, cooldown: 0, unsupported: 0, expired: 0, failed: 0 };
  for (const s of r.skipped) c[s.reason] += 1;
  return c;
}

/** Why a line is left out of a rotate before any request is sent; null = send it. */
export function rotateSkipReason(line: ProxyLine, now = Date.now()): SkipReason | null {
  if (!line.rotation_available) return "unsupported";
  const state = lineState(line, now);
  if (state === "expired") return "expired";
  if (state === "error") return "failed";
  if (cooldownRemaining(line, now) > 0) return "cooldown";
  return null;
}

/** Only lines whose source enforces an IP allow-list take a whitelist. */
export function whitelistSkipReason(line: ProxyLine): SkipReason | null {
  return line.whitelist_supported ? null : "unsupported";
}

/** A rejected rotate: 429 is the per-line cooldown, anything else a failure. */
export function rotateErrorOutcome(error: unknown): SkipReason {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  return status === 429 ? "cooldown" : "failed";
}

/** Run `worker` over the lines with bounded concurrency. `precheck` skips a
 *  line without a request; a thrown worker counts as `failed`. Result order
 *  follows the input, not completion. */
export async function runBulk<T extends { id: string }>(
  items: T[],
  worker: (item: T) => Promise<LineOutcome>,
  opts: { precheck?: (item: T) => SkipReason | null; concurrency?: number; onProgress?: (done: number) => void } = {},
): Promise<BulkResult> {
  const outcomes: LineOutcome[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const step = () => { done += 1; opts.onProgress?.(done); };
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      const skip = opts.precheck?.(item) ?? null;
      if (skip) { outcomes[index] = skip; step(); continue; }
      try { outcomes[index] = await worker(item); } catch { outcomes[index] = "failed"; }
      step();
    }
  };
  const lanes = Math.max(1, Math.min(opts.concurrency ?? 4, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  const result: BulkResult = { ok: [], skipped: [] };
  items.forEach((item, i) => {
    const o = outcomes[i];
    if (o === "ok") result.ok.push(item.id);
    else result.skipped.push({ id: item.id, reason: o });
  });
  return result;
}

/* ---------------------------------------------------------------- export */

export const EXPORT_FORMATS = ["host_port_user_pass", "user_pass_at_host", "host_port", "csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function renderExport(lines: ProxyLine[], format: ExportFormat, tagName: (id: string) => string): string {
  if (format === "json") {
    return JSON.stringify(lines.map((l) => ({
      line: l.id, host: l.host, port: l.port, socks5_port: l.socks5_port, username: l.username, password: l.password, protocol: l.protocol,
      ip_type: l.ip_type, rotation: l.rotation, network: l.network, country: l.country, expires_at: l.expires_at,
      tags: l.tag_ids.map(tagName), note: l.note || null,
    })), null, 2);
  }
  if (format === "csv") {
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["line", "host", "port", "socks5_port", "username", "password", "protocol", "ip_type", "rotation", "network", "country", "expires_at", "tags", "note"];
    const rows = lines.map((l) => [
      l.id, l.host, l.port, l.socks5_port, l.username, l.password, l.protocol, l.ip_type, l.rotation, l.network, l.country, l.expires_at,
      l.tag_ids.map(tagName).join("|"), l.note,
    ].map(esc).join(","));
    return [head.join(","), ...rows].join("\n");
  }
  return lines.map((l) => {
    if (format === "host_port") return `${l.host}:${l.port}`;
    if (format === "user_pass_at_host") return l.username ? `${l.username}:${l.password}@${l.host}:${l.port}` : `${l.host}:${l.port}`;
    return connectionString(l);
  }).join("\n");
}

/* ---------------------------------------------------------------- tags + note */

export const MAX_TAG_NAME = 32;
export const MAX_NOTE = 200;

export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_NAME);
}

export function findTagByName(tags: ProxyTag[], name: string): ProxyTag | undefined {
  const key = normalizeTagName(name).toLowerCase();
  return key ? tags.find((t) => t.name.toLowerCase() === key) : undefined;
}

/** `host:port[,tag|tag]` or `host:port:user:pass,tag` lines → per-line tag names. */
export function parseTagImport(text: string): { key: string; tags: string[] }[] {
  const out: { key: string; tags: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [proxyPart, ...rest] = line.split(",");
    const [host, port] = proxyPart.trim().split(":");
    if (!host || !port) continue;
    const tags = rest.join(",").split("|").map(normalizeTagName).filter(Boolean);
    out.push({ key: `${host}:${port}`, tags });
  }
  return out;
}

/** Match parsed import rows against the account's lines by `host:port`.
 *  Rows that match nothing are counted, never silently dropped. */
export function matchTagImport(rows: { key: string; tags: string[] }[], lines: ProxyLine[]): { perLine: Map<string, string[]>; unknown: number } {
  const byKey = new Map(lines.map((l) => [`${l.host}:${l.port}`, l]));
  const perLine = new Map<string, string[]>();
  let unknown = 0;
  for (const row of rows) {
    const line = byKey.get(row.key);
    if (!line) { unknown += 1; continue; }
    perLine.set(line.id, row.tags);
  }
  return { perLine, unknown };
}

/** Invert per-line tag names into one assignment per tag (one request each),
 *  keyed case-insensitively and keeping the first spelling seen. */
export function groupImportByTag(perLine: Map<string, string[]>): { name: string; lineIds: string[] }[] {
  const groups = new Map<string, { name: string; lineIds: string[] }>();
  for (const [lineId, names] of perLine) {
    for (const raw of names) {
      const name = normalizeTagName(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      const g = groups.get(key) ?? { name, lineIds: [] };
      if (!g.lineIds.includes(lineId)) g.lineIds.push(lineId);
      groups.set(key, g);
    }
  }
  return [...groups.values()];
}
