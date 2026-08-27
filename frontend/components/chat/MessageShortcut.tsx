"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { INBOX_HREF, unreadTotal } from "@/lib/chat-inbox";
import { useChatConversations } from "@/hooks/use-chat";
import { useChatEvents } from "@/hooks/use-chat-events";
import { MessageCircle } from "@/components/Icons";

export default function MessageShortcut() {
  const t = useTranslations("nav");
  const { account } = useAuth();
  const conversations = useChatConversations(!!account);
  useChatEvents(!!account);
  const unread = unreadTotal(conversations.data?.items);
  const label = t("messages");

  return (
    <Link
      href={INBOX_HREF}
      aria-label={unread > 0 ? `${label}: ${unread}` : label}
      title={label}
      className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:border-line-2 hover:text-fg"
    >
      <MessageCircle size={17} />
      {unread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-iris px-1 text-[9px] font-bold leading-none text-white ring-2 ring-surface">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
