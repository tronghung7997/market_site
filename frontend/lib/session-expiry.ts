/**
 * Return the login URL used after an authenticated request reports an expired
 * session. A null result means the current page should remain visible.
 */
export function sessionExpiryRedirect(pathname: string): string | null {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const protectedRoots = ["/orders", "/wallet", "/affiliate", "/seller", "/admin"];
  const requiresAccount = protectedRoots.some(
    (root) => normalizedPath === root || normalizedPath.startsWith(`${root}/`),
  );

  if (!requiresAccount || normalizedPath === "/admin/login") return null;

  const loginPath = normalizedPath.startsWith("/admin") ? "/admin/login" : "/login";
  return `${loginPath}?expired=1&next=${encodeURIComponent(pathname)}`;
}
