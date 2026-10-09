/**
 * Link takedown — domain model. Pure: no React, no network, loadable by the
 * node test runner.
 *
 * One request = one link. The buyer pastes the link, picks the kind of
 * violation (`service`) and a warranty (24 h / 72 h) and may add a note. The
 * partner reviews and quotes a cost; our admin sets the buyer's price; the
 * buyer accepts (money is held in an ordinary order) or declines. Statuses come
 * from the backend (marketplace-svc/src/takedown/lifecycle.py):
 *
 *   review → quoted → started → processing → warranty (⇄ warranty_claim) → done
 *   failed · declined · rejected · cancelled end a request early.
 *
 * The buyer sees five steps, not eleven states: `stepStates` maps one onto the other.
 */
import type {
  TakedownAdminRequest, TakedownRequest, TakedownService, TakedownStatus, TakedownWarrantyHours,
} from "@/lib/types";

export type { TakedownAdminRequest, TakedownRequest, TakedownService, TakedownStatus, TakedownWarrantyHours };

export const SERVICES = ["article_copyright", "profile_impersonation", "profile_copyright", "group_copyright"] as const satisfies readonly TakedownService[];
export const WARRANTY_HOURS = [24, 72] as const satisfies readonly TakedownWarrantyHours[];

export const PLATFORMS = ["tiktok", "facebook", "instagram", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const TERMINAL: readonly TakedownStatus[] = ["done", "failed", "declined", "rejected", "cancelled"];

export function isTerminal(status: TakedownStatus): boolean {
  return TERMINAL.includes(status);
}

/* --------------------------------------------------------------- the link */

const HOSTS: [RegExp, Platform][] = [
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
];

/** Best-effort platform for the icon; null for anything else. Never a validation step. */
export function platformOf(raw: string): Platform | null {
  try {
    const text = raw.trim();
    const host = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase();
    return HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** An http(s) URL to open in a new tab, or null when the pasted text is not one (it is stored as typed either way). */
export function openableUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text || /\s/.test(text)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The link without scheme and `www.` — what a list cell shows. */
export function shortLink(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

export const NOTE_MAX = 1900;
export const URL_MAX = 2048;

/* ------------------------------------------------------------------ steps */

export const STEPS = ["quote", "payment", "processing", "warranty", "finished"] as const;
export type TakedownStep = (typeof STEPS)[number];
export type StepState = "done" | "current" | "waiting_you" | "failed" | "todo" | "closed";

type StepInput = Pick<TakedownRequest, "status" | "accepted_at" | "completed_at">;

/** Display state of each of the five steps for one request. */
export function stepStates(r: StepInput): StepState[] {
  const fill = (at: number, here: StepState, after: StepState = "todo"): StepState[] =>
    STEPS.map((_, i) => (i < at ? "done" : i === at ? here : after));
  switch (r.status) {
    case "review": return fill(0, "current");
    case "quoted": return fill(0, "waiting_you");
    case "started": return fill(1, "current");
    case "processing": return fill(2, "current");
    case "warranty": return fill(3, "current");
    case "warranty_claim": return fill(3, "current");
    case "done": return fill(5, "done");
    case "failed": return fill(r.completed_at ? 4 : 2, "failed", "closed");
    case "declined":
    case "rejected": return fill(0, "failed", "closed");
    case "cancelled": return fill(r.accepted_at ? 1 : 0, "failed", "closed");
  }
}

/* ----------------------------------------------------------- status view */

export type Tone = "good" | "warn" | "bad" | "iris" | "neutral";

/** Buckets for the list tabs and dashboard counters. */
export const BUCKETS = ["review", "quoted", "processing", "warranty", "finished"] as const;
export type Bucket = (typeof BUCKETS)[number];

export function bucketOf(status: TakedownStatus): Bucket {
  switch (status) {
    case "review": return "review";
    case "quoted": return "quoted";
    case "started": case "processing": return "processing";
    case "warranty": case "warranty_claim": return "warranty";
    default: return "finished";
  }
}

/** Message key (under `takedown.status`) and semantic tone. */
export function statusView(r: Pick<TakedownRequest, "status">): { key: string; tone: Tone } {
  switch (r.status) {
    case "review": return { key: "review", tone: "iris" };
    case "quoted": return { key: "quoted", tone: "warn" };
    case "started": return { key: "started", tone: "iris" };
    case "processing": return { key: "processing", tone: "iris" };
    case "warranty": return { key: "warranty", tone: "good" };
    case "warranty_claim": return { key: "warrantyClaim", tone: "warn" };
    case "done": return { key: "done", tone: "good" };
    case "failed": return { key: "failed", tone: "bad" };
    case "declined": return { key: "declined", tone: "neutral" };
    case "rejected": return { key: "rejected", tone: "neutral" };
    case "cancelled": return { key: "cancelled", tone: "neutral" };
  }
}

/** Whether the buyer has to act on the request now. */
export function needsBuyer(r: Pick<TakedownRequest, "status">): boolean {
  return r.status === "quoted";
}

/** States the buyer may still cancel (before work starts; a paid one is refunded). */
export function canCancel(r: Pick<TakedownRequest, "status">): boolean {
  return r.status === "review" || r.status === "quoted" || r.status === "started";
}

export function countByBucket(requests: Pick<TakedownRequest, "status">[]): Record<Bucket, number> {
  const counts = { review: 0, quoted: 0, processing: 0, warranty: 0, finished: 0 };
  for (const r of requests) counts[bucketOf(r.status)] += 1;
  return counts;
}

/** When the request entered its current state — "waiting since" in the admin console. */
export function stateSince(r: TakedownRequest): string {
  switch (r.status) {
    case "review": return r.created_at;
    case "quoted": return r.quoted_at ?? r.created_at;
    case "started": return r.accepted_at ?? r.created_at;
    case "processing": return r.processing_at ?? r.accepted_at ?? r.created_at;
    case "warranty": case "warranty_claim": return r.completed_at ?? r.created_at;
    default: return r.finished_at ?? r.created_at;
  }
}

/** Remaining warranty as h/m/s parts; null outside the warranty window. */
export function warrantyLeft(r: Pick<TakedownRequest, "status" | "warranty_until">, now: Date): { hours: number; minutes: number; seconds: number } | null {
  if ((r.status !== "warranty" && r.status !== "warranty_claim") || !r.warranty_until) return null;
  const ms = Math.max(0, new Date(r.warranty_until).getTime() - now.getTime());
  const total = Math.floor(ms / 1000);
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

/* ------------------------------------------------------------ pagination */

export const PAGE_SIZES = [10, 20, 50] as const;

export function parsePage(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function parsePerPage(value: string | null | undefined, fallback: number = PAGE_SIZES[1]): number {
  const n = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : fallback;
}

/** One page of `items`; a page past the end clamps to the last page. */
export function paginate<T>(items: T[], page: number, perPage: number): { rows: T[]; page: number; totalPages: number; total: number } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * perPage;
  return { rows: items.slice(start, start + perPage), page: current, totalPages, total };
}

/* ---------------------------------------------------------------- lists */

export type ListTab = "all" | Bucket;
export const LIST_TABS: ListTab[] = ["all", ...BUCKETS];

export function parseListTab(value: string | null | undefined): ListTab {
  return (LIST_TABS as string[]).includes(value ?? "") ? (value as ListTab) : "all";
}

function matches(r: TakedownRequest & { buyer_email?: string | null }, term: string): boolean {
  if (!term) return true;
  return r.code.toLowerCase().includes(term)
    || r.url.toLowerCase().includes(term)
    || (r.note ?? "").toLowerCase().includes(term)
    || (r.buyer_email ?? "").toLowerCase().includes(term);
}

/** Buyer list: tab + free-text search (code, link, note). */
export function filterRequests(requests: TakedownRequest[], tab: ListTab, search: string): TakedownRequest[] {
  const term = search.trim().toLowerCase();
  return requests.filter((r) => (tab === "all" || bucketOf(r.status) === tab) && matches(r, term));
}

/** Newest first, but anything waiting on the buyer floats to the top. */
export function sortRequests<T extends TakedownRequest>(requests: T[]): T[] {
  return [...requests].sort((a, b) => {
    const urgent = Number(needsBuyer(b)) - Number(needsBuyer(a));
    if (urgent) return urgent;
    return b.created_at.localeCompare(a.created_at);
  });
}

/* ---------------------------------------------------------- admin list */

export const ADMIN_SORTS = ["waiting", "newest", "oldest"] as const;
export type AdminSort = (typeof ADMIN_SORTS)[number];
export type PlatformFilter = "all" | Platform | "other";

export interface AdminFilters {
  tab: ListTab;
  platform: PlatformFilter;
  q: string;
  sort: AdminSort;
  page: number;
  perPage: number;
}

export const DEFAULT_ADMIN_FILTERS: AdminFilters = { tab: "review", platform: "all", q: "", sort: "waiting", page: 1, perPage: 20 };

type Params = { get(name: string): string | null };

export function parseAdminFilters(params: Params): AdminFilters {
  const platform = params.get("platform");
  const sort = params.get("sort");
  const tab = params.get("status");
  return {
    tab: tab === null ? DEFAULT_ADMIN_FILTERS.tab : parseListTab(tab),
    platform: platform === "other" || (PLATFORMS as readonly string[]).includes(platform ?? "") ? (platform as PlatformFilter) : "all",
    q: params.get("q") ?? "",
    sort: (ADMIN_SORTS as readonly string[]).includes(sort ?? "") ? (sort as AdminSort) : DEFAULT_ADMIN_FILTERS.sort,
    page: parsePage(params.get("page")),
    perPage: parsePerPage(params.get("per"), DEFAULT_ADMIN_FILTERS.perPage),
  };
}

/** Query string for the filters; defaults are left out so the plain URL stays clean. */
export function adminFiltersToSearch(f: AdminFilters): string {
  const sp = new URLSearchParams();
  if (f.tab !== DEFAULT_ADMIN_FILTERS.tab) sp.set("status", f.tab);
  if (f.platform !== "all") sp.set("platform", f.platform);
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.sort !== DEFAULT_ADMIN_FILTERS.sort) sp.set("sort", f.sort);
  if (f.page > 1) sp.set("page", String(f.page));
  if (f.perPage !== DEFAULT_ADMIN_FILTERS.perPage) sp.set("per", String(f.perPage));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Filter and sort for the admin table (status tab, platform, search incl. buyer email). */
export function applyAdminFilters<T extends TakedownRequest & { buyer_email?: string | null }>(
  requests: T[], f: Pick<AdminFilters, "tab" | "platform" | "q" | "sort">,
): T[] {
  const term = f.q.trim().toLowerCase();
  const rows = requests.filter((r) => {
    if (f.tab !== "all" && bucketOf(r.status) !== f.tab) return false;
    if (f.platform !== "all") {
      const p = platformOf(r.url);
      if (f.platform === "other" ? p !== null : p !== f.platform) return false;
    }
    return matches(r, term);
  });
  return rows.sort((a, b) => {
    if (f.sort === "newest") return b.created_at.localeCompare(a.created_at);
    if (f.sort === "oldest") return a.created_at.localeCompare(b.created_at);
    return stateSince(a).localeCompare(stateSince(b));
  });
}

/** `buyer@example.com` → `bu***@example.com` for list cells. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}***@${domain}`;
}
