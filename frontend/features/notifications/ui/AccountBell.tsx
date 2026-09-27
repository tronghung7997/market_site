"use client";

/** The storefront bell: unread notifications as the badge, the to-do list
 *  (action items) on top, then the latest notifications and a link to all. */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useActionItemLabel } from "@/lib/action-item-label";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/query-keys";
import { useOpenHref } from "@/lib/use-open-href";
import type { ActionItem, NotificationItem } from "@/lib/types";
import { useChatEvents } from "@/hooks/use-chat-events";
import { Spinner } from "@/components/ui";
import { ArrowRight, Bell, X } from "@/components/Icons";
import { bellBadge } from "../model";
import { useMarkNotificationsRead, useNotificationCounts, useNotificationFeed } from "../useNotifications";
import { NotificationRow } from "./NotificationRow";

const PANEL_ITEMS = 6;
const DOT_TONE: Record<ActionItem["severity"], string> = { critical: "bg-bad", warning: "bg-warn", info: "bg-iris" };

export function AccountBell() {
  const t = useTranslations("notificationCenter");
  const th = useTranslations("home");
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const openHref = useOpenHref();
  const itemLabel = useActionItemLabel();
  useChatEvents(true);

  const counts = useNotificationCounts(true);
  const actions = useQuery({
    queryKey: queryKeys.actionItemsFor("account"),
    queryFn: api.accountActionItems,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const feed = useNotificationFeed("all", open, PANEL_ITEMS);
  const markRead = useMarkNotificationsRead();

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const unread = counts.data?.unread ?? 0;
  const actionItems = actions.data ?? [];
  const badge = bellBadge(unread, actionItems.reduce((sum, item) => sum + item.count, 0));
  const items = feed.data?.pages[0]?.items ?? [];

  const follow = (href: string) => {
    setOpen(false);
    openHref(href);
  };
  const openItem = (item: NotificationItem) => {
    if (!item.read) markRead.mutate({ ids: [item.id] });
    if (item.href) follow(item.href);
  };
  const dismiss = (alertId: number) => {
    void api.dismissOwnAlert(alertId).then(() => client.invalidateQueries({ queryKey: queryKeys.actionItems() }));
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={th("notifications")}
        aria-label={badge.count > 0 ? t("bellUnread", { count: badge.count }) : th("notifications")}
        aria-expanded={open}
        aria-controls="account-notifications"
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:border-line-2 hover:text-fg"
      >
        <Bell size={16} />
        {badge.count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-bad px-1 text-[10px] font-bold leading-none text-white">
            {badge.count > 9 ? "9+" : badge.count}
          </span>
        )}
        {badge.dot && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-warn ring-2 ring-surface" aria-hidden />}
      </button>
      {open && (
        <div
          id="account-notifications"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-card-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[380px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line bg-raised/50 px-4 py-3">
            <span className="text-[13px] font-semibold text-fg">{th("notifications")}</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead.mutate({})}
                disabled={markRead.isPending}
                className="text-[12px] font-medium text-iris-hi hover:underline disabled:opacity-60"
              >
                {t("markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-[min(460px,calc(100dvh-10rem))] overflow-y-auto">
            {actionItems.length > 0 && (
              <section aria-label={th("actionItems")} className="border-b border-line">
                <p className="px-4 pb-1 pt-2.5 text-[11.5px] font-medium text-muted">{th("actionItems")}</p>
                {actionItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-1 hover:bg-raised/60">
                    <button type="button" onClick={() => follow(item.href)} className="flex min-w-0 flex-1 items-start gap-2.5 px-4 py-2 text-left">
                      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", DOT_TONE[item.severity])} aria-hidden />
                      <span className="text-[13px] leading-snug text-fg">{itemLabel(item)}</span>
                    </button>
                    {item.dismissible && item.alert_id !== null && (
                      <button
                        type="button"
                        onClick={() => dismiss(item.alert_id as number)}
                        title={th("dismiss")}
                        aria-label={th("dismiss")}
                        className="mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
            {feed.isPending ? (
              <div className="grid place-items-center py-8"><Spinner /></div>
            ) : feed.isError ? (
              <p className="px-4 py-6 text-center text-[13px] text-bad">{t("loadFailed")}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-muted">{t("empty")}</p>
            ) : (
              <div className="divide-y divide-line">
                {items.map((item) => <NotificationRow key={item.id} item={item} now={now} onOpen={openItem} dense />)}
              </div>
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1 border-t border-line px-4 py-2.5 text-[12.5px] font-medium text-iris-hi hover:bg-raised/60"
          >
            {t("seeAll")} <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </div>
  );
}
