"use client";

/** /notifications: every notification, by category, newest first. */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useOpenHref } from "@/lib/use-open-href";
import type { NotificationCategory, NotificationItem } from "@/lib/types";
import { Button, Card, Spinner } from "@/components/ui";
import { NOTIFICATION_CATEGORIES } from "../model";
import { useMarkNotificationsRead, useNotificationCounts, useNotificationFeed } from "../useNotifications";
import { NotificationRow } from "./NotificationRow";

type Filter = NotificationCategory | "all";

export function NotificationsPage() {
  const t = useTranslations("notificationCenter");
  const router = useRouter();
  const { account, loading } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(() => Date.now());
  const openHref = useOpenHref();
  const counts = useNotificationCounts(!!account);
  const feed = useNotificationFeed(filter, !!account);
  const markRead = useMarkNotificationsRead();

  useEffect(() => {
    if (!loading && !account) router.push("/login?next=/notifications");
  }, [account, loading, router]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading || !account) return <div className="grid place-items-center py-24"><Spinner /></div>;

  const unreadFor = (f: Filter) => (f === "all" ? counts.data?.unread : counts.data?.by_category[f]) ?? 0;
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const openItem = (item: NotificationItem) => {
    if (!item.read) markRead.mutate({ ids: [item.id] });
    if (item.href) openHref(item.href);
  };

  return (
    <div className="px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-[760px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-[26px] tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={unreadFor(filter) === 0 || markRead.isPending}
            onClick={() => markRead.mutate(filter === "all" ? {} : { category: filter })}
          >
            {t("markRead")}
          </Button>
        </header>

        <div role="tablist" aria-label={t("filters")} className="flex gap-1.5 overflow-x-auto pb-1">
          {(["all", ...NOTIFICATION_CATEGORIES] as Filter[]).map((f) => {
            const unread = unreadFor(f);
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
                  filter === f ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
                )}
              >
                {t(`categories.${f}`)}
                {unread > 0 && (
                  <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-iris px-1 text-[10px] font-bold leading-none text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Card className="overflow-hidden p-0">
          {feed.isPending ? (
            <div className="grid place-items-center py-16"><Spinner /></div>
          ) : feed.isError ? (
            <div className="px-5 py-12 text-center">
              <p className="text-[13px] text-bad">{t("loadFailed")}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => feed.refetch()}>{t("retry")}</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="text-[14px] font-medium">{t(filter === "all" ? "emptyTitle" : "emptyCategory")}</p>
              <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-muted">{t("emptyBody")}</p>
              <Link href="/orders" className="mt-4 inline-block text-[13px] font-medium text-iris-hi hover:underline">{t("goOrders")}</Link>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {items.map((item) => <NotificationRow key={item.id} item={item} now={now} onOpen={openItem} />)}
            </div>
          )}
        </Card>
        {feed.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="secondary" size="sm" loading={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>
              {t("loadMore")}
            </Button>
          </div>
        )}
        <p className="text-center text-[12px] text-faint">{t("retention")}</p>
      </div>
    </div>
  );
}
