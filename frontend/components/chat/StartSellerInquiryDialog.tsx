"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError, api } from "@/lib/api";
import type { Product } from "@/lib/types";
import { useCreateInquiry } from "@/hooks/use-chat";
import { MessageCircle, X } from "@/components/Icons";
import { Button, Field, Textarea } from "@/components/ui";

export default function StartSellerInquiryDialog({
  sellerId,
  sellerName,
  products,
}: {
  sellerId: number;
  sellerName: string;
  products: Product[];
}) {
  const t = useTranslations("chat");
  const router = useRouter();
  const { account } = useAuth();
  const create = useCreateInquiry();
  const available = products.filter((product) => product.status === "active");
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<number | null>(available[0]?.id ?? null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    if (!account) return router.push(`/login?next=/sellers/${sellerId}`);
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    const body = message.trim();
    if (!productId || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      try {
        const room = await api.findProductInquiry(productId);
        await api.sendChatMessage(room.id, body, crypto.randomUUID());
        setOpen(false);
        router.push(`/messages/${room.id}`);
        return;
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 404) throw cause;
      }
      const room = await create.mutateAsync({
        productId,
        message: body,
        clientMessageId: crypto.randomUUID(),
      });
      setOpen(false);
      router.push(`/messages/${room.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button type="button" size="sm" onClick={start} disabled={available.length === 0} title={available.length === 0 ? t("noProducts") : t("messageSeller")}>
        <MessageCircle size={14} /> {t("messageSeller")}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center px-4">
          <button className="absolute inset-0 bg-ink/45" aria-label={t("cancel")} onClick={() => setOpen(false)} />
          <section role="dialog" aria-modal="true" aria-labelledby="seller-inquiry-title" className="relative w-full max-w-[500px] rounded-xl border border-line bg-surface shadow-card-lg">
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 id="seller-inquiry-title" className="text-[16px] font-semibold">{t("messageSellerTitle")}: {sellerName}</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("messageSellerHint")}</p>
              </div>
              <button className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg" onClick={() => setOpen(false)} aria-label={t("cancel")}><X size={16} /></button>
            </header>
            <div className="space-y-4 p-5">
              <Field label={t("chooseProduct")}>
                <select
                  id="seller-inquiry-product"
                  name="product_id"
                  value={productId ?? ""}
                  onChange={(event) => setProductId(Number(event.target.value))}
                  className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] outline-none focus:border-iris"
                >
                  {available.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
                </select>
              </Field>
              <Field label={t("messageLabel")} error={error ?? create.error?.message}>
                <Textarea id="seller-inquiry-message" name="message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("writeQuestion")} maxLength={4000} rows={5} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
                <Button type="button" disabled={!productId || !message.trim() || sending} onClick={submit}>{sending ? t("sending") : t("sendMessage")}</Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
