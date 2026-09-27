/** How complete an account is: what protects it and lets GMMO reach the owner. */

import type { Account } from "../../lib/types.ts";

export type CompletenessKey = "email" | "name" | "phone" | "twofa";
export type CompletenessItem = { key: CompletenessKey; done: boolean; tab: "profile" | "security" };

export function accountCompleteness(
  account: Pick<Account, "email_verified" | "display_name" | "phone" | "totp_enabled" | "mfa_available">,
): { items: CompletenessItem[]; percent: number } {
  const items: CompletenessItem[] = [
    { key: "email", done: Boolean(account.email_verified), tab: "profile" },
    { key: "name", done: Boolean(account.display_name?.trim()), tab: "profile" },
    { key: "phone", done: Boolean(account.phone?.trim()), tab: "profile" },
  ];
  // 2FA only counts where the marketplace offers it.
  if (account.mfa_available) items.push({ key: "twofa", done: Boolean(account.totp_enabled), tab: "security" });
  const done = items.filter((item) => item.done).length;
  return { items, percent: Math.round((100 * done) / items.length) };
}
