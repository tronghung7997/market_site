"use client";

/** The admin bell, built like the storefront bell: work queues on top, then
 *  open alerts collapsed by type ("· 44 lần"), newest first. Unread = the
 *  type fired again since this admin last opened the bell. */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useActionItemLabel } from "@/lib/action-item-label";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/query-keys";
import { useOpenHref } from "@/lib/use-open-href";
import type { ActionItem } from "@/lib/types";
import { Spinner } from "@/components/ui";
import { AlertTriangle, ArrowRight, Bell } from "@/components/Icons";
import { alertTypeLabel } from "@/components/admin/alert-meta";
import { relativeTime } from "@/features/notifications/model";
import { adminBellBadge, isOverdue, waitLabel } from "../model";

const POLL_MS = 60_000;
const FEED_KEY = ["admin", "notification-feed"] as const;

const QUEUE_DOT: Record<ActionItem["severity"], string> = { critical: "bg-bad", warning: "bg-warn", info: "bg-iris" };
const GROUP_ICON: Record<string, string> = {
  critical: "bg-bad-soft text-bad",
  error: "bg-bad-soft text-bad",
  warning: "bg-warn-soft text-warn",
  info: "bg-iris-soft text-iris-hi",
};

export function AdminBell() {
  const client = useQueryClient();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const openHref = useOpenHref();
  const itemLabel = useActionItemLabel();

  const actions = useQuery({
    queryKey: queryKeys.actionItemsFor("admin"),
    queryFn: api.adminActionItems,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const feed = useQuery({
    queryKey: FEED_KEY,
    queryFn: () => api.adminNotificationFeed(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const markSeen = async () => {
    await api.adminNotificationsSeen();
    await client.invalidateQueries({ queryKey: FEED_KEY });
  };

  // Closing the panel counts as having seen what it showed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setNow(Date.now());
    } else if (wasOpen.current) {
      wasOpen.current = false;
      if ((feed.data?.unread_count ?? 0) > 0) void markSeen();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
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

  // Alerts live in the feed below; the to-do list is the work queues only.
  const queues = (actions.data ?? []).filter((item) => item.alert_id === null);
  const groups = feed.data?.items ?? [];
  const unread = feed.data?.unread_count ?? 0;
  const badge = adminBellBadge(unread, queues.reduce((sum, item) => sum + item.count, 0));

  const follow = (href: string) => {
    setOpen(false);
    openHref(href);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Thông báo"
        aria-label={badge.count > 0 ? `Thông báo, ${badge.count} chưa đọc` : "Thông báo"}
        aria-expanded={open}
        aria-controls="admin-notifications"
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
          id="admin-notifications"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-card-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[380px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line bg-raised/50 px-4 py-3">
            <span className="text-[13px] font-semibold text-fg">Thông báo</span>
            {unread > 0 && (
              <button type="button" onClick={() => void markSeen()} className="text-[12px] font-medium text-iris-hi hover:underline">
                Đánh dấu đã đọc hết
              </button>
            )}
          </div>

          <div className="max-h-[min(480px,calc(100dvh-10rem))] overflow-y-auto">
            {queues.length > 0 && (
              <section aria-label="Việc cần làm" className="border-b border-line pb-1">
                <p className="px-4 pb-1 pt-2.5 text-[11.5px] font-medium text-muted">Việc cần làm</p>
                {queues.map((item) => {
                  const overdue = item.since ? isOverdue(item.since, now) : false;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => follow(item.href)}
                      className="flex w-full items-baseline gap-2.5 px-4 py-1.5 text-left hover:bg-raised/60"
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full", QUEUE_DOT[item.severity])} aria-hidden />
                      <span className="min-w-0 flex-1 text-[13px] leading-snug text-fg">{itemLabel(item)}</span>
                      {item.since && (
                        <span className={cn("shrink-0 text-[11.5px]", overdue ? "font-medium text-warn" : "text-faint")}>
                          {overdue ? "lâu nhất " : ""}{waitLabel(item.since, now)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </section>
            )}

            {feed.isPending ? (
              <div className="grid place-items-center py-8"><Spinner /></div>
            ) : feed.isError ? (
              <p className="px-4 py-6 text-center text-[13px] text-bad">Không tải được thông báo.</p>
            ) : groups.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-muted">
                {queues.length === 0 ? "Không có sự cố, không có việc chờ." : "Không có cảnh báo nào đang mở."}
              </p>
            ) : (
              <div className="divide-y divide-line">
                {groups.map((group) => (
                  <Link
                    key={group.type}
                    href={group.href}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      follow(group.href);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline-none"
                  >
                    <span className={cn(
                      "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                      group.unread ? GROUP_ICON[group.severity] ?? GROUP_ICON.info : "bg-raised text-faint",
                    )}>
                      <AlertTriangle size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[13px] leading-snug", group.unread ? "font-medium text-fg" : "text-muted")}>
                        {alertTypeLabel(group.type)}
                        {group.count > 1 && <span className="font-normal text-faint"> · {group.count} lần</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted" title={group.label}>{group.label}</span>
                      <time dateTime={group.last_seen_at} className="mt-0.5 block text-[11.5px] text-faint">
                        {relativeTime(group.last_seen_at, now, locale)}
                      </time>
                    </span>
                    {group.unread && (
                      <>
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-iris" aria-hidden />
                        <span className="sr-only">Chưa đọc</span>
                      </>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link
            href="/admin/alerts"
            prefetch={false}
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1 border-t border-line px-4 py-2.5 text-[12.5px] font-medium text-iris-hi hover:bg-raised/60"
          >
            Xem tất cả cảnh báo <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </div>
  );
}
