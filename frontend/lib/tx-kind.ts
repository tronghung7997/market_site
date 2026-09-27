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

/** Money status of a ledger row as the account owner reads it. A purchase
 *  follows its order (held → paid to the shop / refunded), a withdrawal lock
 *  is pending review; everything else is simply recorded. */
export type TxStatus =
  | { kind: "hold"; orderStatus: string }
  | { kind: "pending" }
  | { kind: "recorded" };

export function txStatus(tx: { type: string; order_status?: string | null }): TxStatus {
  if (tx.type === "purchase_hold" && tx.order_status) return { kind: "hold", orderStatus: tx.order_status };
  if (tx.type === "withdraw_lock") return { kind: "pending" };
  return { kind: "recorded" };
}

// The credit's kind is already the row's label; only the admin's reason is a note.
const CREDIT_PREFIX = /^(Admin topup|Demo topup|GMMO cộng tiền|Nạp thử \(demo\))(\s*—\s*)?/;

/** The row's note without the credit prefix ("GMMO cộng tiền — reason", or the
 *  older English "Admin topup — reason" → "reason"); null when nothing is left. */
export function txNote(description: string | null | undefined): string | null {
  const text = (description ?? "").replace(CREDIT_PREFIX, "").trim();
  return text || null;
}
