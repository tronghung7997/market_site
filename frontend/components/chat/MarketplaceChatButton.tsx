"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ApiError, api } from "@/lib/api";
import { conversationInboxPath } from "@/lib/chat-inbox";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { MessageCircle } from "@/components/Icons";
import { Button, Field, Textarea } from "@/components/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function MarketplaceChatButton({
  orderId,
  canRequestReview = false,
  appearance = "button",
  className,
  onOpened,
}: {
  orderId: number;
  canRequestReview?: boolean;
  appearance?: "button" | "link";
  className?: string;
  onOpened?: () => void;
}) {
  const t = useTranslations("chat");
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const caption = loading ? t("opening") : t("marketplaceChatAction");

  const go = (conversationId: string) => {
    onOpened?.();
    router.push(conversationInboxPath(conversationId));
  };

  const openExisting = async () => {
    const room = await api.openMarketplaceChat(orderId);
    go(room.id);
  };

  const closeForm = () => {
    if (loading) return;
    setFormOpen(false);
  };

  const submitNote = async () => {
    const body = note.trim();
    if (!body) return;
    setLoading(true);
    setError(null);
    try {
      const dispute = await api.escalateMarketplaceReview(orderId, body, idempotencyKey.current);
      setFormOpen(false);
      if (dispute.marketplace_conversation_id) {
        go(dispute.marketplace_conversation_id);
        return;
      }
      await openExisting();
    } catch (cause) {
      setError(apiErrorMessage(cause, t("openFailed")));
    } finally {
      setLoading(false);
    }
  };

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      if (canRequestReview) {
        setFormOpen(true);
        return;
      }
      await openExisting();
    } catch (cause) {
      if (cause instanceof ApiError && cause.errorCode === "CHAT_SUPPORT_REQUIRES_REVIEW") {
        setFormOpen(true);
      } else {
        setError(apiErrorMessage(cause, t("openFailed")));
      }
    } finally {
      setLoading(false);
    }
  };

  const control = appearance === "link" ? (
    <button
      type="button"
      disabled={loading}
      onClick={open}
      title={caption}
      className={
        className
        ?? "inline-flex items-center gap-1 text-xs font-medium text-iris hover:underline disabled:opacity-60"
      }
    >
      <MessageCircle size={13} />
      <span>{caption}</span>
    </button>
  ) : (
    <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={open} className={className}>
      <MessageCircle size={13} />
      {caption}
    </Button>
  );

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {control}
      {error && !formOpen && <span className="text-[11px] text-bad">{error}</span>}
      <Dialog open={formOpen} onOpenChange={(openDialog) => { if (!openDialog) closeForm(); }}>
        <DialogContent
          overlayClassName="bg-ink/45"
          className="max-w-[480px] gap-0 border-line bg-surface p-0 shadow-card-lg"
        >
          <DialogHeader className="border-b border-line px-5 py-4 text-left">
            <DialogTitle className="text-[16px] font-semibold text-fg">{t("marketplaceReviewTitle")}</DialogTitle>
            <DialogDescription className="mt-1 text-[12.5px] leading-relaxed text-muted">
              {t("marketplaceReviewHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <Field label={t("marketplaceReviewNote")} error={error ?? undefined}>
              <Textarea
                id="marketplace-review-note"
                name="note"
                autoFocus
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("marketplaceReviewPlaceholder")}
                maxLength={2000}
                rows={5}
              />
            </Field>
            <DialogFooter className="gap-2 sm:justify-end">
              <Button type="button" variant="ghost" onClick={closeForm} disabled={loading}>{t("cancel")}</Button>
              <Button type="button" disabled={!note.trim() || loading} onClick={submitNote}>
                {loading ? t("sending") : t("marketplaceReviewSubmit")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </span>
  );
}
