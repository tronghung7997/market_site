"use client";

import * as React from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { privateImageBase, privateImageSource } from "@/lib/media";
import type { AdminNote, AdminTicket, AdminTicketContext, ChatConversationDetail, ChatMessage } from "@/lib/types";
import { Button, Spinner, Tag } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ImageStrip } from "@/components/media/ImageStrip";
import { useChatTimeline } from "@/components/chat/useChatTimeline";
import { Check, ChevronDown, ChevronLeft, ExternalLink, EyeOff, Info, More } from "@/components/Icons";
import { useAssignTicket, useSetTicketStatus, useSupportAdmins, useAddTicketNote } from "../data";
import {
  canTransition, formatVnDateTime, formatVnTime, KIND_LABEL, mergeTimeline, requesterName, STATUS_LABEL, STATUS_TONE, ticketStatus,
  visibleNotes, type PlaceholderValues,
} from "../model";
import { Composer } from "./Composer";
import { Menu, MenuItem } from "./Menu";
import { BlockDialog, ResolveDialog } from "./TicketDialogs";

export function TicketPane({ id, ticket, detail, context, notes, meId, onBack, onShowContext, onManageCanned }: {
  id: string;
  /** The row from the loaded list, when there is one (subject, requester). */
  ticket: AdminTicket | null;
  detail: UseQueryResult<ChatConversationDetail>;
  context: UseQueryResult<AdminTicketContext>;
  notes: UseQueryResult<AdminNote[]>;
  meId: number;
  onBack: () => void;
  onShowContext: () => void;
  onManageCanned: () => void;
}) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const room = detail.data && detail.data.id === id ? detail.data : undefined;
  const timeline = useChatTimeline(id, room);
  const setStatus = useSetTicketStatus();
  const assign = useAssignTicket();
  const addNote = useAddTicketNote(id);
  const admins = useSupportAdmins();
  const [dialog, setDialog] = React.useState<"resolve" | "block" | null>(null);

  const noteList = React.useMemo(() => notes.data ?? [], [notes.data]);
  const items = React.useMemo(
    () => mergeTimeline(timeline.messages, visibleNotes(noteList, timeline.messages, timeline.olderCursor != null)),
    [timeline.messages, noteList, timeline.olderCursor],
  );
  // A new note scrolls into view like a new message.
  React.useLayoutEffect(() => {
    const node = timeline.timelineRef.current;
    if (node && node.scrollHeight - node.scrollTop - node.clientHeight < 120) node.scrollTop = node.scrollHeight;
  }, [noteList.length, timeline.timelineRef]);

  if (detail.isPending) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (detail.isError || !room) {
    return (
      <div role="alert" className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-[13px] font-medium text-bad">{apiErrorMessage(detail.error, "Không mở được ticket này.")}</p>
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>Thử lại</Button>
            <Button size="sm" variant="ghost" onClick={onBack}>Về danh sách</Button>
          </div>
        </div>
      </div>
    );
  }

  const ctx = context.data;
  const status = ticketStatus(ctx?.status ?? ticket?.status ?? room.status);
  const assignee = ctx?.assignee ?? ticket?.assignee ?? null;
  const requesterEmail = ctx?.requester.email ?? ticket?.requester.email ?? room.counterpart.label;
  const orderCode = ctx?.order?.order_code ?? ticket?.order_code ?? room.order?.code ?? null;
  const title = ticket?.subject || (orderCode ? `${KIND_LABEL.support} · ${orderCode}` : `${KIND_LABEL[room.kind === "support" ? "support" : "helpdesk"]} · ${requesterEmail}`);
  const placeholders: PlaceholderValues = {
    ten: requesterName(requesterEmail),
    ma_don: orderCode,
    shop: ctx?.order?.shop_name ?? (ctx?.requester.role === "seller" ? room.counterpart.label : null),
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
      return true;
    } catch (e) {
      toast.error(apiErrorMessage(e, "Không thực hiện được — thử lại"));
      return false;
    }
  };
  const changeStatus = (to: "open" | "closed", label: string) => run(label, () => setStatus.mutateAsync({ id, value: { status: to } }));
  const assignTo = (adminId: number | null, label: string) => run(label, () => assign.mutateAsync({ id, value: adminId }));

  const resolve = async (outcome: string, notify: boolean) => {
    const ok = await run("Đã đánh dấu xử lý xong", async () => {
      if (outcome) await addNote.mutateAsync(outcome);
      await setStatus.mutateAsync({ id, value: { status: "resolved", notify_requester: notify } });
    });
    if (ok) setDialog(null);
  };
  const block = async (reason: string) => {
    const ok = await run("Đã chặn người gửi khỏi hỗ trợ", () => setStatus.mutateAsync({ id, value: { status: "blocked", reason } }));
    if (ok) setDialog(null);
  };

  const mutating = setStatus.isPending || assign.isPending;
  const actionBtn = "inline-flex h-8 items-center gap-1 rounded-lg border border-line-2 bg-raised px-2.5 text-[12.5px] font-medium text-fg hover:border-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40 disabled:opacity-50";

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <button type="button" onClick={onBack} aria-label="Về danh sách" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-raised lg:hidden">
          <ChevronLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-bold text-fg" title={title}>{title}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
            <span>{KIND_LABEL[room.kind === "support" ? "support" : "helpdesk"]}</span>
            <span aria-hidden>·</span>
            <span>mở {formatVnDateTime(room.created_at)} (GMT+7)</span>
            <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>
            {assignee && <span className="text-faint">· {assignee.id === meId ? "Bạn phụ trách" : `Phụ trách: ${assignee.email}`}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {status === "open" && assignee?.id !== meId && (
            <Button size="sm" variant="secondary" disabled={mutating} onClick={() => void assignTo(meId, "Bạn đã nhận ticket")}>Nhận xử lý</Button>
          )}
          <Menu label="Giao cho" triggerClassName={actionBtn} trigger={<>Giao cho <ChevronDown size={12} /></>}>
            {(close) => (
              <>
                {admins.isPending && <p className="px-2.5 py-1.5 text-[12px] text-faint">Đang tải…</p>}
                {admins.isError && <p className="px-2.5 py-1.5 text-[12px] text-bad">Không tải được danh sách admin</p>}
                {(admins.data ?? []).map((a) => (
                  <MenuItem key={a.id} disabled={a.id === assignee?.id} onSelect={() => { close(); void assignTo(a.id, `Đã giao cho ${a.email}`); }}>
                    <span className="min-w-0 flex-1 truncate">{a.email}{a.id === meId ? " (bạn)" : ""}</span>
                    {a.id === assignee?.id && <Check size={12} />}
                  </MenuItem>
                ))}
                {assignee && <MenuItem onSelect={() => { close(); void assignTo(null, "Đã bỏ giao"); }}>Bỏ giao</MenuItem>}
              </>
            )}
          </Menu>
          {canTransition(status, "resolved") && (
            <Button size="sm" disabled={mutating} onClick={() => setDialog("resolve")}><Check size={13} />Đã xử lý xong</Button>
          )}
          {status !== "open" && canTransition(status, "open") && (
            <Button size="sm" variant="secondary" disabled={mutating} onClick={() => void changeStatus("open", status === "blocked" ? "Đã bỏ chặn" : "Đã mở lại ticket")}>
              {status === "blocked" ? "Bỏ chặn" : "Mở lại"}
            </Button>
          )}
          {(canTransition(status, "closed") || canTransition(status, "blocked")) && (
            <Menu label="Thêm thao tác" triggerClassName={cn(actionBtn, "w-8 justify-center px-0")} trigger={<More size={15} />}>
              {(close) => (
                <>
                  {canTransition(status, "closed") && <MenuItem onSelect={() => { close(); void changeStatus("closed", "Đã đóng ticket"); }}>Đóng ticket</MenuItem>}
                  {canTransition(status, "blocked") && <MenuItem tone="bad" onSelect={() => { close(); setDialog("block"); }}>Chặn người gửi…</MenuItem>}
                </>
              )}
            </Menu>
          )}
          <button type="button" onClick={onShowContext} aria-label="Thông tin người gửi" className={cn(actionBtn, "w-8 justify-center px-0 xl:hidden")}>
            <Info size={15} />
          </button>
        </div>
      </header>

      <div ref={timeline.timelineRef} onScroll={timeline.onScroll} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-base/30 p-3 sm:p-4" aria-live="polite">
        {room.dispute && (
          <div className="mx-auto flex max-w-[680px] items-center justify-between gap-2 rounded-lg border border-warn/30 bg-warn-soft/40 px-3 py-2 text-[12px] text-warn">
            <span>Khiếu nại đang xem xét · {room.dispute.claimed_count} báo lỗi, {room.dispute.pending_count} chờ xử lý</span>
            <Link href={`/admin/disputes?dispute_id=${room.dispute.id}`} className="inline-flex shrink-0 items-center gap-1 font-medium hover:underline">Mở khiếu nại <ExternalLink size={11} /></Link>
          </div>
        )}
        {timeline.olderCursor != null ? (
          <div className="flex justify-center">
            <Button size="sm" variant="ghost" loading={timeline.loadingOlder} onClick={() => void timeline.loadOlder()}>Tải tin cũ hơn</Button>
          </div>
        ) : (
          <p className="text-center text-[11px] text-faint">Bắt đầu cuộc trò chuyện · {formatVnDateTime(room.created_at)}</p>
        )}
        {items.length === 0 && <p className="py-8 text-center text-[12.5px] text-faint">Chưa có tin nhắn.</p>}
        {items.map((item) =>
          item.type === "note"
            ? <NoteItem key={item.key} note={item.note} />
            : <MessageItem key={item.key} message={item.message} conversationId={room.id} meId={meId} />,
        )}
        {notes.isError && <p className="text-center text-[11.5px] text-bad">Không tải được ghi chú nội bộ.</p>}
      </div>

      {status === "blocked" && (
        <p className="shrink-0 border-t border-bad/25 bg-bad-soft/40 px-4 py-1.5 text-[11.5px] text-bad">
          Người gửi đã bị chặn khỏi hỗ trợ{ctx?.blocked_reason ? `: ${ctx.blocked_reason}` : ""}. Bạn vẫn có thể nhắn cho họ.
        </p>
      )}
      <Composer
        conversationId={room.id}
        placeholders={placeholders}
        canResolve={canTransition(status, "resolved")}
        onResolveAfterSend={async () => { await setStatus.mutateAsync({ id, value: { status: "resolved", notify_requester: false } }); toast.success("Đã gửi và đánh dấu xong"); }}
        onManageCanned={onManageCanned}
        onSent={timeline.pinToBottom}
      />

      <ResolveDialog open={dialog === "resolve"} pending={setStatus.isPending || addNote.isPending} onClose={() => setDialog(null)} onConfirm={(o, n) => void resolve(o, n)} />
      <BlockDialog open={dialog === "block"} requester={requesterEmail} pending={setStatus.isPending} onClose={() => setDialog(null)} onConfirm={(r) => void block(r)} />
    </>
  );
}

function MessageItem({ message, conversationId, meId }: { message: ChatMessage; conversationId: string; meId: number }) {
  const desk = message.sender_role === "admin";
  return (
    <div className={cn("mx-auto flex max-w-[680px]", desk ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed shadow-xs",
          desk ? "rounded-br-xs bg-iris text-white" : "rounded-bl-xs border border-line bg-surface text-fg",
        )}
      >
        {message.attachments && message.attachments.length > 0 && (
          <ImageStrip
            size="sm"
            className={cn(message.body && "mb-1.5")}
            title="Ảnh đính kèm"
            images={message.attachments.map((image) => ({ ...privateImageSource(image, privateImageBase.chat(conversationId)), id: image.id }))}
          />
        )}
        {message.body && <p className="select-text">{message.body}</p>}
        <time dateTime={message.created_at} className={cn("mt-0.5 block text-right text-[10px]", desk ? "text-white/75" : "text-faint")}>
          {desk && message.sender_id !== meId ? "admin khác · " : ""}{formatVnTime(message.created_at)}
        </time>
      </div>
    </div>
  );
}

/** Internal notes sit in the timeline but look nothing like a message. */
function NoteItem({ note }: { note: AdminNote }) {
  return (
    <div className="mx-auto max-w-[680px]">
      <div className="mx-auto max-w-[86%] rounded-lg border border-dashed border-warn/50 bg-warn-soft/50 px-3 py-2 text-[12.5px] text-fg">
        <p className="flex items-center gap-1 text-[11px] font-semibold text-warn"><EyeOff size={11} />Ghi chú nội bộ — khách không thấy</p>
        <p className="mt-1 whitespace-pre-wrap break-words">{note.body}</p>
        <p className="mt-1 text-right text-[10.5px] text-faint">{note.author_email ?? "admin"} · {formatVnDateTime(note.created_at)}</p>
      </div>
    </div>
  );
}
