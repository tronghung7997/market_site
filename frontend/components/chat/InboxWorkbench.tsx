"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { ChatConversation, ChatConversationList } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";
import { useChatConversation, useChatConversations, useSendChatMessage } from "@/hooks/use-chat";
import { useChatEvents } from "@/hooks/use-chat-events";
import {
  ChevronLeft,
  Inbox,
  MessageCircle,
  Package,
  Receipt,
  ShieldCheck,
  ExternalLink,
  Store,
} from "@/components/Icons";
import { Button, Spinner } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";
import { parseCoverId } from "@/lib/product-covers";
import { INBOX_HREF, orderWorkspaceHref } from "@/lib/chat-inbox";

function contextLabel(
  room: ChatConversation,
  t: ReturnType<typeof useTranslations<"chat">>,
  tos: ReturnType<typeof useTranslations<"status.order">>,
) {
  if (room.kind !== "order") return t("preSale");
  if (!room.order) return t("orderChat");
  const statusKey = `${room.order.status}.label`;
  const status = tos.has(statusKey) ? tos(statusKey) : room.order.status;
  return `${t("order")} #${room.order.id} · ${status}`;
}

function RoomIcon({ order, size = 15 }: { order: boolean; size?: number }) {
  return order ? <Receipt size={size} /> : <MessageCircle size={size} />;
}

export default function InboxWorkbench({
  initialConversationId = null,
}: {
  initialConversationId?: string | null;
}) {
  const t = useTranslations("chat");
  const tos = useTranslations("status.order");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { account, loading: authLoading } = useAuth();
  const { formatCheckoutMoney } = useMoney();
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [draft, setDraft] = useState("");
  const list = useChatConversations();
  const detail = useChatConversation(selectedId);
  const send = useSendChatMessage();
  const timeline = useRef<HTMLDivElement>(null);
  useChatEvents(!!account);

  const markRoomRead = (id: string) =>
    queryClient.setQueryData<ChatConversationList>(
      queryKeys.chatList(),
      (current) =>
        current
          ? {
              ...current,
              items: current.items.map((room) =>
                room.id === id ? { ...room, unread_count: 0 } : room,
              ),
            }
          : current,
    );

  useEffect(() => {
    if (!authLoading && !account) router.push(`/login?next=${INBOX_HREF}`);
  }, [account, authLoading, router]);

  useEffect(() => {
    if (!detail.data) return;
    if (timeline.current) {
      timeline.current.scrollTop = timeline.current.scrollHeight;
    }
    queryClient.setQueryData<ChatConversationList>(queryKeys.chatList(), (current) =>
      current
        ? {
            ...current,
            items: current.items.map((room) =>
              room.id === detail.data?.id ? { ...room, unread_count: 0 } : room,
            ),
          }
        : current,
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.actionItems() });
  }, [detail.data, queryClient]);

  const selectRoom = (id: string) => {
    markRoomRead(id);
    setSelectedId(id);
    router.replace(`${INBOX_HREF}/${id}`, { scroll: false });
  };

  const goBack = () => {
    setSelectedId(null);
    router.replace(INBOX_HREF, { scroll: false });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId || send.isPending) return;
    setDraft("");
    try {
      await send.mutateAsync({
        conversationId: selectedId,
        body,
        clientMessageId: crypto.randomUUID(),
      });
    } catch {
      setDraft(body);
    }
  };

  if (authLoading || !account) {
    return (
      <div className="grid min-h-[420px] place-items-center">
        <Spinner />
      </div>
    );
  }

  const rooms = list.data?.items ?? [];
  const room = detail.data;
  const roomIsOrder = room?.kind === "order";
  const title = room?.product?.title ?? room?.counterpart.label;
  const roomContext = room ? contextLabel(room, t, tos) : null;
  const isSellerCounterpart = room?.counterpart.role === "seller";
  const orderHref = orderWorkspaceHref(room?.counterpart.role ?? "seller", room?.order?.id);

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-2.5 sm:py-3.5 flex-1 flex flex-col h-[calc(100dvh-92px)] max-h-[calc(100dvh-92px)] overflow-hidden">
      <section className="grid h-full w-full flex-1 overflow-hidden rounded-xl border border-line bg-surface shadow-xs sm:rounded-2xl sm:shadow-card lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_260px]">
        {/* Left Sidebar: Conversation List */}
        <aside
          className={cn(
            "flex h-full flex-col overflow-hidden border-r border-line bg-surface",
            selectedId && "hidden lg:flex",
          )}
        >
          <header className="flex items-center justify-between border-b border-line bg-surface/90 px-3.5 py-3 backdrop-blur-xs">
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-iris-soft text-iris">
                <Inbox size={15} />
              </div>
              <h1 className="text-[14.5px] font-bold text-fg">{t("inbox")}</h1>
            </div>
            {rooms.length > 0 && (
              <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-semibold text-faint">
                {rooms.length}
              </span>
            )}
          </header>

          <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
            {list.isLoading && (
              <div className="p-6 text-center">
                <Spinner />
              </div>
            )}
            {!list.isLoading && rooms.length === 0 && (
              <div className="px-5 py-12 text-center">
                <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-raised text-faint">
                  <MessageCircle size={20} />
                </div>
                <p className="mt-3 text-[13.5px] font-semibold text-fg">{t("empty")}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{t("emptyHint")}</p>
              </div>
            )}
            {rooms.map((item) => {
              const isOrder = item.kind === "order";
              const itemIsSeller = item.counterpart.role === "seller";
              const itemTitle = item.product?.title ?? item.counterpart.label;
              const isSelected = selectedId === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => selectRoom(item.id)}
                  type="button"
                  className={cn(
                    "group relative flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-all",
                    isSelected
                      ? "bg-gradient-to-r from-iris-soft/95 to-surface shadow-xs ring-1 ring-iris/30"
                      : "hover:bg-raised/70 active:bg-raised",
                  )}
                >
                  {/* Icon badge */}
                  <span
                    className={cn(
                      "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-transform group-hover:scale-105",
                      isOrder
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                        : "border-indigo-500/30 bg-indigo-500/10 text-iris",
                    )}
                  >
                    <RoomIcon order={isOrder} size={15} />
                  </span>

                  {/* Body preview */}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-1.5">
                      <span
                        className={cn(
                          "truncate text-[13px] font-semibold",
                          isSelected ? "text-iris-hi" : "text-fg",
                        )}
                      >
                        {itemTitle}
                      </span>
                      {item.unread_count > 0 && (
                        <span className="inline-flex min-w-4.5 items-center justify-center rounded-full bg-iris px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs">
                          {item.unread_count}
                        </span>
                      )}
                    </span>

                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-medium tracking-tight whitespace-nowrap",
                          isOrder
                            ? "bg-amber-500/15 text-amber-800"
                            : "bg-indigo-500/15 text-iris-hi",
                        )}
                      >
                        {isOrder ? `${t("order")}` : t("preSale")}
                      </span>
                      {itemIsSeller && item.product?.title && (
                        <span className="truncate text-faint">· {item.counterpart.label}</span>
                      )}
                    </div>

                    <span className="mt-1 block truncate text-[11.5px] leading-normal text-faint">
                      {item.last_message?.body ?? item.counterpart.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Center: Active Chat Stream */}
        <main
          className={cn(
            "flex h-full flex-col overflow-hidden bg-surface",
            selectedId ? "flex" : "hidden lg:flex",
          )}
        >
          {!selectedId ? (
            <div className="grid h-full flex-1 place-items-center bg-raised/30 p-6 text-center">
              <div className="max-w-xs">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-iris-soft text-iris shadow-xs">
                  <MessageCircle size={24} />
                </div>
                <h2 className="mt-3.5 text-[15px] font-bold text-fg">{t("choose")}</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-faint">{t("chooseHint")}</p>
              </div>
            </div>
          ) : detail.isLoading ? (
            <div className="grid h-full flex-1 place-items-center">
              <Spinner />
            </div>
          ) : detail.isError || !room ? (
            <div className="grid h-full flex-1 place-items-center text-bad font-medium">
              {t("error")}
            </div>
          ) : (
            <>
              {/* Header */}
              <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/90 px-3 py-2 sm:px-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <button
                    onClick={goBack}
                    className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-raised lg:hidden"
                    aria-label={t("back")}
                    type="button"
                  >
                    <ChevronLeft size={17} />
                  </button>

                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-lg border",
                      roomIsOrder
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                        : "border-indigo-500/30 bg-indigo-500/10 text-iris",
                    )}
                  >
                    <RoomIcon order={roomIsOrder} size={15} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {room.product ? (
                        <Link
                          href={`/products/${room.product.id}`}
                          className="group inline-flex max-w-[260px] items-center gap-1 truncate text-[13.5px] font-bold text-fg transition-colors hover:text-iris sm:max-w-[400px]"
                          title={t("viewProduct")}
                        >
                          <span className="truncate">{room.product.title}</span>
                          <ExternalLink size={12} className="shrink-0 text-iris opacity-70 group-hover:opacity-100" />
                        </Link>
                      ) : (
                        <h2 className="truncate text-[13.5px] font-bold text-fg">{title}</h2>
                      )}
                    </div>

                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
                      {isSellerCounterpart ? (
                        <Link
                          href={`/sellers/${room.counterpart.id}`}
                          className="truncate max-w-[160px] sm:max-w-[260px] font-medium text-iris hover:underline"
                          title={t("viewSeller")}
                        >
                          {room.counterpart.label}
                        </Link>
                      ) : (
                        <span className="truncate max-w-[160px] sm:max-w-[260px]">{room.counterpart.label}</span>
                      )}
                      <span>•</span>
                      <span className="shrink-0 whitespace-nowrap font-medium">{roomContext}</span>
                    </div>
                  </div>
                </div>

                {/* Header quick link */}
                <div className="flex shrink-0 items-center gap-2">
                  {room.product && (
                    <Link
                      href={`/products/${room.product.id}`}
                      className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-line bg-raised/70 px-2.5 py-1 text-[11.5px] font-semibold text-fg hover:border-iris/40 hover:bg-iris-soft hover:text-iris transition-colors shadow-xs whitespace-nowrap"
                    >
                      <span>{t("viewProduct")}</span>
                      <ExternalLink size={11} />
                    </Link>
                  )}
                  {roomIsOrder && room.order && (
                    <Link
                      href={orderHref}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-amber-800 hover:bg-amber-500/20 transition-colors shadow-xs whitespace-nowrap"
                    >
                      <span>{t("viewOrder")}</span>
                      <ExternalLink size={11} />
                    </Link>
                  )}
                </div>
              </header>

              {/* Order quick status strip */}
              {roomIsOrder && room.order && (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-surface to-amber-500/5 px-3.5 py-1.5 text-[11.5px]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-800">
                      {t("order")} #{room.order.id}
                    </span>
                    <span className="text-faint">·</span>
                    <span className="text-faint">
                      {t("quantity")}: <strong className="text-fg">{room.order.quantity}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-good">
                      {formatCheckoutMoney(room.order.total_amount, { locale })}
                    </span>
                  </div>
                </div>
              )}

              {/* Timeline message list */}
              <div
                ref={timeline}
                className="flex-1 space-y-2 overflow-y-auto bg-base/40 p-3 sm:p-4"
              >
                {/* Compact safety notice */}
                <div className="mx-auto flex max-w-[640px] items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-800 shadow-xs">
                  <ShieldCheck size={14} className="shrink-0 text-amber-700" />
                  <span className="leading-tight">{t("safety")}</span>
                </div>

                {room.messages.map((message) => {
                  const mine = message.sender_id === account.id;
                  return (
                    <div
                      key={message.id}
                      className={cn("mx-auto flex max-w-[640px]", mine ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed shadow-xs",
                          mine
                            ? "rounded-br-xs bg-gradient-to-br from-iris to-iris-hi text-white shadow-iris/15"
                            : "rounded-bl-xs border border-line bg-surface text-fg",
                        )}
                      >
                        <p className="select-text">{message.body}</p>
                        <time
                          className={cn(
                            "mt-0.5 block text-right text-[10px]",
                            mine ? "text-white/70" : "text-faint",
                          )}
                        >
                          {new Intl.DateTimeFormat(locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(message.created_at))}
                        </time>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Input action toolbar */}
              <form onSubmit={submit} className="shrink-0 border-t border-line bg-surface p-2 sm:p-3">
                {!room.can_send && (
                  <p className="mx-auto mb-2 max-w-[680px] rounded-lg border border-warn/25 bg-warn-soft px-3 py-1.5 text-[11px] text-warn">
                    {room.read_only_reason ?? t("readOnly")}
                  </p>
                )}
                <div className="mx-auto flex max-w-[680px] items-end gap-2 rounded-xl border border-line bg-raised/70 p-1.5 pl-3 transition-all focus-within:border-iris focus-within:bg-surface focus-within:ring-2 focus-within:ring-iris/15">
                  <textarea
                    name="message"
                    aria-label={t("input")}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={1}
                    maxLength={4000}
                    placeholder={room.can_send ? t("input") : (room.read_only_reason ?? t("readOnly"))}
                    className="max-h-24 min-h-[34px] flex-1 resize-none bg-transparent py-1 text-[13px] outline-none placeholder:text-faint/70"
                    disabled={!room.can_send}
                  />
                  <Button
                    type="submit"
                    disabled={!draft.trim() || send.isPending || !room.can_send}
                    className="h-8 rounded-lg px-3 py-1 text-[12px] font-semibold shadow-xs"
                  >
                    {send.isPending ? t("sending") : t("send")}
                  </Button>
                </div>
                {send.isError && (
                  <p className="mx-auto mt-1.5 max-w-[680px] text-[11px] text-bad">{send.error.message}</p>
                )}
              </form>
            </>
          )}
        </main>

        {/* Right Info Sidebar: Product & Order Context */}
        <aside className="hidden flex-col overflow-y-auto border-l border-line bg-base/30 p-3.5 xl:flex">
          {room?.product ? (
            <div className="space-y-3">
              {/* Product preview card */}
              <div className="rounded-xl border border-line bg-surface p-3 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <ProductCover
                    coverId={parseCoverId(room.product)}
                    title={room.product.title}
                    className="h-10 w-10 rounded-lg border-line"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="inline-block rounded bg-indigo-500/10 px-1.5 py-0.2 text-[9.5px] font-bold uppercase tracking-wider text-iris">
                      {roomIsOrder ? t("orderChat") : t("product")}
                    </span>
                    <Link
                      href={`/products/${room.product.id}`}
                      className="group mt-0.5 block truncate text-[12.5px] font-bold text-fg hover:text-iris transition-colors"
                      title={room.product.title}
                    >
                      <span>{room.product.title}</span>
                    </Link>
                  </div>
                </div>

                <div className="mt-2.5 border-t border-line/70 pt-2 text-[11.5px]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-faint">
                    {isSellerCounterpart ? t("seller") : t("customer")}
                  </span>
                  <div className="mt-1 flex flex-col gap-1.5">
                    <span className="font-medium text-fg truncate text-[12px]" title={room.counterpart.label}>
                      {room.counterpart.label}
                    </span>
                    {isSellerCounterpart && (
                      <Link
                        href={`/sellers/${room.counterpart.id}`}
                        className="inline-flex w-fit items-center gap-1 rounded-md bg-raised px-2 py-0.5 text-[11px] font-medium text-iris hover:bg-iris-soft hover:text-iris-hi transition-colors whitespace-nowrap shadow-xs"
                      >
                        <span>{t("viewSeller")}</span>
                        <ExternalLink size={9.5} />
                      </Link>
                    )}
                  </div>
                </div>
              </div>

              {/* Order details summary card */}
              {roomIsOrder && room.order && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 shadow-xs">
                  <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 shrink-0">
                      {t("order")} #{room.order.id}
                    </span>
                    <Link
                      href={orderHref}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-iris hover:underline shrink-0 whitespace-nowrap"
                    >
                      <span>{t("viewOrder")}</span>
                      <ExternalLink size={10} />
                    </Link>
                  </div>

                  <dl className="mt-2 space-y-1.5 text-[11.5px]">
                    <div className="flex justify-between">
                      <dt className="text-faint">{t("quantity")}</dt>
                      <dd className="font-semibold text-fg">{room.order.quantity}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-faint">{t("total")}</dt>
                      <dd className="font-mono font-bold text-good">
                        {formatCheckoutMoney(room.order.total_amount, { locale })}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Safe Escrow badge */}
              <div className="rounded-xl border border-line bg-surface/70 p-2.5 text-[11px] text-faint flex items-start gap-2">
                <ShieldCheck size={15} className="text-good shrink-0 mt-0.5" />
                <span className="leading-snug">Proxora Escrow protected. All transactions and chats are recorded safely.</span>
              </div>
            </div>
          ) : (
            <p className="text-[11.5px] text-faint">{t("chooseHint")}</p>
          )}
        </aside>
      </section>
    </div>
  );
}
