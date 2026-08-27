"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError, api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useCreateInquiry } from "@/hooks/use-chat";
import { MessageCircle, X } from "@/components/Icons";
import { Button, Field, Textarea } from "@/components/ui";

export default function StartInquiryDialog({
  productId,
  block = false,
  compact = false,
}: {
  productId: number;
  block?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("chat");
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const { account } = useAuth();
  const create = useCreateInquiry();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);

  const start = async () => {
    if (!account) return router.push(`/login?next=/products/${productId}`);
    setChecking(true);
    try {
      const room = await api.findProductInquiry(productId);
      router.push(`/messages/${room.id}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setOpen(true);
      else create.reset();
    } finally { setChecking(false); }
  };
  const submit = async () => {
    const body = message.trim();
    if (!body) return;
    const room = await create.mutateAsync({ productId, message: body, clientMessageId: crypto.randomUUID() });
    setOpen(false);
    router.push(`/messages/${room.id}`);
  };

  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "secondary"}
        size={compact ? "sm" : "md"}
        block={block}
        className={compact ? "text-iris-hi hover:bg-iris-soft" : undefined}
        disabled={checking}
        onClick={start}
      >
        <MessageCircle size={compact ? 14 : 15} /> {checking ? t("sending") : (compact ? t("compactMessage") : t("askSeller"))}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center px-4">
          <button className="absolute inset-0 bg-ink/45" aria-label={t("cancel")} onClick={() => setOpen(false)} />
          <section role="dialog" aria-modal="true" aria-labelledby="inquiry-title" className="relative w-full max-w-[480px] rounded-xl border border-line bg-surface shadow-card-lg">
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div><h2 id="inquiry-title" className="text-[16px] font-semibold">{t("askTitle")}</h2><p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("askHint")}</p></div>
              <button className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg" onClick={() => setOpen(false)} aria-label={t("cancel")}><X size={16} /></button>
            </header>
            <div className="space-y-4 p-5">
              <Field label={t("messageLabel")} error={create.error ? apiErrorMessage(create.error) : undefined}><Textarea id="product-inquiry-message" name="message" autoFocus value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("askPlaceholder")} maxLength={4000} rows={5} /></Field>
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={!message.trim() || create.isPending} onClick={submit}>{create.isPending ? t("sending") : t("sendQuestion")}</Button></div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
