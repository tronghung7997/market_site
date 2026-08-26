/**
 * Build the FastAPI URL for a BFF catch-all proxy hop.
 *
 * Rejects traversal, encoded separators, and `/internal/*` before the
 * upstream request is created. HMAC signing and the session cookie are
 * applied by the caller after this returns.
 */
export function buildUpstreamTarget(
  segments: string[],
  apiBase: string,
): { path: string; target: URL } | null {
  const normalizedSegments: string[] = [];
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      decoded === "."
      || decoded === ".."
      || decoded.includes("/")
      || decoded.includes("\\")
      || decoded.includes("\0")
      || decoded.includes("%")
    ) {
      return null;
    }
    normalizedSegments.push(decoded);
  }

  const path = normalizedSegments.join("/");
  if (normalizedSegments[0] === "internal") return null;

  const base = new URL(`${apiBase.replace(/\/+$/, "")}/`);
  const target = new URL(normalizedSegments.map(encodeURIComponent).join("/"), base);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
    return null;
  }
  return { path, target };
}
