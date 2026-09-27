"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { NotificationCategory, NotificationItem } from "@/lib/types";
import { Bell, MessageCircle, Receipt, Wallet } from "@/components/Icons";
import { notificationMessage, relativeTime } from "../model";

const ICON: Record<NotificationCategory, typeof Bell> = {
  order: Receipt, wallet: Wallet, message: MessageCircle, system: Bell,
};

export function NotificationRow({ item, now, onOpen, dense = false }: {
  item: NotificationItem;
  now: number;
  onOpen: (item: NotificationItem) => void;
  dense?: boolean;
}) {
  const t = useTranslations("notificationCenter");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const message = notificationMessage(item, (amount) => formatLedgerMoney(amount, locale));
  if ("name" in message.values && !message.values.name) message.values.name = t("shopFallback");
  const Icon = ICON[item.category] ?? Bell;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={cn(
        "flex w-full items-start gap-3 text-left transition-colors hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline-none",
        dense ? "px-4 py-2.5" : "px-4 py-3 sm:px-5",
      )}
    >
      <span className={cn(
        "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
        item.read ? "bg-raised text-faint" : "bg-iris-soft text-iris-hi",
      )}>
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13px] leading-snug", item.read ? "text-muted" : "font-medium text-fg")}>
          {t(`kinds.${message.key}`, message.values)}
        </span>
        <time dateTime={item.created_at} className="mt-0.5 block text-[11.5px] text-faint">
          {relativeTime(item.created_at, now, locale)}
        </time>
      </span>
      {!item.read && (
        <>
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-iris" aria-hidden />
          <span className="sr-only">{t("unread")}</span>
        </>
      )}
    </button>
  );
}
