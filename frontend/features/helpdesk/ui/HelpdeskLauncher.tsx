"use client";

/** Floating "chat with GMMO" button and its panel: the signed-in account's
 *  standing thread with the Marketplace desk, plus a separate shop thread for
 *  sellers. The same threads show in /messages; admins answer them from
 *  /admin/support. */

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { conversationInboxPath } from "@/lib/chat-inbox";
import { IMAGE_ACCEPT, imageFilesFrom, privateImageBase, privateImageSource } from "@/lib/media";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useChatConversations } from "@/hooks/use-chat";
import type { ChatConversation } from "@/lib/types";
import { Button, Spinner } from "@/components/ui";
import { ArrowRight, ExternalLink, Headset, Paperclip, X } from "@/components/Icons";
import { ImageStrip } from "@/components/media/ImageStrip";
import { PendingImages } from "@/components/media/PendingImages";
import { useImageUploads } from "@/components/media/useImageUploads";
import { helpdeskRoom, initialHelpdeskRole, launcherHidden, launcherRaised, quickTopics, type HelpdeskRole, type QuickTopic } from "../model";
import { useHelpdeskThread, useSendHelpdesk } from "../useHelpdesk";

/** Backend MAX_ATTACHMENTS_PER_MESSAGE. */
const MAX_IMAGES = 4;

export function HelpdeskLauncher() {
  const t = useTranslations("helpdesk");
  const pathname = usePathname();
  const { account, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<HelpdeskRole>("buyer");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isAdmin = !!account?.roles.includes("admin");
  const isSeller = !!account?.roles.includes("seller");
  // Shares the header's chat-list query: no extra request for the badge.
  const rooms = useChatConversations(!!account && !isAdmin);
  const threads: Record<HelpdeskRole, ChatConversation | null> = {
    buyer: helpdeskRoom(rooms.data?.items, "buyer"),
    seller: isSeller ? helpdeskRoom(rooms.data?.items, "seller") : null,
  };
  const unreadBy: Record<HelpdeskRole, number> = {
    buyer: threads.buyer?.unread_count ?? 0,
    seller: threads.seller?.unread_count ?? 0,
  };
  const room = threads[role];
  const unread = open ? 0 : unreadBy.buyer + unreadBy.seller;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (loading || isAdmin || launcherHidden(pathname)) return null;

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };
  const openPanel = () => {
    setRole(initialHelpdeskRole(pathname, isSeller, unreadBy));
    setOpen(true);
  };

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="helpdesk-title"
          onKeyDown={(event) => { if (event.key === "Escape") close(); }}
          className={cn(
            "fixed z-40 flex flex-col overflow-hidden border border-line bg-surface shadow-card-lg",
            "inset-x-0 bottom-0 h-[85dvh] rounded-t-2xl",
            "sm:inset-x-auto sm:bottom-24 sm:right-5 sm:h-[min(560px,calc(100dvh-7rem))] sm:w-[372px] sm:rounded-card",
          )}
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-iris-soft text-iris-hi">
              <Headset size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="helpdesk-title" className="text-[14px] font-semibold">{t("title")}</h2>
              <p className="truncate text-[12px] text-muted">{t("subtitle")}</p>
            </div>
            {room && (
              <Link
                href={conversationInboxPath(room.id)}
                aria-label={t("openInbox")}
                title={t("openInbox")}
                className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg"
              >
                <ExternalLink size={15} />
              </Link>
            )}
            <button
              type="button"
              onClick={close}
              aria-label={t("close")}
              className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg"
            >
              <X size={16} />
            </button>
          </header>
          {account && isSeller && (
            <div role="tablist" aria-label={t("roleTabs")} className="flex gap-1 border-b border-line px-3 py-2">
              {(["buyer", "seller"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={role === option}
                  onClick={() => setRole(option)}
                  className={cn(
                    "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium transition-colors",
                    role === option ? "bg-iris-soft text-iris-hi" : "text-muted hover:bg-raised hover:text-fg",
                  )}
                >
                  {t(`roles.${option}`)}
                  {role !== option && unreadBy[option] > 0 && (
                    <span className="grid min-h-4.5 min-w-4.5 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold leading-none text-white">
                      {unreadBy[option] > 99 ? "99+" : unreadBy[option]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {account ? <HelpdeskThread key={role} role={role} isSeller={isSeller} /> : <SignedOutPanel next={pathname} />}
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : openPanel())}
        aria-expanded={open}
        aria-label={unread > 0 ? t("launcherUnread", { count: unread }) : t("launcher")}
        className={cn(
          "fixed right-4 z-40 grid h-13 w-13 place-items-center rounded-full bg-iris text-white shadow-card-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 sm:right-5",
          launcherRaised(pathname) ? "bottom-24 sm:bottom-5" : "bottom-4 sm:bottom-5",
          open && "max-sm:hidden",
        )}
      >
        {open ? <X size={20} /> : <Headset size={21} />}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
}

function SignedOutPanel({ next }: { next: string }) {
  const t = useTranslations("helpdesk");
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 py-8 text-center">
      <p className="text-[14px] font-medium">{t("signedOutTitle")}</p>
      <p className="text-[13px] leading-relaxed text-muted">{t("signedOutBody")}</p>
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="mx-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-iris px-5 text-[13px] font-medium text-white hover:brightness-110"
      >
        {t("signIn")} <ArrowRight size={14} />
      </Link>
      <Link href="/support" className="text-[13px] font-medium text-iris-hi hover:underline">{t("helpCenter")}</Link>
    </div>
  );
}

function HelpdeskThread({ role, isSeller }: { role: HelpdeskRole; isSeller: boolean }) {
  const t = useTranslations("helpdesk");
  const tc = useTranslations("chat");
  const locale = useLocale();
  const { account } = useAuth();
  const apiErrorMessage = useApiErrorMessage();
  const thread = useHelpdeskThread(role, true);
  const send = useSendHelpdesk(role);
  const uploads = useImageUploads("chat_attachment", MAX_IMAGES);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const room = thread.data ?? null;
  const messages = room?.messages ?? [];
  const time = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    input.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [messages.length]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    const images = uploads.images;
    if ((!body && images.length === 0) || uploads.uploading > 0 || send.isPending) return;
    setDraft("");
    uploads.reset();
    try {
      await send.mutateAsync({ body, clientMessageId: crypto.randomUUID(), attachments: images.map((image) => image.id) });
    } catch {
      setDraft(body);
      uploads.restore(images);
    }
  };

  const pickTopic = (topic: QuickTopic) => {
    const text = t(`topics.${topic}.prefill`);
    setDraft(text);
    // Caret after the prefill, so the buyer just types the code.
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(text.length, text.length);
    });
  };

  return (
    <>
      <div ref={timeline} className="flex-1 space-y-2 overflow-y-auto bg-base/40 px-3 py-3" aria-live="polite">
        {thread.isPending ? (
          <div className="grid h-full place-items-center"><Spinner /></div>
        ) : thread.isError ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="text-[13px] text-bad">{apiErrorMessage(thread.error, t("loadFailed"))}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => thread.refetch()}>{t("retry")}</Button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="px-2 py-3">
            <p className="text-[13.5px] font-medium">{t(role === "seller" ? "shopEmptyTitle" : "emptyTitle")}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t(role === "seller" ? "shopEmptyBody" : isSeller ? "sellerBuyerEmptyBody" : "emptyBody")}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {quickTopics(role, isSeller).map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => pickTopic(topic)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-fg hover:border-iris/50 hover:text-iris-hi"
                >
                  {t(`topics.${topic}.label`)}
                </button>
              ))}
            </div>
            <Link href="/support" className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">
              {t("helpCenter")} <ArrowRight size={13} />
            </Link>
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === account?.id;
            return (
              <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
                    mine ? "rounded-br-sm bg-iris text-white" : "rounded-bl-sm border border-line bg-surface text-fg",
                  )}
                >
                  {!mine && <span className="mb-0.5 block text-[11px] font-semibold text-iris-hi">{t("deskName")}</span>}
                  {!!message.attachments?.length && room && (
                    <ImageStrip
                      size="sm"
                      className={cn(message.body && "mb-1.5")}
                      title={tc("imagesTitle")}
                      images={message.attachments.map((image) => ({ ...privateImageSource(image, privateImageBase.chat(room.id)), id: image.id }))}
                    />
                  )}
                  {message.body && <p>{message.body}</p>}
                  <time dateTime={message.created_at} className={cn("mt-0.5 block text-right text-[10.5px]", mine ? "text-white/70" : "text-faint")}>
                    {time.format(new Date(message.created_at))}
                  </time>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={submit}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void uploads.addFiles(imageFilesFrom(event.dataTransfer)); }}
        className="border-t border-line bg-surface p-2.5"
      >
        <div className="mb-1.5 empty:hidden">
          <PendingImages images={uploads.images} uploading={uploads.uploading} errors={uploads.errors} onRemove={uploads.remove} />
        </div>
        <div className="flex items-end gap-1.5 rounded-xl border border-line bg-raised/60 p-1.5 focus-within:border-iris focus-within:bg-surface">
          <button
            type="button"
            onClick={() => attachInput.current?.click()}
            disabled={uploads.full}
            aria-label={tc("attachImages")}
            title={tc("attachImages")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface hover:text-fg disabled:opacity-40"
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={attachInput}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void uploads.addFiles(files);
            }}
          />
          <textarea
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              const files = imageFilesFrom(event.clipboardData);
              if (files.length) { event.preventDefault(); void uploads.addFiles(files); }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            maxLength={4000}
            aria-label={t("input")}
            placeholder={t("input")}
            className="max-h-28 min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none placeholder:text-faint"
          />
          <Button
            type="submit"
            size="sm"
            loading={send.isPending}
            disabled={(!draft.trim() && uploads.images.length === 0) || uploads.uploading > 0}
          >
            {t("send")}
          </Button>
        </div>
        {send.isError && <p role="alert" className="mt-1.5 text-[12px] text-bad">{apiErrorMessage(send.error, t("sendFailed"))}</p>}
      </form>
    </>
  );
}
