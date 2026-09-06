"use client";

import { FormEvent, UIEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { api } from "@/lib/api";
import type { ChatConversation, ChatConversationList, ChatMessage } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";
import { useAdminSupportConversations, useChatConversation, useChatConversations, useSendChatMessage } from "@/hooks/use-chat";
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
import { ADMIN_SUPPORT_HREF, INBOX_HREF, orderWorkspaceHref } from "@/lib/chat-inbox";
import { useApiErrorMessage } from "@/lib/use-api-error";

function contextLabel(
  room: ChatConversation,
  t: ReturnType<typeof useTranslations<"chat">>,
  tos: ReturnType<typeof useTranslations<"status.order">>,
) {
  if (room.kind === "support") {
    return room.order ? `${t("marketplaceSupport")} · ${t("order")} #${room.order.id}` : t("marketplaceSupport");
  }
  if (room.kind !== "order") return t("preSale");
  if (!room.order) return t("orderChat");
  const statusKey = `${room.order.status}.label`;
  const status = tos.has(statusKey) ? tos(statusKey) : room.order.status;
  return `${t("order")} #${room.order.id} · ${status}`;
}

function RoomIcon({ kind, size = 15 }: { kind: ChatConversation["kind"]; size?: number }) {
  if (kind === "order") return <Receipt size={size} />;
  if (kind === "support") return <ShieldCheck size={size} />;
  return <MessageCircle size={size} />;
}

function mergeChatMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function parseDisputeReason(reason: string): { tags: string[]; note: string } {
  if (!reason) return { tags: [], note: "" };
  const matches = reason.match(/\[(.*?)\]/g);
  if (!matches || matches.length === 0) return { tags: [], note: reason.trim() };
  const tags = matches.map((m) => m.slice(1, -1).trim()).filter(Boolean);
  const note = reason.replace(/\[(.*?)\]/g, "").trim();
  return { tags, note };
}

export default function InboxWorkbench({
  initialConversationId = null,
  variant = "user",
}: {
  initialConversationId?: string | null;
  variant?: "user" | "admin-support";
}) {
  const t = useTranslations("chat");
  const tos = useTranslations("status.order");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { account, loading: authLoading } = useAuth();
  const { formatCheckoutMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [draft, setDraft] = useState("");
  const [timelineMessages, setTimelineMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const stickToBottom = useRef(true);
  const hydratedRoom = useRef<string | null>(null);
  const olderRequestId = useRef(0);
  const adminMode = variant === "admin-support";
  const inboxHref = adminMode ? ADMIN_SUPPORT_HREF : INBOX_HREF;
  const userList = useChatConversations(!adminMode && !!account);
  const adminList = useAdminSupportConversations(adminMode && !!account);
  const list = adminMode ? adminList : userList;
  const detail = useChatConversation(selectedId);
  const send = useSendChatMessage();
  const timeline = useRef<HTMLDivElement>(null);
  useChatEvents(!!account);

  const listKey = adminMode ? queryKeys.adminSupportList() : queryKeys.chatList();
  const markRoomRead = (id: string) =>
    queryClient.setQueryData<ChatConversationList>(
      listKey,
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
    if (!authLoading && !account && !adminMode) router.push(`/login?next=${INBOX_HREF}`);
  }, [account, authLoading, router]);

  useEffect(() => {
    olderRequestId.current += 1;
    hydratedRoom.current = null;
    setTimelineMessages([]);
    setOlderCursor(null);
    setLoadingOlder(false);
    stickToBottom.current = true;
  }, [selectedId]);

  useEffect(() => {
    if (!detail.data || detail.data.id !== selectedId) return;
    if (hydratedRoom.current !== selectedId) {
      hydratedRoom.current = selectedId;
      setTimelineMessages(detail.data.messages);
      setOlderCursor(detail.data.next_cursor);
    } else {
      setTimelineMessages((prev) => mergeChatMessages(prev, detail.data.messages));
    }
    queryClient.setQueryData<ChatConversationList>(listKey, (current) =>
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
  }, [detail.data, queryClient, selectedId]);

  useLayoutEffect(() => {
    if (stickToBottom.current && timeline.current) {
      timeline.current.scrollTop = timeline.current.scrollHeight;
    }
  }, [selectedId, timelineMessages]);

  const loadOlder = async () => {
    if (!selectedId || olderCursor == null || loadingOlder) return;
    const requestId = ++olderRequestId.current;
    const roomId = selectedId;
    const node = timeline.current;
    const previousHeight = node?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const page = await api.chatConversation(roomId, olderCursor);
      if (requestId !== olderRequestId.current) return;
      setTimelineMessages((prev) => mergeChatMessages(page.messages, prev));
      setOlderCursor(page.next_cursor);
      requestAnimationFrame(() => {
        if (node) node.scrollTop = node.scrollHeight - previousHeight;
      });
    } finally {
      if (requestId === olderRequestId.current) setLoadingOlder(false);
    }
  };

  const onTimelineScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    if (node.scrollTop < 48) void loadOlder();
  };

  const selectRoom = (id: string) => {
    olderRequestId.current += 1;
    markRoomRead(id);
    setSelectedId(id);
    router.replace(`${inboxHref}/${id}`, { scroll: false });
  };

  const goBack = () => {
    setSelectedId(null);
    router.replace(inboxHref, { scroll: false });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId || send.isPending) return;
    setDraft("");
    stickToBottom.current = true;
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
  const roomIsSupport = room?.kind === "support";
  const title = room?.product?.title ?? room?.counterpart.label;
  const roomContext = room ? contextLabel(room, t, tos) : null;
  const isSellerCounterpart = room?.counterpart.role === "seller";
  const orderHref = orderWorkspaceHref(room?.counterpart.role ?? "seller", room?.order?.id, { admin: adminMode });
  const readOnlyReason = room?.order?.status === "refunded"
    ? t("readOnlyRefunded")
    : room?.order?.status === "cancelled"
      ? t("readOnlyCancelled")
      : t("readOnly");

  return (
    <div className={cn(
      "w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-2.5 sm:py-3.5 flex-1 flex flex-col overflow-hidden",
      adminMode
        ? "h-[calc(100dvh-168px)] max-h-[calc(100dvh-168px)] max-w-none px-0 sm:px-0 py-0"
        : "h-[calc(100dvh-92px)] max-h-[calc(100dvh-92px)]",
    )}>
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
              <h1 className="text-[14.5px] font-bold text-fg">{adminMode ? t("marketplaceInbox") : t("inbox")}</h1>
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
                <p className="mt-3 text-[13.5px] font-semibold text-fg">{adminMode ? t("marketplaceEmpty") : t("empty")}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{adminMode ? t("marketplaceEmptyHint") : t("emptyHint")}</p>
              </div>
            )}
            {rooms.map((item) => {
              const isOrder = item.kind === "order";
              const isSupport = item.kind === "support";
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
                      isSupport
                        ? "border-iris/25 bg-iris-soft text-iris"
                        : isOrder
                        ? "border-warn/25 bg-warn-soft text-warn"
                        : "border-iris/25 bg-iris-soft text-iris",
                    )}
                  >
                    <RoomIcon kind={item.kind} size={15} />
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
                          isSupport
                            ? "bg-iris-soft text-iris-hi"
                            : isOrder
                            ? "bg-warn-soft text-warn"
                            : "bg-iris-soft text-iris-hi",
                        )}
                      >
                        {isSupport ? t("marketplaceChat") : isOrder ? `${t("order")}` : t("preSale")}
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
              {apiErrorMessage(detail.error, t("error"))}
            </div>
          ) : (
            <>
              {/* Header */}
              {/* Header */}
              <header className="flex min-h-[58px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/95 px-3.5 py-2 sm:px-5 backdrop-blur-xs">
                <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                  <button
                    onClick={goBack}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-raised lg:hidden"
                    aria-label={t("back")}
                    type="button"
                  >
                    <ChevronLeft size={17} />
                  </button>

                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-xl border",
                      roomIsSupport
                        ? "border-iris/25 bg-iris-soft text-iris"
                        : roomIsOrder
                        ? "border-warn/25 bg-warn-soft text-warn"
                        : "border-iris/25 bg-iris-soft text-iris",
                    )}
                  >
                    <RoomIcon kind={room.kind} size={16} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {room.product ? (
                        <Link
                          href={`/products/${room.product.id}`}
                          className="group flex min-w-0 max-w-full items-center gap-1 text-[13.5px] font-bold text-fg transition-colors hover:text-iris"
                          title={room.product.title}
                        >
                          <span className="truncate">{room.product.title}</span>
                          <ExternalLink size={11} className="shrink-0 text-iris opacity-60 group-hover:opacity-100" />
                        </Link>
                      ) : (
                        <h2 className="truncate text-[13.5px] font-bold text-fg">{title}</h2>
                      )}
                      {room.dispute && (
                        <span className="hidden sm:inline-flex shrink-0 items-center rounded-md border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-warn">
                          {t("disputeReviewStatus")}
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted overflow-hidden text-ellipsis whitespace-nowrap">
                      {roomIsSupport ? (
                        <>
                          <span className="font-medium text-fg shrink-0">
                            {adminMode
                              ? `${room.counterpart.role === "seller" ? t("seller") : t("customer")}: ${room.counterpart.label}`
                              : t("marketplaceSupportTeam")}
                          </span>
                          {room.order && (
                            <>
                              <span className="text-line-2 shrink-0">•</span>
                              <span className="tabular font-medium text-faint shrink-0">
                                {t("order")} #{room.order.id}
                              </span>
                              <span className="text-line-2 shrink-0">•</span>
                              <span className="font-mono text-faint shrink-0">
                                {formatCheckoutMoney(room.order.total_amount, { locale })}
                              </span>
                            </>
                          )}
                        </>
                      ) : isSellerCounterpart ? (
                        <>
                          <Link
                            href={`/sellers/${room.counterpart.id}`}
                            className="font-medium text-iris hover:underline truncate max-w-[160px]"
                            title={t("viewSeller")}
                          >
                            {room.counterpart.label}
                          </Link>
                          <span>•</span>
                          <span className="font-medium">{roomContext}</span>
                        </>
                      ) : (
                        <>
                          <span className="truncate max-w-[160px]">{room.counterpart.label}</span>
                          <span>•</span>
                          <span className="font-medium">{roomContext}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Header quick link */}
                <div className="flex shrink-0 items-center gap-2">
                  {adminMode && room.dispute ? (
                    <Link
                      href={`/admin/disputes?dispute_id=${room.dispute.id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-iris px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-iris-hi transition-colors shadow-xs"
                    >
                      <span>{t("adminResolveDispute")}</span>
                      <ExternalLink size={11} />
                    </Link>
                  ) : room.order ? (
                    <Link
                      href={orderHref}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-raised/70 px-2.5 py-1 text-[11.5px] font-medium text-fg hover:border-iris/40 hover:bg-surface transition-colors shadow-xs"
                    >
                      <span>{t("viewOrder")}</span>
                      <ExternalLink size={11} />
                    </Link>
                  ) : null}
                </div>
              </header>

              {/* Timeline message list */}
              <div
                ref={timeline}
                onScroll={onTimelineScroll}
                className="flex-1 space-y-2.5 overflow-y-auto bg-base/30 p-3 sm:p-4"
              >
                {/* Compact safety notice */}
                <div className="mx-auto flex max-w-[620px] items-center gap-2 rounded-xl border border-warn/25 bg-warn-soft/40 px-3 py-1.5 text-[11px] font-medium text-warn shadow-xs">
                  <ShieldCheck size={14} className="shrink-0 text-warn" />
                  <span className="leading-tight">{t("safety")}</span>
                </div>

                {/* Enriched Dispute Review Context Banner */}
                {roomIsSupport && (
                  <div className="mx-auto max-w-[620px] rounded-xl border border-iris/25 bg-surface p-3.5 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-line/60 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded-md bg-iris text-white">
                          <ShieldCheck size={13} />
                        </span>
                        <h3 className="text-[12.5px] font-bold text-fg">
                          {t("disputeContextTitle")} · {t("order")} #{room.order?.id}
                        </h3>
                      </div>
                      <span className="rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[10.5px] font-bold text-warn">
                        {t("disputeReviewStatus")}
                      </span>
                    </div>

                    {room.dispute && (() => {
                      const { tags, note } = parseDisputeReason(room.dispute.reason);
                      return (
                        <div className="mt-2.5 space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                            <span className="font-semibold text-faint shrink-0">{t("disputeReasonLabel")}:</span>
                            {tags.length > 0 ? (
                              tags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center rounded-md border border-line bg-raised/70 px-1.5 py-0.5 text-[11px] font-medium text-fg"
                                >
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="font-medium text-fg">{room.dispute.reason}</span>
                            )}
                            {note && <span className="text-muted text-[11.5px] ml-1">{note}</span>}
                          </div>

                          <div className="grid grid-cols-3 gap-2 rounded-lg border border-line bg-raised/30 p-2 text-center text-[11px]">
                            <div className="rounded-md bg-bad-soft/40 py-1">
                              <p className="text-muted text-[10.5px] font-medium">{t("disputeClaimed")}</p>
                              <p className="mt-0.5 font-mono text-[13.5px] font-bold text-bad tabular">{room.dispute.claimed_count}</p>
                            </div>
                            <div className="rounded-md bg-iris-soft/40 py-1">
                              <p className="text-muted text-[10.5px] font-medium">{t("disputeReplaced")}</p>
                              <p className="mt-0.5 font-mono text-[13.5px] font-bold text-iris tabular">{room.dispute.replaced_count}</p>
                            </div>
                            <div className="rounded-md bg-warn-soft/40 py-1">
                              <p className="text-muted text-[10.5px] font-medium">{t("disputePending")}</p>
                              <p className="mt-0.5 font-mono text-[13.5px] font-bold text-warn tabular">{room.dispute.pending_count}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <p className="mt-2 text-[11px] leading-relaxed text-muted border-t border-line/50 pt-2">
                      {adminMode ? t("disputeAdminAdvice") : t("disputeBuyerAdvice")}
                    </p>
                  </div>
                )}

                {olderCursor != null && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => void loadOlder()}
                      disabled={loadingOlder}
                      className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium text-muted hover:text-fg"
                    >
                      {loadingOlder ? t("loading") : t("loadOlder")}
                    </button>
                  </div>
                )}
                {timelineMessages.map((message) => {
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
                    {readOnlyReason}
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
                    placeholder={room.can_send ? t("input") : readOnlyReason}
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
                  <p className="mx-auto mt-1.5 max-w-[680px] text-[11px] text-bad">
                    {apiErrorMessage(send.error, t("sendFailed"))}
                  </p>
                )}
              </form>
            </>
          )}
        </main>

        {/* Right Info Sidebar: Product & Order Context */}
        <aside className="hidden flex-col overflow-y-auto border-l border-line bg-base/20 p-3.5 xl:flex">
          {room ? (
            <div className="space-y-3">
              {/* Product preview card */}
              {room.product && (
                <div className="rounded-xl border border-line bg-surface p-3 shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-faint">
                    {roomIsOrder ? t("orderChat") : t("product")}
                  </span>
                  <div className="mt-2 flex items-center gap-2.5">
                    <ProductCover
                      coverId={parseCoverId(room.product)}
                      title={room.product.title}
                      className="h-10 w-10 shrink-0 rounded-lg border-line"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${room.product.id}`}
                        className="group block truncate text-[12.5px] font-semibold text-fg hover:text-iris transition-colors"
                        title={room.product.title}
                      >
                        {room.product.title}
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Order & Dispute details summary card */}
              {room.order && (
                <div className="rounded-xl border border-line bg-surface p-3 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-faint">
                      {t("order")} #{room.order.id}
                    </span>
                    <Link
                      href={orderHref}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-iris hover:underline"
                    >
                      <span>{t("viewOrder")}</span>
                      <ExternalLink size={10} />
                    </Link>
                  </div>

                  <dl className="mt-2 space-y-1.5 text-[12px]">
                    <div className="flex justify-between">
                      <dt className="text-muted">{t("quantity")}</dt>
                      <dd className="font-semibold text-fg tabular">{room.order.quantity}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">{t("total")}</dt>
                      <dd className="font-mono font-semibold text-fg tabular">
                        {formatCheckoutMoney(room.order.total_amount, { locale })}
                      </dd>
                    </div>
                    {room.dispute && (
                      <div className="border-t border-line/60 pt-2 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <dt className="text-muted">{t("disputeStatus")}</dt>
                          <dd>
                            <span className="inline-flex items-center rounded-full border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                              {t("disputeReviewStatus")}
                            </span>
                          </dd>
                        </div>
                        {adminMode && room.dispute && (
                          <Link
                            href={`/admin/disputes?dispute_id=${room.dispute.id}`}
                            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-iris px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-iris-hi transition-colors shadow-2xs"
                          >
                            <span>{t("adminResolveDispute")}</span>
                            <ExternalLink size={11} />
                          </Link>
                        )}
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Counterpart info */}
              <div className="rounded-xl border border-line bg-surface p-3 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-faint">
                  {roomIsSupport
                    ? (adminMode ? t("supportRequester") : t("supportProvider"))
                    : (isSellerCounterpart ? t("seller") : t("customer"))}
                </span>
                <p className="mt-1.5 text-[12.5px] font-semibold text-fg truncate">
                  {roomIsSupport && !adminMode ? t("marketplaceSupportTeam") : room.counterpart.label}
                </p>
                {isSellerCounterpart && !roomIsSupport && (
                  <Link
                    href={`/sellers/${room.counterpart.id}`}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-iris hover:underline"
                  >
                    <span>{t("viewSeller")}</span>
                    <ExternalLink size={10} />
                  </Link>
                )}
              </div>

              {/* Safe Escrow badge */}
              <div className="rounded-xl border border-line bg-surface/50 p-2.5 text-[11px] text-faint flex items-start gap-2">
                <ShieldCheck size={14} className="text-good shrink-0 mt-0.5" />
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
