/** How much one request may take out of the wallet.
 *  Sellers: the available balance (their tier limit is checked by the server).
 *  Anyone else: only earned affiliate commission (`withdrawable_commission`,
 *  already capped by the balance server-side). Pure, so node tests can load it. */

import type { Wallet } from "../../lib/types.ts";

export interface WithdrawCap {
  /** Largest amount the form accepts. */
  max: number;
  /** True when only affiliate commission can be withdrawn (not a seller). */
  commissionOnly: boolean;
}

export function withdrawCap(wallet: Pick<Wallet, "available_balance" | "withdrawable_commission"> | null): WithdrawCap {
  const available = Math.max(0, wallet?.available_balance ?? 0);
  const commission = wallet?.withdrawable_commission;
  if (commission === null || commission === undefined) return { max: available, commissionOnly: false };
  return { max: Math.max(0, Math.min(available, commission)), commissionOnly: true };
}
