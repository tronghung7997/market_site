"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { NotificationCategory, NotificationItem } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import {
  AlertTriangle, Bell, CheckCircle2, Landmark, MessageCircle, Package, Receipt, Store, TrendingUp, Wallet,
} from "@/components/Icons";
import { notificationMessage, relativeTime } from "../model";

const ICON: Record<NotificationCategory, typeof Bell> = {
  order: Receipt, wallet: Wallet, message: MessageCircle, system: Bell,
};

/** A kind's own icon, so a dispute, a delivery and a payout look different. */
function kindIcon(item: Pick<NotificationItem, "kind" | "category">): typeof Bell {
  const kind = item.kind;
  if (kind.startsWith("dispute_")) return AlertTriangle;
  if (kind === "order_new") return Package;
  if (kind === "order_delivered" || kind === "order_completed") return CheckCircle2;
  if (kind.startsWith("withdrawal_")) return Landmark;
  if (kind.startsWith("application_")) return Store;
  if (kind === "tier_changed" || kind === "buyer_tier_changed") return TrendingUp;
  if (kind === "tier_at_risk") return AlertTriangle;
  return ICON[item.category] ?? Bell;
}

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
  const Icon = kindIcon(item);
  const className = cn(
    "flex w-full items-start gap-3 text-left transition-colors hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline-none",
    dense ? "px-4 py-2.5" : "px-4 py-3 sm:px-5",
  );
  const body = (
    <>
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
    </>
  );
  // A real link, so it opens in a new tab like any other; a plain click keeps
  // the in-app handling (mark read, re-open an order already on screen).
  if (item.href) {
    return (
      <Link
        href={item.href}
        className={className}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(item);
        }}
      >
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => onOpen(item)} className={className}>
      {body}
    </button>
  );
}
