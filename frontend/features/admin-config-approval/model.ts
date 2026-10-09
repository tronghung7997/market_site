// Two-step approval for admin settings: pure helpers (node-testable).
import type { ConfigChangeQueued, ConfigChangeStatus, ConfigSaved } from "../../lib/types.ts";

/** A settings save answered 202: the change waits for a second admin. */
export function isQueued<T, C>(result: ConfigSaved<T, C>): result is ConfigChangeQueued<C> {
  return typeof result === "object" && result !== null
    && (result as { status?: unknown }).status === "pending_approval"
    && typeof (result as { request?: unknown }).request === "object";
}

/** The section as it is now, whether the save applied or was queued. */
export function savedConfig<T, C>(result: ConfigSaved<T, C>): T | C {
  return isQueued(result) ? result.config : result;
}

export const REASON_MIN = 3;

export function reasonOk(reason: string): boolean {
  return reason.trim().length >= REASON_MIN;
}

export const STATUS_TONE: Record<ConfigChangeStatus, "warn" | "good" | "bad" | "neutral"> = {
  pending: "warn",
  approved: "good",
  rejected: "bad",
  cancelled: "neutral",
  superseded: "neutral",
  expired: "neutral",
};

/** "a@x.com" or the display name when there is one. */
export function personLabel(p: { email: string; name: string | null } | null): string {
  if (!p) return "—";
  return p.name ? `${p.name} (${p.email})` : p.email;
}
