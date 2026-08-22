export function safeInternalRedirect(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\0\r\n]/.test(value)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\0\r\n]/.test(decoded)) {
    return null;
  }

  const base = new URL("https://marketplace.invalid/");
  const target = new URL(value, base);
  if (target.origin !== base.origin) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}
