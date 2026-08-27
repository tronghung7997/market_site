"use client";

import { Link } from "@/i18n/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ActionItem } from "@/lib/types";
import { useChatEvents } from "@/hooks/use-chat-events";
import { Bell, X } from "./Icons";

const ENDPOINTS = {
  account: api.accountActionItems,
  buyer: api.buyerActionItems,
  seller: api.sellerActionItems,
  admin: api.adminActionItems,
} as const;

const DISMISS = {
  account: api.dismissSellerAlert,
  buyer: null,
  seller: api.dismissSellerAlert,
  admin: api.dismissAlert,
} as const;

const DOT_TONE: Record<ActionItem["severity"], string> = {
  critical: "bg-bad",
  warning: "bg-warn",
  info: "bg-iris",
};

const POLL_MS = 60_000;

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
  admin_pending_withdrawals: { msg: "adminPendingWithdrawals" },
  admin_pending_tasks: { msg: "adminPendingTasks" },
};

export default function NotificationBell({ endpoint }: { endpoint: keyof typeof ENDPOINTS }) {
  const t = useTranslations("home");
  const tn = useTranslations("notifications");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  useChatEvents(endpoint !== "admin");

  const { data: items = [] } = useQuery({
    queryKey: queryKeys.actionItemsFor(endpoint),
    queryFn: ENDPOINTS[endpoint],
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const itemLabel = (item: ActionItem) => {
    const mapped = LABEL_KEYS[item.key];
    if (!mapped) return item.label;
    return tn(mapped.msg, {
      count: item.count,
      ...(mapped.hours != null ? { hours: mapped.hours } : {}),
    });
  };

  const dismiss = DISMISS[endpoint];
  const dismissMutation = useMutation({
    mutationFn: (alertId: number) => {
      if (!dismiss) return Promise.reject(new Error("dismiss unavailable"));
      return dismiss(alertId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.actionItems() });
    },
  });

  const total = items.reduce((sum, i) => sum + i.count, 0);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("notifications")}
        aria-label={t("notifications")}
        aria-expanded={open}
        className="relative grid place-items-center h-9 w-9 rounded-lg border border-line bg-surface text-muted hover:text-fg hover:border-line-2 transition-colors"
      >
        <Bell size={16} />
        {total > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[10px] font-bold leading-none">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 z-50 rounded-xl border border-line bg-surface shadow-card-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-line bg-raised/50">
              <div className="text-[13px] font-semibold text-fg">{t("actionItems")}</div>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-6 text-center text-[13px] text-muted">
                  {t("noActionItems")}
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 border-b border-line last:border-0 hover:bg-raised/50 transition-colors">
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex-1 min-w-0 flex items-start gap-2.5 px-4 py-3"
                    >
                      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${DOT_TONE[item.severity]}`} />
                      <span className="text-[13px] text-fg leading-snug">{itemLabel(item)}</span>
                    </Link>
                    {item.dismissible && item.alert_id !== null && (
                      <button
                        onClick={() => dismissMutation.mutate(item.alert_id as number)}
                        title={t("dismiss")}
                        aria-label={t("dismiss")}
                        className="shrink-0 grid place-items-center h-7 w-7 mr-2 rounded-md text-faint hover:text-fg hover:bg-raised transition-colors"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
