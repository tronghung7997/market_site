/** Help-center content model: which topics exist, which questions belong to
 *  them, and how the page filters them. Copy lives in the `support` message
 *  namespace (`faq.<id>.q` / `faq.<id>.a`); this module only knows ids. */

import { foldText, matchesAllWords } from "../../lib/text-fold.ts";

export { foldText };

export const SUPPORT_TOPICS = ["orders", "payments", "account", "disputes", "sellers", "safety"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

/** Question ids in display order, grouped by topic. */
export const SUPPORT_FAQ: Record<SupportTopic, readonly string[]> = {
  orders: ["deliveryTime", "findDelivery", "autoComplete"],
  payments: ["topUp", "depositMissing", "refundDestination"],
  account: ["forgotPassword", "strangeSession"],
  disputes: ["whenDispute", "evidence", "platformReview"],
  sellers: ["openShop", "sellerPayout"],
  safety: ["neverOtp", "offPlatform"],
};

export interface FaqEntry {
  id: string;
  topic: SupportTopic;
  q: string;
  a: string;
}

export function isSupportTopic(value: string | null | undefined): value is SupportTopic {
  return !!value && (SUPPORT_TOPICS as readonly string[]).includes(value);
}

/** Questions in `topic` (all topics when null) whose question or answer
 *  contains every word of `query`, accent- and case-insensitively. */
export function filterFaq(entries: FaqEntry[], { topic, query }: { topic: SupportTopic | null; query: string }): FaqEntry[] {
  return entries.filter((entry) => (!topic || entry.topic === topic) && matchesAllWords(`${entry.q} ${entry.a}`, query));
}

/** Number of matching questions per topic for the current search (topic chips show it). */
export function countByTopic(entries: FaqEntry[], query: string): Record<SupportTopic, number> {
  const counts = Object.fromEntries(SUPPORT_TOPICS.map((t) => [t, 0])) as Record<SupportTopic, number>;
  for (const entry of filterFaq(entries, { topic: null, query })) counts[entry.topic] += 1;
  return counts;
}
