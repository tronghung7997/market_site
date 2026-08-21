"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { MessageCircle } from "@/components/Icons";
import { Button } from "@/components/ui";

export default function OrderChatButton({ orderId, perspective }: { orderId: number; perspective: "buyer" | "seller" }) {
  const locale = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setLoading(true); setError(null);
    try {
      const room = await api.getOrCreateOrderChat(orderId);
      router.push(`${perspective === "seller" ? "/seller/messages" : "/messages"}/${room.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open chat");
    } finally { setLoading(false); }
  };
  return <span className="inline-flex flex-col items-start gap-1"><Button type="button" size="sm" variant="secondary" disabled={loading} onClick={open}><MessageCircle size={13} />{loading ? (locale === "vi" ? "Đang mở..." : "Opening...") : (locale === "vi" ? "Chat đơn hàng" : "Order chat")}</Button>{error && <span className="text-[11px] text-bad">{error}</span>}</span>;
}
