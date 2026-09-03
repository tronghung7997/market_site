"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { conversationInboxPath } from "@/lib/chat-inbox";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { MessageCircle } from "@/components/Icons";
import { Button } from "@/components/ui";

type OrderChatButtonProps = {
  orderId: number;
  perspective?: "buyer" | "seller";
  appearance?: "button" | "link";
  label?: string;
  className?: string;
  iconSize?: number;
};

export default function OrderChatButton({
  orderId,
  appearance = "button",
  label,
  className,
  iconSize = 13,
}: OrderChatButtonProps) {
  const t = useTranslations("chat");
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caption = loading ? t("opening") : (label ?? t("orderChatAction"));

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      const room = await api.getOrCreateOrderChat(orderId);
      router.push(conversationInboxPath(room.id));
    } catch (cause) {
      setError(apiErrorMessage(cause, t("openFailed")));
    } finally {
      setLoading(false);
    }
  };

  const control = appearance === "link" ? (
    <button
      type="button"
      disabled={loading}
      onClick={open}
      title={label}
      className={
        className
        ?? "inline-flex items-center gap-1 text-xs font-medium text-iris hover:underline disabled:opacity-60"
      }
    >
      <MessageCircle size={iconSize} />
      <span>{caption}</span>
    </button>
  ) : (
    <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={open} className={className}>
      <MessageCircle size={iconSize} />
      {caption}
    </Button>
  );

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {control}
      {error && <span className="text-[11px] text-bad">{error}</span>}
    </span>
  );
}
