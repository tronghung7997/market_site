/** Wallet math and dates for a purchase confirmation. Pure, so every order
 *  panel (catalog packages, proxy/API/task configurators) shows the same
 *  shortfall, top-up link and inspection deadline. */

/** How much the wallet is missing for `total`, or 0 when it covers it.
 *  `available` null = balance unknown (signed out / still loading). */
export function walletShortfall(total: number, available: number | null | undefined): number {
  if (available == null || !Number.isFinite(available)) return 0;
  return Math.max(0, Math.ceil(total - available));
}

/** Wallet page link that prefills the top-up amount and brings the buyer back. */
export function topUpHref(amount: number, returnPath: string): string {
  const q = new URLSearchParams({ amount: String(Math.max(0, Math.ceil(amount))) });
  if (returnPath.startsWith("/") && !returnPath.startsWith("//")) q.set("return", returnPath);
  return `/wallet?${q}`;
}

const HOUR_MS = 3_600_000;

/** When the inspection window of an order placed at `now` closes. Only known
 *  up front when delivery is instant; a manual delivery starts the clock
 *  when the shop delivers, so this returns null. */
export function inspectionDeadline(now: number, escrowHours: number, instant: boolean): Date | null {
  if (!instant || !Number.isFinite(escrowHours) || escrowHours <= 0) return null;
  return new Date(now + escrowHours * HOUR_MS);
}

/** A promo code as the server stores it: trimmed, upper-case. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Identity of an order body for promo purposes: a quote only holds for the
 *  exact package/options/quantity it was priced for. */
export function promoQuoteKey(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const rest: Record<string, unknown> = { ...body };
  delete rest.promo_code;
  return JSON.stringify(rest);
}

/** What the buyer pays: the quoted total while a promo applies to this very
 *  body, the list total otherwise. */
export function payableTotal(
  total: number, applied: { key: string; total_amount: number } | null, key: string | null,
): number {
  return applied && key && applied.key === key ? applied.total_amount : total;
}
