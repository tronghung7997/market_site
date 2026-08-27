"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { MessageCircle } from "@/components/Icons";
import { Button } from "@/components/ui";

export default function OrderChatButton({ orderId }: { orderId: number; perspective?: "buyer" | "seller" }) {
  const t = useTranslations("chat");
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setLoading(true); setError(null);
    try {
      const room = await api.getOrCreateOrderChat(orderId);
      router.push(`/messages/${room.id}`);
    } catch (cause) {
      setError(apiErrorMessage(cause, t("openFailed")));
    } finally { setLoading(false); }
  };
  return <span className="inline-flex flex-col items-start gap-1"><Button type="button" size="sm" variant="secondary" disabled={loading} onClick={open}><MessageCircle size={13} />{loading ? t("opening") : t("orderChatAction")}</Button>{error && <span className="text-[11px] text-bad">{error}</span>}</span>;
}
