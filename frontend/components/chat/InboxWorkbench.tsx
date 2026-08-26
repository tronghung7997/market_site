"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { ChatConversation, ChatConversationList } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";
import { useChatConversation, useChatConversations, useSendChatMessage } from "@/hooks/use-chat";
import { useChatEvents } from "@/hooks/use-chat-events";
import { ChevronLeft, Inbox, MessageCircle, Package } from "@/components/Icons";
import { Button, Spinner } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";
import { parseCoverId } from "@/lib/product-covers";

const copy = {
  vi: {
    inbox: "Tin nhắn", buyerInbox: "Trao đổi sản phẩm và đơn hàng", sellerInbox: "Hộp thư người bán",
    preSale: "Trao đổi trước mua", orderChat: "Trao đổi theo đơn", order: "Đơn hàng",
    empty: "Chưa có cuộc trò chuyện", buyerEmpty: "Mở một sản phẩm và chọn Hỏi người bán để bắt đầu.",
    sellerEmpty: "Câu hỏi từ buyer và trao đổi theo đơn sẽ xuất hiện ở đây.", choose: "Chọn một cuộc trò chuyện",
    chooseHint: "Tin nhắn và bối cảnh giao dịch sẽ hiện ở đây.", input: "Nhập tin nhắn...", send: "Gửi",
    product: "Sản phẩm đang trao đổi", quantity: "Số lượng", total: "Tổng tiền", viewOrder: "Xem đơn hàng",
    safety: "Không gửi mật khẩu, mã khôi phục hoặc thanh toán ngoài nền tảng.", loading: "Đang tải cuộc trò chuyện",
    error: "Không tải được tin nhắn", back: "Quay lại", readOnly: "Cuộc trò chuyện hiện chỉ đọc.",
  },
  en: {
    inbox: "Messages", buyerInbox: "Product and order conversations", sellerInbox: "Seller inbox",
    preSale: "Pre-sale inquiry", orderChat: "Order conversation", order: "Order", empty: "No conversations yet",
    buyerEmpty: "Open a product and choose Ask seller to start.", sellerEmpty: "Buyer questions and order conversations will appear here.",
    choose: "Choose a conversation", chooseHint: "Messages and transaction context will appear here.", input: "Write a message...",
    send: "Send", product: "Product context", quantity: "Quantity", total: "Total", viewOrder: "View order",
    safety: "Do not share passwords, recovery codes, or pay outside the platform.", loading: "Loading conversation",
    error: "Could not load messages", back: "Back", readOnly: "This conversation is read-only.",
  },
};

const orderStatus: Record<string, { vi: string; en: string }> = {
  pending: { vi: "Chờ xử lý", en: "Pending" }, processing: { vi: "Đang xử lý", en: "Processing" },
  delivered: { vi: "Đã giao", en: "Delivered" }, completed: { vi: "Hoàn tất", en: "Completed" },
  disputed: { vi: "Đang khiếu nại", en: "Disputed" }, refunded: { vi: "Đã hoàn tiền", en: "Refunded" },
  cancelled: { vi: "Đã huỷ", en: "Cancelled" },
};

function contextLabel(room: ChatConversation, locale: "vi" | "en") {
  if (room.kind !== "order") return copy[locale].preSale;
  if (!room.order) return copy[locale].orderChat;
  const status = orderStatus[room.order.status]?.[locale] ?? room.order.status;
  return `${copy[locale].order} #${room.order.id} · ${status}`;
}

function RoomIcon({ order, size = 17 }: { order: boolean; size?: number }) {
  return order ? <Inbox size={size} /> : <Package size={size} />;
}

export default function InboxWorkbench({ perspective, initialConversationId = null }: {
  perspective: "buyer" | "seller"; initialConversationId?: string | null;
}) {
  const locale = useLocale() === "vi" ? "vi" : "en";
  const t = copy[locale];
  const router = useRouter();
  const queryClient = useQueryClient();
  const { account, loading: authLoading } = useAuth();
  const { formatCheckoutMoney } = useMoney();
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [draft, setDraft] = useState("");
  const list = useChatConversations(perspective);
  const detail = useChatConversation(selectedId);
  const send = useSendChatMessage();
  const timeline = useRef<HTMLDivElement>(null);
  const base = perspective === "seller" ? "/seller/messages" : "/messages";
  useChatEvents(!!account);

  const markRoomRead = (id: string) => queryClient.setQueryData<ChatConversationList>(
    queryKeys.chatList(perspective),
    (current) => current ? {
      ...current,
      items: current.items.map((room) => room.id === id ? { ...room, unread_count: 0 } : room),
    } : current,
  );

  useEffect(() => { if (!authLoading && !account) router.push(`/login?next=${base}`); }, [account, authLoading, base, router]);
  useEffect(() => {
    if (account && perspective === "seller" && !account.roles.includes("seller")) router.push("/seller/apply");
  }, [account, perspective, router]);
  useEffect(() => {
    if (!detail.data) return;
    timeline.current?.scrollTo({ top: timeline.current.scrollHeight });
    queryClient.setQueryData<ChatConversationList>(queryKeys.chatList(perspective), (current) => current ? {
      ...current,
      items: current.items.map((room) => room.id === detail.data?.id ? { ...room, unread_count: 0 } : room),
    } : current);
  }, [detail.data, perspective, queryClient]);

  const selectRoom = (id: string) => { markRoomRead(id); setSelectedId(id); router.replace(`${base}/${id}`); };
  const goBack = () => { setSelectedId(null); router.replace(base); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId || send.isPending) return;
    setDraft("");
    try { await send.mutateAsync({ conversationId: selectedId, body, clientMessageId: crypto.randomUUID() }); }
    catch { setDraft(body); }
  };

  if (authLoading || !account) return <div className="grid min-h-[420px] place-items-center"><Spinner /></div>;
  const rooms = list.data?.items ?? [];
  const room = detail.data;
  const roomIsOrder = room?.kind === "order";
  const title = room?.product?.title ?? room?.counterpart.label;
  const roomContext = room ? contextLabel(room, locale) : null;
  const isSellerCounterpart = room?.counterpart.role === "seller";
  const orderHref = room?.order
    ? (perspective === "seller" ? `/seller/orders?search=${room.order.id}` : `/orders?search=${room.order.id}`)
    : (perspective === "seller" ? "/seller/orders" : "/orders");

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-1 sm:px-5 sm:py-5">
      <section className="grid min-h-[calc(100dvh-100px)] w-full overflow-hidden border-line bg-surface sm:min-h-[680px] sm:rounded-xl sm:border sm:shadow-card lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_280px]">
        <aside className={cn("border-r border-line", selectedId && "hidden lg:block")}>
          <header className="border-b border-line px-5 py-4">
            <div className="flex items-center gap-2"><Inbox size={18} className="text-iris-hi" /><h1 className="text-[16px] font-semibold">{t.inbox}</h1></div>
            <p className="mt-1 text-[12px] text-muted">{perspective === "seller" ? t.sellerInbox : t.buyerInbox}</p>
          </header>
          <div className="max-h-[calc(100dvh-174px)] overflow-y-auto sm:max-h-[615px]">
            {list.isLoading && <div className="p-5"><Spinner /></div>}
            {!list.isLoading && rooms.length === 0 && <div className="px-6 py-16 text-center">
              <MessageCircle size={26} className="mx-auto text-faint" /><p className="mt-3 text-[14px] font-medium">{t.empty}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{perspective === "seller" ? t.sellerEmpty : t.buyerEmpty}</p>
            </div>}
            {rooms.map((item) => {
              const isOrder = item.kind === "order";
              const itemIsSeller = item.counterpart.role === "seller";
              const itemTitle = item.product?.title ?? item.counterpart.label;
              return (
                <button
                  key={item.id}
                  onClick={() => selectRoom(item.id)}
                  className={cn(
                    "w-full border-b border-line px-4 py-4 text-left transition-colors hover:bg-raised",
                    selectedId === item.id && "bg-iris-soft/60"
                  )}
                >
                  <span className="flex items-start gap-3">
                    <span
                      className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center rounded-lg shadow-xs",
                        isOrder ? "bg-warn-soft text-warn" : "bg-iris-soft text-iris-hi"
                      )}
                    >
                      <RoomIcon order={isOrder} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-semibold text-fg">
                          {itemTitle}
                        </span>
                        {item.unread_count > 0 && (
                          <span className="grid min-w-5 place-items-center rounded-full bg-iris px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs">
                            {item.unread_count}
                          </span>
                        )}
                      </span>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            isOrder ? "bg-warn-soft text-warn" : "bg-iris-soft text-iris-hi"
                          )}
                        >
                          {contextLabel(item, locale)}
                        </span>
                        {itemIsSeller && item.product?.title && (
                          <span className="truncate text-[11px] text-faint">
                            · {item.counterpart.label}
                          </span>
                        )}
                      </div>
                      <span className="mt-1.5 block truncate text-[12px] text-muted">
                        {item.last_message?.body ?? item.counterpart.label}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className={cn("min-w-0 flex-col", selectedId ? "flex" : "hidden lg:flex")}>
          {!selectedId ? (
            <div className="grid flex-1 place-items-center bg-raised/45 p-8 text-center">
              <div>
                <MessageCircle size={34} className="mx-auto text-faint" />
                <h2 className="mt-4 text-[16px] font-semibold">{t.choose}</h2>
                <p className="mt-1 text-[13px] text-muted">{t.chooseHint}</p>
              </div>
            </div>
          ) : detail.isLoading ? (
            <div className="grid flex-1 place-items-center">
              <span className="sr-only">{t.loading}</span>
              <Spinner />
            </div>
          ) : detail.isError || !room ? (
            <div className="grid flex-1 place-items-center text-bad">{t.error}</div>
          ) : (
            <>
              <header className="flex min-h-[69px] items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
                <button
                  onClick={goBack}
                  className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised lg:hidden"
                  aria-label={t.back}
                >
                  <ChevronLeft size={18} />
                </button>
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-lg shadow-xs",
                    roomIsOrder ? "bg-warn-soft text-warn" : "bg-iris-soft text-iris-hi"
                  )}
                >
                  <RoomIcon order={roomIsOrder} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  {room.product ? (
                    <Link
                      href={`/products/${room.product.id}`}
                      className="group inline-flex items-center gap-1 font-semibold text-[14px] text-fg hover:text-iris transition-colors truncate max-w-full"
                      title="Xem chi tiết sản phẩm"
                    >
                      <span className="truncate">{room.product.title}</span>
                      <span className="text-[11px] text-iris font-mono opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
                        ↗
                      </span>
                    </Link>
                  ) : (
                    <h2 className="truncate text-[14px] font-semibold">{title}</h2>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                    {isSellerCounterpart ? (
                      <Link
                        href={`/sellers/${room.counterpart.id}`}
                        className="font-medium text-iris hover:underline inline-flex items-center gap-1"
                        title="Xem trang người bán"
                      >
                        <span>{room.counterpart.label}</span>
                        <span className="text-[10px]">↗</span>
                      </Link>
                    ) : (
                      <span>{room.counterpart.label}</span>
                    )}
                    <span>•</span>
                    <span>{roomContext}</span>
                  </div>
                </div>
              </header>

              {roomIsOrder && room.order && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-warn-soft/45 px-5 py-2.5 text-[11.5px]">
                  <span className="font-semibold text-warn">{roomContext}</span>
                  <span className="text-muted">{t.quantity}: {room.order.quantity}</span>
                  <span className="text-muted">{t.total}: {formatCheckoutMoney(room.order.total_amount, { locale })}</span>
                  <Link href={orderHref} className="ml-auto font-medium text-iris-hi hover:underline">
                    {t.viewOrder} ↗
                  </Link>
                </div>
              )}

              <div ref={timeline} className="flex-1 space-y-3 overflow-y-auto bg-raised/45 px-4 py-5 sm:px-6">
                <div className="mx-auto max-w-[720px] rounded-lg border border-warn/20 bg-warn-soft px-3 py-2 text-[11.5px] leading-relaxed text-warn">
                  {t.safety}
                </div>
                {room.messages.map((message) => {
                  const mine = message.sender_id === account.id;
                  return (
                    <div
                      key={message.id}
                      className={cn("mx-auto flex max-w-[720px]", mine ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[82%] whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                          mine
                            ? "rounded-br-sm bg-iris text-white shadow-xs"
                            : "rounded-bl-sm border border-line bg-surface text-fg shadow-xs"
                        )}
                      >
                        <p>{message.body}</p>
                        <time
                          className={cn(
                            "mt-1 block text-right text-[10px]",
                            mine ? "text-white/65" : "text-faint"
                          )}
                        >
                          {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
                            new Date(message.created_at)
                          )}
                        </time>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={submit} className="border-t border-line bg-surface p-3 sm:p-4">
                {!room.can_send && (
                  <p className="mx-auto mb-2 max-w-[760px] rounded-lg border border-warn/20 bg-warn-soft px-3 py-2 text-[11.5px] text-warn">
                    {room.read_only_reason ?? t.readOnly}
                  </p>
                )}
                <div className="mx-auto flex max-w-[760px] items-end gap-2 rounded-xl border border-line bg-raised p-2 focus-within:border-iris">
                  <textarea
                    name="message"
                    aria-label={t.input}
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
                    placeholder={room.can_send ? t.input : (room.read_only_reason ?? t.readOnly)}
                    className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] outline-none placeholder:text-faint"
                    disabled={!room.can_send}
                  />
                  <Button type="submit" disabled={!draft.trim() || send.isPending || !room.can_send}>
                    {t.send}
                  </Button>
                </div>
                {send.isError && (
                  <p className="mx-auto mt-2 max-w-[760px] text-[11.5px] text-bad">{send.error.message}</p>
                )}
              </form>
            </>
          )}
        </main>

        <aside className="hidden border-l border-line bg-raised/35 p-5 xl:block">
          {room?.product ? (
            <>
              <ProductCover
                coverId={parseCoverId(room.product)}
                title={room.product.title}
                className="h-11 w-11 rounded-xl"
              />
              <h3 className="mt-4 text-[11.5px] font-bold uppercase tracking-wider text-faint">
                {roomIsOrder ? t.orderChat : t.product}
              </h3>
              
              {/* Clickable product title */}
              <Link
                href={`/products/${room.product.id}`}
                className="group mt-2 block text-[14px] font-semibold leading-snug text-fg hover:text-iris transition-colors"
                title="Xem chi tiết sản phẩm"
              >
                <span>{room.product.title}</span>
                <span className="ml-1 inline-block text-[12px] font-mono text-iris group-hover:translate-x-0.5 transition-transform">
                  ↗
                </span>
              </Link>

              {/* Clickable seller shop name */}
              <div className="mt-3.5 pt-3.5 border-t border-line/70">
                <span className="text-[11px] font-medium uppercase tracking-wider text-faint block mb-1.5">
                  {isSellerCounterpart ? "Người bán" : "Khách hàng"}
                </span>
                {isSellerCounterpart ? (
                  <Link
                    href={`/sellers/${room.counterpart.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-fg hover:border-iris hover:bg-iris-soft hover:text-iris transition-all shadow-xs"
                    title="Xem trang người bán"
                  >
                    <span>{room.counterpart.label}</span>
                    <span className="text-[10px] text-muted">↗</span>
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-muted">
                    <span>{room.counterpart.label}</span>
                  </span>
                )}
              </div>

              {roomIsOrder && room.order && (
                <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[12px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t.order}</dt>
                    <dd>
                      <Link
                        href={orderHref}
                        className="font-mono font-semibold text-iris hover:underline"
                        title="Xem chi tiết đơn hàng"
                      >
                        #{room.order.id} ↗
                      </Link>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t.quantity}</dt>
                    <dd className="font-medium">{room.order.quantity}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t.total}</dt>
                    <dd className="font-mono font-semibold text-iris-hi">
                      {formatCheckoutMoney(room.order.total_amount, { locale })}
                    </dd>
                  </div>
                </dl>
              )}
            </>
          ) : (
            <p className="text-[12px] text-muted">{t.chooseHint}</p>
          )}
        </aside>
      </section>
    </div>
  );
}
