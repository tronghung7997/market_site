/** Browser → BFF diagnostics (`POST /api/client-events`, logged to the shared
 *  log stream by `app/api/client-events/route.ts`). Only what explains a stuck
 *  navigation: route paths without query or hash, timings and coarse browser
 *  state — never URLs with parameters, cookies, form data or user ids. Shared
 *  by the browser (builds the event) and the route (validates it). */

export const CLIENT_EVENTS_PATH = "/api/client-events";
/** Larger bodies are refused unread; a nav-stall event is ~300 bytes. */
export const CLIENT_EVENT_MAX_BYTES = 2048;

export type NavType = "push" | "replace" | "traverse";

/** Why the progress bar gave up on the soft navigation: it ran past the stall
 *  timeout, or the visitor clicked the same link again while it was pending. */
export type NavStallReason = "timeout" | "retry";

export type NavStallEvent = {
  kind: "nav_stall";
  reason: NavStallReason;
  nav_type: NavType;
  from_path: string;
  to_path: string;
  /** Since the navigation started. */
  elapsed_ms: number;
  /** "pending": the RSC request never completed (network/origin hang);
   *  "done": it completed but the page never committed (client side). */
  rsc_state: "pending" | "done";
  rsc_status?: number;
  rsc_ms?: number;
  /** Time since this document loaded: a tab older than the last deploy runs
   *  the previous build. */
  page_age_ms: number;
  visible: boolean;
  online: boolean;
  /** `navigator.connection.effectiveType` where the browser exposes it. */
  net?: string;
};

export type ClientEventFields = Record<string, string | number | boolean>;

const REASONS = new Set<NavStallReason>(["timeout", "retry"]);
const NAV_TYPES = new Set<NavType>(["push", "replace", "traverse"]);
const RSC_STATES = new Set(["pending", "done"]);
const PATH_RE = /^\/[^\s?#]{0,200}$/;
const NET_RE = /^[a-z0-9-]{1,12}$/;
const MAX_MS = 24 * 60 * 60 * 1000;

function path(value: unknown): string | null {
  return typeof value === "string" && PATH_RE.test(value) ? value : null;
}

function ms(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), MAX_MS)
    : null;
}

/** Validated, log-ready fields for a client event; null for anything that is
 *  not a well-formed event of a known kind. */
export function parseClientEvent(raw: unknown): ClientEventFields | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (e.kind !== "nav_stall") return null;
  const fromPath = path(e.from_path);
  const toPath = path(e.to_path);
  const elapsed = ms(e.elapsed_ms);
  const pageAge = ms(e.page_age_ms);
  if (
    !REASONS.has(e.reason as NavStallReason)
    || !NAV_TYPES.has(e.nav_type as NavType)
    || !RSC_STATES.has(e.rsc_state as string)
    || fromPath === null || toPath === null || elapsed === null || pageAge === null
    || typeof e.visible !== "boolean" || typeof e.online !== "boolean"
  ) {
    return null;
  }
  const fields: ClientEventFields = {
    reason: e.reason as string,
    nav_type: e.nav_type as string,
    from_path: fromPath,
    to_path: toPath,
    elapsed_ms: elapsed,
    rsc_state: e.rsc_state as string,
    page_age_ms: pageAge,
    visible: e.visible,
    online: e.online,
  };
  if (Number.isInteger(e.rsc_status) && (e.rsc_status as number) >= 0 && (e.rsc_status as number) < 600) {
    fields.rsc_status = e.rsc_status as number;
  }
  const rscMs = ms(e.rsc_ms);
  if (rscMs !== null) fields.rsc_ms = rscMs;
  if (typeof e.net === "string" && NET_RE.test(e.net)) fields.net = e.net;
  return fields;
}

/** Fire-and-forget delivery that survives the page unloading right after
 *  (the stall recovery hard-navigates next). Never throws. */
export function sendClientEvent(event: NavStallEvent): void {
  try {
    const body = JSON.stringify(event);
    if (navigator.sendBeacon?.(CLIENT_EVENTS_PATH, new Blob([body], { type: "application/json" }))) return;
    void fetch(CLIENT_EVENTS_PATH, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    }).catch(() => {});
  } catch {
    // Diagnostics must never get in the way of the recovery.
  }
}
