/** Pure helpers for the Facebook ID finder. Shared by the BFF route (server)
 *  and the page (client) so the "what will be looked up" preview the user sees
 *  is exactly what the provider receives. No I/O here. */

export type FacebookTargetKind = "username" | "numeric" | "profile" | "page" | "group" | "people" | "link";

export interface FacebookTarget {
  /** Canonical URL sent to the provider. */
  url: string;
  /** Short human label, e.g. `zuck`, `profile.php?id=1000…`, `groups/abc`. */
  handle: string;
  kind: FacebookTargetKind;
}

const FB_HOSTS = new Set(["facebook.com", "fb.com", "fb.me", "fb.watch", "messenger.com"]);
const CANONICAL = "https://www.facebook.com";
/** First path segments that are never a username. */
const RESERVED = new Set([
  "profile.php", "people", "pages", "groups", "events", "photo", "photo.php", "photos", "video", "videos", "watch", "reel", "reels",
  "share", "story.php", "permalink.php", "posts", "marketplace", "gaming", "login", "login.php", "home.php", "hashtag", "search",
  "stories", "help", "policies", "privacy", "settings", "messages", "notifications", "friends", "media", "l.php", "dialog", "plugins",
]);
/** Sub-paths under a username that still point at the owner (post/photo links). */
const OWNER_SUBPATHS = new Set(["posts", "photos", "videos", "about", "friends", "reels", "reviews", "events", "community", "mentions", "photos_by", "map", "live", "services", "shop", "music"]);

const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.]{0,62})[A-Za-z0-9]$/;
const NUMERIC_RE = /^\d{5,20}$/;

function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (FB_HOSTS.has(host)) return true;
  return [...FB_HOSTS].some((root) => host.endsWith(`.${root}`));
}

function facebookUrl(candidate: string): URL | null {
  try {
    const url = new URL(candidate);
    return isFacebookHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Accepts full links, scheme-less hosts (`m.facebook.com/x`) and bare
 *  facebook paths (`groups/x`, `profile.php?id=1`) — the last form is what the
 *  page writes into its shareable `?q=`. */
function parseUrl(input: string): URL | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return facebookUrl(input);
  const head = input.split(/[/?#]/, 1)[0].toLowerCase();
  const looksLikeHost = head.includes(".") && !RESERVED.has(head);
  return (looksLikeHost && facebookUrl(`https://${input}`)) || facebookUrl(`${CANONICAL}/${input.replace(/^\/+/, "")}`);
}

/** Short, round-trippable form of a target for URLs: the path under
 *  facebook.com, or the full link for short links on other hosts. */
export function facebookShortQuery(target: FacebookTarget): string {
  return target.url.startsWith(`${CANONICAL}/`) ? target.url.slice(CANONICAL.length + 1) : target.url;
}

function segments(url: URL): string[] {
  return url.pathname.split("/").map((s) => s.trim()).filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
}

/** Turns whatever the user pasted (username, @username, numeric ID, any
 *  facebook.com / fb.com / fb.me link — profile, page, group, post, photo)
 *  into the canonical owner URL, or `null` when it cannot be a Facebook target. */
export function normalizeFacebookTarget(raw: string): FacebookTarget | null {
  const input = raw.trim();
  if (!input || /\s/.test(input)) return null;

  const bare = input.replace(/^@/, "");
  if (NUMERIC_RE.test(bare)) return { url: `${CANONICAL}/${bare}`, handle: bare, kind: "numeric" };
  if (!bare.includes("/") && !bare.includes(".com") && USERNAME_RE.test(bare)) {
    return { url: `${CANONICAL}/${bare}`, handle: bare, kind: "username" };
  }

  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const parts = segments(url);

  // Short links (fb.me/xyz, fb.watch/…) and /share/… are resolved upstream.
  if (host === "fb.me" || host.endsWith(".fb.me") || host === "fb.watch" || host.endsWith(".fb.watch") || parts[0] === "share") {
    if (parts.length === 0) return null;
    const clean = new URL(url.href);
    clean.search = "";
    clean.hash = "";
    return { url: clean.href, handle: `${host}/${parts.join("/")}`, kind: "link" };
  }

  if (parts.length === 0) return null;
  const head = parts[0].toLowerCase();

  // profile.php?id=… and any post/photo/story page that carries the owner id.
  if (head.endsWith(".php") || head === "photo") {
    const id = url.searchParams.get("id") ?? url.searchParams.get("owner_id") ?? url.searchParams.get("profile_id");
    if (id && NUMERIC_RE.test(id)) {
      return { url: `${CANONICAL}/profile.php?id=${id}`, handle: `profile.php?id=${id}`, kind: "profile" };
    }
    if (head === "photo" && parts[1] && NUMERIC_RE.test(parts[1])) return { url: `${CANONICAL}/${parts[1]}`, handle: parts[1], kind: "numeric" };
    return null;
  }

  if (head === "groups" && parts[1]) {
    const slug = parts[1];
    return { url: `${CANONICAL}/groups/${slug}`, handle: `groups/${slug}`, kind: "group" };
  }
  if (head === "people" && parts[2] && NUMERIC_RE.test(parts[2])) {
    return { url: `${CANONICAL}/people/${encodeURIComponent(parts[1])}/${parts[2]}/`, handle: `people/…/${parts[2]}`, kind: "people" };
  }
  if (head === "pages") {
    const id = [...parts].reverse().find((p) => NUMERIC_RE.test(p));
    if (id) return { url: `${CANONICAL}/${id}`, handle: id, kind: "page" };
    if (parts[1]) return { url: `${CANONICAL}/pages/${parts.slice(1).map(encodeURIComponent).join("/")}`, handle: `pages/${parts[1]}`, kind: "page" };
    return null;
  }
  if (RESERVED.has(head)) return null;

  // /<username>[/posts/…] → owner. Numeric first segment is a raw id.
  if (NUMERIC_RE.test(parts[0])) return { url: `${CANONICAL}/${parts[0]}`, handle: parts[0], kind: "numeric" };
  if (!USERNAME_RE.test(parts[0])) return null;
  if (parts[1] && !OWNER_SUBPATHS.has(parts[1].toLowerCase())) return null;
  return { url: `${CANONICAL}/${parts[0]}`, handle: parts[0], kind: "username" };
}

export type FacebookEntityType = "Profile" | "Page" | "Group" | "Event" | "Unknown";

export function facebookEntityType(value: unknown): FacebookEntityType {
  if (typeof value !== "string") return "Unknown";
  const v = value.trim().toLowerCase();
  if (v === "profile" || v === "user") return "Profile";
  if (v === "page") return "Page";
  if (v === "group") return "Group";
  if (v === "event") return "Event";
  return "Unknown";
}

/** Permanent link that survives username changes. */
export function facebookIdLink(id: string, type: FacebookEntityType): string {
  if (type === "Group") return `${CANONICAL}/groups/${id}`;
  if (type === "Profile") return `${CANONICAL}/profile.php?id=${id}`;
  return `${CANONICAL}/${id}`;
}
