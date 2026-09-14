"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { ActionItem } from "@/lib/types";

/** Map stable API keys → next-intl templates. Free-form alert.message stays as-is. */
const LABEL_KEYS: Record<string, { msg: string; hours?: number }> = {
  buyer_delivered_unconfirmed: { msg: "buyerDeliveredUnconfirmed" },
  buyer_escrow_expiring: { msg: "buyerEscrowExpiring", hours: 24 },
  buyer_low_balance: { msg: "buyerLowBalance" },
  buyer_dispute_seller_responded: { msg: "buyerDisputeSellerResponded" },
  unread_messages: { msg: "unreadMessages" },
  seller_application_approved: { msg: "sellerApplicationApproved" },
  seller_pending_orders: { msg: "sellerPendingOrders" },
  seller_open_disputes: { msg: "sellerOpenDisputes" },
  seller_needs_setup: { msg: "sellerNeedsSetup" },
  seller_withdrawals_rejected: { msg: "sellerWithdrawalsRejected" },
  admin_pending_applications: { msg: "adminPendingApplications" },
  admin_open_disputes: { msg: "adminOpenDisputes" },
  admin_marketplace_review: { msg: "adminMarketplaceReview" },
  admin_pending_withdrawals: { msg: "adminPendingWithdrawals" },
  admin_pending_tasks: { msg: "adminPendingTasks" },
};

type HandledAccountsParams = { count: number; orderId: string };

/**
 * Older alert rows persisted their display sentence rather than structured
 * params. Recognise both the English and the Vietnamese backend format so the
 * client can render them in its locale.
 */
function handledAccountsParams(label: string): HandledAccountsParams | null {
  const english = /^Seller handled (\d+) account\(s\) on order #(\d+)\.$/.exec(label);
  if (english) return { count: Number(english[1]), orderId: english[2] };

  const vietnamese = /^Đơn #(\d+): seller (?:hoàn|đổi) (\d+) tài khoản/.exec(label);
  if (vietnamese) return { count: Number(vietnamese[2]), orderId: vietnamese[1] };

  return null;
}

/** Localised label for an action item; falls back to the backend sentence. */
export function useActionItemLabel() {
  const tn = useTranslations("notifications");
  return useCallback((item: Pick<ActionItem, "key" | "label" | "count">) => {
    const mapped = LABEL_KEYS[item.key];
    if (mapped) {
      return tn(mapped.msg, {
        count: item.count,
        ...(mapped.hours != null ? { hours: mapped.hours } : {}),
      });
    }
    const handled = handledAccountsParams(item.label);
    return handled ? tn("buyerDisputeAccountsHandled", handled) : item.label;
  }, [tn]);
}
