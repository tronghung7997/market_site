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

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function validIpOrCidr(entry: string): boolean {
  const [address, bits, extra] = entry.split("/");
  if (extra !== undefined) return false;
  const v4 = IPV4.test(address);
  const v6 = !v4 && address.includes(":") && /^[0-9a-fA-F:.]+$/.test(address);
  if (!v4 && !v6) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (v4 ? 32 : 128);
}

/** API key IP allowlist typed one per line (commas and spaces also split).
 *  The backend normalises and re-validates; this only catches typos early. */
export function parseAllowedIps(raw: string): { values: string[]; invalid: string[] } {
  const entries = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const values: string[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    if (!validIpOrCidr(entry)) invalid.push(entry);
    else if (!values.includes(entry)) values.push(entry);
  }
  return { values, invalid };
}

/** Daily spend limit field: empty = no limit (null), digits (dots/commas/spaces ignored) = VND. */
export function parseDailyLimit(raw: string): number | null | "invalid" {
  const cleaned = raw.replace(/[\s.,_]/g, "");
  if (!cleaned) return null;
  if (!/^\d{1,10}$/.test(cleaned)) return "invalid";
  const value = Number(cleaned);
  return value > 2_000_000_000 ? "invalid" : value;
}
