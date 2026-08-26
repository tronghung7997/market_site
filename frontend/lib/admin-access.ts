import { isIP } from "node:net";

function normalizeIp(raw: string | null | undefined): string | null {
  let candidate = raw?.trim().replace(/^"|"$/g, "") ?? "";
  if (!candidate) return null;

  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]");
    if (end > 0) candidate = candidate.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const mapped = candidate.slice(7);
    if (isIP(mapped) === 4) candidate = mapped;
  }
  const version = isIP(candidate);
  if (version === 6) {
    try {
      // WHATWG hostname is already unbracketed (`::1`), not `[::1]`.
      return new URL(`http://[${candidate}]/`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return version === 4 ? candidate : null;
}

function configuredAdminIps(): Set<string> | null {
  const raw = process.env.ADMIN_ALLOWED_IPS?.trim();
  if (!raw) return new Set();

  const addresses = new Set<string>();
  for (const entry of raw.split(",")) {
    if (!entry.trim()) continue;
    const address = normalizeIp(entry);
    if (!address) return null;
    addresses.add(address);
  }
  return addresses;
}

function clientIpFromHeaders(headers: Headers): string | null {
  const headerName = (process.env.ADMIN_CLIENT_IP_HEADER || "x-real-ip").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(headerName)) return null;
  const raw = headers.get(headerName);
  if (!raw) return null;
  if (headerName === "x-forwarded-for") {
    const hops = raw.split(",").map((part) => part.trim()).filter(Boolean);
    return normalizeIp(hops.at(-1) ?? null);
  }
  return normalizeIp(raw.split(",", 1)[0]);
}

export function adminRequestAllowed(headers: Headers): boolean {
  const allowed = configuredAdminIps();
  if (!allowed) return false;
  if (allowed.size === 0) return true;

  const clientIp = clientIpFromHeaders(headers);
  return clientIp !== null && allowed.has(clientIp);
}

export function isAdminPagePath(pathname: string, locales: readonly string[]): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "admin" || (locales.includes(parts[0]) && parts[1] === "admin");
}

export function isAdminApiPath(path: string): boolean {
  return path === "auth/admin/login" || path === "admin" || path.startsWith("admin/");
}
