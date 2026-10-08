/** Withdrawal request status, shared by seller and admin screens.
 *
 *  One name per status everywhere: the label says who acts next, the tone is
 *  the global status colour (DESIGN.md › Status and tags). Labels live in
 *  `status.withdraw.*` (seller/wallet) and `components/admin/status-config.ts`
 *  (admin, Vietnamese only) and must read the same. */

// Relative import keeps this module loadable by node:test (no path alias).
import type { StatusTone } from "./order-status.ts";

export const WITHDRAW_STATUSES = ["pending", "approved", "paid", "rejected"] as const;
export type WithdrawStatus = (typeof WITHDRAW_STATUSES)[number];

/** `approved` is not green: the money is still locked until the transfer. */
export const WITHDRAW_TONE: Record<WithdrawStatus, StatusTone> = {
  pending: "warn",
  approved: "iris",
  paid: "good",
  rejected: "bad",
};

/** Step reached in Gửi yêu cầu → Duyệt → Chuyển khoản. */
export const WITHDRAW_STEP: Record<WithdrawStatus, number> = { pending: 0, approved: 1, paid: 2, rejected: 1 };

export function isWithdrawStatus(status: string): status is WithdrawStatus {
  return (WITHDRAW_STATUSES as readonly string[]).includes(status);
}

export function withdrawTone(status: string): StatusTone {
  return isWithdrawStatus(status) ? WITHDRAW_TONE[status] : "neutral";
}

export function withdrawStep(status: string): number {
  return isWithdrawStatus(status) ? WITHDRAW_STEP[status] : 0;
}
