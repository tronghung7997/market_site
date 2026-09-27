/** Ledger rows grouped the way a buyer or seller thinks about them, and the
 *  order page a row belongs to. */

export const TX_KINDS = ["topup", "purchase", "sale", "refund", "affiliate", "withdraw", "adjustment"] as const;
export type TxKind = (typeof TX_KINDS)[number];

const KIND_OF: Record<string, TxKind> = {
  topup: "topup", deposit: "topup",
  purchase_hold: "purchase",
  purchase_release: "sale", platform_fee: "sale",
  refund: "refund",
  affiliate_commission: "affiliate", affiliate_clawback: "affiliate",
  withdraw: "withdraw", withdraw_lock: "withdraw", withdraw_unlock: "withdraw", withdraw_fee: "withdraw",
  adjustment_credit: "adjustment", adjustment_debit: "adjustment",
};

export function txKind(type: string): TxKind {
  return KIND_OF[type] ?? "adjustment";
}

/** A sale settles on the seller's order page; everything else on the buyer's. */
export function txOrderHref(tx: { type: string; order_code?: string | null }): string | null {
  if (!tx.order_code) return null;
  return txKind(tx.type) === "sale"
    ? `/seller/orders/${encodeURIComponent(tx.order_code)}`
    : `/orders?order=${encodeURIComponent(tx.order_code)}`;
}
