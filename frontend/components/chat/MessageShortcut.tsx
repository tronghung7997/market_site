"use client";

import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useChatConversations } from "@/hooks/use-chat";
import { MessageCircle } from "@/components/Icons";

export default function MessageShortcut({
  perspective,
  href,
}: {
  perspective: "buyer" | "seller";
  href: "/messages" | "/seller/messages";
}) {
  const locale = useLocale();
  const conversations = useChatConversations(perspective);
  const unread = (conversations.data?.items ?? []).reduce(
    (total, room) => total + room.unread_count,
    0,
  );
  const label = locale === "vi" ? "Tin nhắn" : "Messages";

  return (
    <Link
      href={href}
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
