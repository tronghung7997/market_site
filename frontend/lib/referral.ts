/** Referral-link cookies the storefront keeps between a `?ref=` landing and
 *  sign-up (written by `components/ReferralCapture`). Pure. */

import type { ReferralEvidence } from "./types.ts";

export const REF_COOKIE = "aff_ref";
export const REF_AT_COOKIE = "aff_ref_at";
export const VISITOR_COOKIE = "aff_vid";

/** What the sign-up sends so the backend can check the attribution window:
 *  the code, the click-tracking visitor id and the landing time. */
export function referralEvidence(cookie: (name: string) => string | null): ReferralEvidence | undefined {
  const code = cookie(REF_COOKIE)?.trim();
  if (!code) return undefined;
  const evidence: ReferralEvidence = { code };
  const visitorId = cookie(VISITOR_COOKIE);
  if (visitorId) evidence.visitorId = visitorId;
  const at = cookie(REF_AT_COOKIE);
  if (at && !Number.isNaN(Date.parse(at))) evidence.clickedAt = new Date(at).toISOString();
  return evidence;
}
