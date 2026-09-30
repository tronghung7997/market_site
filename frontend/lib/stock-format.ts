/** Stock lines read under their batch's format (`UID|PASS|2FA`): the column
 *  names are the format's `|` fields, in order. Shared by the buyer's order
 *  view and the seller's stock console. */

const MASK = "••••••••";

/** A line's fields under the format's column names, or null when the line has
 *  another number of `|` fields than the format (it is then shown as it is).
 *  With `masked`, only the first field stays readable. */
export function labelledFields(raw: string, format: string, masked = false): { label: string; value: string }[] | null {
  const labels = format.split("|").map((label) => label.trim());
  const values = raw.split("|");
  if (values.length !== labels.length) return null;
  return labels.map((label, index) => ({
    label: label || `#${index + 1}`,
    value: masked && index > 0 && values[index] ? MASK : values[index],
  }));
}

/** A field long enough that it is summarised instead of printed in full. */
export const LONG_FIELD_CHARS = 160;

export interface CookieSummary {
  name: string;
  domain: string | null;
  /** Expiry as a date, or null for a session cookie. */
  expires: Date | null;
}

/** Cookies held in a field: a browser export (`{cookies:[…]}` or `[…]`, as
 *  from EditThisCookie/Cookie-Editor) or a `k=v; k2=v2` header. Null when the
 *  field is not cookies. Values are never part of the summary. */
export function parseCookies(raw: string): CookieSummary[] | null {
  const text = raw.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed as { cookies?: unknown })?.cookies;
      if (!Array.isArray(list) || list.length === 0) return null;
      const cookies = list
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string")
        .map((c) => {
          const exp = c.expirationDate ?? c.expires ?? c.expiry;
          const seconds = typeof exp === "number" ? exp : typeof exp === "string" ? Number(exp) : NaN;
          return {
            name: String(c.name),
            domain: typeof c.domain === "string" ? c.domain : null,
            expires: Number.isFinite(seconds) && seconds > 0 && !c.session ? new Date(seconds * (seconds > 1e11 ? 1 : 1000)) : null,
          };
        });
      return cookies.length > 0 ? cookies : null;
    } catch {
      return null;
    }
  }
  const pairs = text.split(/;\s*/).filter(Boolean);
  if (pairs.length < 2 || !pairs.every((pair) => /^[^=\s]+=/.test(pair))) return null;
  return pairs.map((pair) => ({ name: pair.slice(0, pair.indexOf("=")), domain: null, expires: null }));
}

const SESSION_COOKIE = /session|sid|token|auth|c_user|xs|login/i;

/** Login-bearing cookies first, then by name. */
export function isSessionCookie(name: string): boolean {
  return SESSION_COOKIE.test(name);
}
