"use client";

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { vnd } from "@/lib/utils/format";
import type { AdminTicketContext, ChatConversationDetail } from "@/lib/types";
import { Button, Spinner, Tag } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ExternalLink, Plus, X } from "@/components/Icons";
import { useSetTicketTags, useSupportTags } from "../data";
import { addTag, formatVnDate, INPUT_CLASS, ROLE_LABEL, STATUS_LABEL, STATUS_TONE, TAGS_PER_TICKET, TAG_MAX, ticketStatus } from "../model";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/** Right column: who is asking, the related order, tags and earlier tickets. */
export function ContextPanel({ conversationId, context, room, onOpenTicket }: {
  conversationId: string;
  context: { data?: AdminTicketContext; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  room: ChatConversationDetail | undefined;
  onOpenTicket: (id: string) => void;
}) {
  const apiErrorMessage = useApiErrorMessage();
  if (context.isPending) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (context.isError || !context.data) {
    return (
      <div role="alert" className="px-3 py-10 text-center text-[12.5px] text-bad">
        {apiErrorMessage(context.error, "Không tải được thông tin ticket.")}
        <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void context.refetch()}>Thử lại</Button></div>
      </div>
    );
  }
  const ctx = context.data;
  const r = ctx.requester;
  return (
    <div className="space-y-3">
      <Section title="Người gửi">
        <Link href={`/admin/accounts/${r.id}`} className="block truncate text-[13px] font-medium text-iris hover:underline">
          {r.email} <span className="font-mono text-[11.5px] text-faint">#{r.id}</span>
        </Link>
        <p className="mt-1 text-[12px] text-muted">
          {ROLE_LABEL[r.role]} · tạo {formatVnDate(r.created_at)} · {r.orders_bought} đơn · chi {vnd(r.spent, "vi")}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Tag tone={r.email_verified ? "good" : "warn"}>{r.email_verified ? "Email đã xác minh" : "Email chưa xác minh"}</Tag>
          {ctx.previous_tickets.length > 0 && <Tag>{ctx.previous_tickets.length} ticket trước</Tag>}
        </div>
        <Link href={`/admin/accounts/${r.id}`} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-iris hover:underline">
          Mở hồ sơ tài khoản <ExternalLink size={11} />
        </Link>
      </Section>

      {ctx.order && (
        <Section title="Đơn liên quan">
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/admin/orders/${ctx.order.id}`} className="font-mono text-[12.5px] font-medium text-iris hover:underline">{ctx.order.order_code}</Link>
            <span className="font-mono text-[12px] text-fg">{vnd(ctx.order.total, "vi")}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted">
            {[ctx.order.product_title, ctx.order.status, ctx.order.shop_name && `shop ${ctx.order.shop_name}`].filter(Boolean).join(" · ")}
          </p>
          {room?.dispute && (
            <Link href={`/admin/disputes?dispute_id=${room.dispute.id}`} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-iris hover:underline">
              Mở khiếu nại <ExternalLink size={11} />
            </Link>
          )}
        </Section>
      )}

      <TagsSection conversationId={conversationId} tags={ctx.tags} />

      {ctx.blocked_reason && ticketStatus(ctx.status) === "blocked" && (
        <Section title="Lý do chặn">
          <p className="text-[12.5px] text-bad">{ctx.blocked_reason}</p>
        </Section>
      )}

      <Section title="Ticket trước">
        {ctx.previous_tickets.length === 0 ? (
          <p className="text-[12px] text-faint">Chưa có ticket nào khác.</p>
        ) : (
          <ul className="space-y-1">
            {ctx.previous_tickets.map((p) => {
              const s = ticketStatus(p.status);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpenTicket(p.id)} className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-[12px] hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40">
                    <span className="min-w-0 truncate text-fg">{p.subject || "(không tiêu đề)"}</span>
                    <span className="shrink-0 text-[11px] text-faint"><Tag tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Tag> {formatVnDate(p.created_at).slice(0, 5)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function TagsSection({ conversationId, tags }: { conversationId: string; tags: string[] }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const setTags = useSetTicketTags();
  const known = useSupportTags();
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (adding) input.current?.focus(); }, [adding]);

  const save = async (next: string[]) => {
    try {
      await setTags.mutateAsync({ id: conversationId, value: next });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Không lưu được nhãn"));
    }
  };

  const commit = () => {
    const next = addTag(tags, draft);
    setDraft("");
    setAdding(false);
    if (next !== tags) void save(next);
  };

  const listId = `tags-${conversationId}`;
  return (
    <Section title="Nhãn">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-0.5 rounded-md border border-iris/25 bg-iris-soft px-1.5 py-0.5 text-[11px] font-medium text-iris-hi">
            {tag}
            <button type="button" aria-label={`Bỏ nhãn ${tag}`} disabled={setTags.isPending} onClick={() => void save(tags.filter((t) => t !== tag))} className="rounded hover:text-bad">
              <X size={10} />
            </button>
          </span>
        ))}
        {adding ? (
          <form onSubmit={(e) => { e.preventDefault(); commit(); }} className="w-full">
            <input
              ref={input}
              list={listId}
              value={draft}
              maxLength={TAG_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { if (draft.trim()) commit(); else setAdding(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(""); setAdding(false); } }}
              aria-label="Nhãn mới"
              placeholder="VD: proxy lỗi"
              className={cn(INPUT_CLASS, "mt-1 h-7 px-2 text-[12px]")}
            />
            <datalist id={listId}>
              {(known.data ?? []).filter((t) => !tags.includes(t.tag)).map((t) => <option key={t.tag} value={t.tag} />)}
            </datalist>
          </form>
        ) : tags.length < TAGS_PER_TICKET && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-line-2 px-1.5 py-0.5 text-[11px] text-muted hover:text-fg">
            <Plus size={10} />Nhãn
          </button>
        )}
      </div>
    </Section>
  );
}
