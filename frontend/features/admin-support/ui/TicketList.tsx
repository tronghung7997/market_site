"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import type { AdminTicket } from "@/lib/types";
import { Button, Select, Spinner, Tag } from "@/components/ui";
import { Clock, Inbox, Search, Sparkles, X } from "@/components/Icons";
import { useSupportAdmins, useSupportStats, useSupportTags, useTicketList } from "../data";
import {
  filtersActive, formatDuration, KIND_LABEL, minutesSince, OVERDUE_MINUTES, ROLE_LABEL, STATUS_LABEL, STATUS_TONE, ticketPreview,
  INPUT_CLASS, ticketStatus, ticketTitle, VIEWS, type SupportFilters,
} from "../model";

const FILTER_SELECT = "h-8 min-w-0 flex-1 rounded-md px-2 pr-6 text-[12px]";

export function TicketList({ filters, onFilters, selectedId, onSelect, meId, now, searchRef, onManageCanned, hidden }: {
  filters: SupportFilters;
  onFilters: (patch: Partial<SupportFilters>) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  meId: number;
  now: number;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onManageCanned: () => void;
  hidden: boolean;
}) {
  const { query, items, counts } = useTicketList(filters);
  const stats = useSupportStats();
  const admins = useSupportAdmins();
  const tags = useSupportTags();
  const [searchDraft, setSearchDraft] = React.useState(filters.q);
  React.useEffect(() => { setSearchDraft(filters.q); }, [filters.q]);
  React.useEffect(() => {
    if (searchDraft === filters.q) return;
    const t = setTimeout(() => onFilters({ q: searchDraft }), 300);
    return () => clearTimeout(t);
  }, [searchDraft, filters.q, onFilters]);

  // Infinite scroll: fetch the next cursor page when the sentinel scrolls into view.
  const sentinel = React.useRef<HTMLLIElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError: pageError } = query;
  React.useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage && !pageError) void fetchNextPage();
    }, { rootMargin: "200px" });
    io.observe(node);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, pageError, items.length]);

  const avg = stats.data?.avg_first_response_minutes_7d;
  const count = (key: string) => (counts && key in counts ? counts[key as keyof typeof counts] : null);

  return (
    <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden border-r border-line bg-surface", hidden && "hidden lg:flex")} aria-label="Danh sách ticket">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-[15px] font-bold text-fg">Hỗ trợ</h1>
          <div className="flex items-center gap-1">
            {avg != null && <span className="text-[11.5px] text-faint" title="7 ngày gần nhất">Phản hồi đầu TB: {formatDuration(avg)}</span>}
            <button
              type="button"
              onClick={onManageCanned}
              aria-label="Quản lý trả lời mẫu"
              title="Trả lời mẫu"
              className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40"
            >
              <Sparkles size={14} />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Email, ORD-…, tên shop, nội dung"
            aria-label="Tìm ticket"
            className={cn(INPUT_CLASS, "h-8 pl-8 pr-7 text-[12.5px]")}
          />
          {searchDraft && (
            <button type="button" aria-label="Xoá tìm kiếm" onClick={() => setSearchDraft("")} className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-faint hover:text-fg">
              <X size={12} />
            </button>
          )}
        </div>
        <div role="tablist" aria-label="Hàng ticket" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => {
            const n = count(v.key);
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={filters.view === v.key}
                onClick={() => onFilters({ view: v.key })}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[12px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
                  filters.view === v.key ? "border-iris bg-iris-soft text-iris-hi" : "border-line text-muted hover:text-fg",
                )}
              >
                {v.label}
                {n !== null && v.key !== "resolved" && <span className={cn("font-mono text-[11px] tabular-nums", v.key === "waiting" && n > 0 && filters.view !== v.key && "text-warn")}>{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <Select aria-label="Người gửi" value={filters.role} onChange={(e) => onFilters({ role: e.target.value as SupportFilters["role"] })} className={FILTER_SELECT}>
            <option value="">Người gửi</option>
            <option value="buyer">Người mua</option>
            <option value="seller">Người bán</option>
          </Select>
          <Select aria-label="Loại" value={filters.kind} onChange={(e) => onFilters({ kind: e.target.value as SupportFilters["kind"] })} className={FILTER_SELECT}>
            <option value="">Loại</option>
            <option value="support">Hỗ trợ đơn</option>
            <option value="helpdesk">Helpdesk</option>
          </Select>
          <Select aria-label="Phụ trách" value={filters.assignee} onChange={(e) => onFilters({ assignee: e.target.value })} className={FILTER_SELECT}>
            <option value="">Phụ trách</option>
            <option value="me">Tôi</option>
            <option value="none">Chưa ai nhận</option>
            {(admins.data ?? []).filter((a) => a.id !== meId).map((a) => <option key={a.id} value={String(a.id)}>{a.email}</option>)}
          </Select>
        </div>
        {(tags.data?.length ?? 0) > 0 && (
          <Select aria-label="Nhãn" value={filters.tag} onChange={(e) => onFilters({ tag: e.target.value })} className="h-8 rounded-md px-2 text-[12px]">
            <option value="">Mọi nhãn</option>
            {tags.data!.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
          </Select>
        )}
        {filtersActive(filters) && (
          <button type="button" onClick={() => { setSearchDraft(""); onFilters({ q: "", role: "", kind: "", assignee: "", tag: "" }); }} className="text-[11.5px] font-medium text-iris hover:underline">
            Xoá bộ lọc
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={query.isFetching || undefined}>
        {query.isPending ? (
          <div className="grid place-items-center py-16"><Spinner label="Đang tải ticket" /></div>
        ) : query.isError && items.length === 0 ? (
          <div role="alert" className="px-4 py-12 text-center">
            <p className="text-[13px] font-medium text-bad">Không tải được danh sách ticket.</p>
            <p className="mt-1 text-[12px] text-muted">Kiểm tra kết nối rồi thử lại.</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => void query.refetch()}>Thử lại</Button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <Inbox size={20} className="mx-auto text-faint" />
            <p className="mt-2 text-[13px] font-medium text-fg">
              {filtersActive(filters) ? "Không có ticket nào khớp bộ lọc." : filters.view === "waiting" ? "Không ai đang chờ trả lời." : filters.view === "mine" ? "Bạn chưa nhận ticket nào." : "Chưa có ticket nào."}
            </p>
            {filters.view === "waiting" && !filtersActive(filters) && <p className="mt-1 text-[12px] text-muted">Hàng đợi đã sạch.</p>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {query.isError && (
              <li role="alert" className="flex items-center justify-between gap-2 bg-bad-soft/40 px-3 py-2 text-[12px] text-bad">
                Không làm mới được danh sách.
                <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>Thử lại</Button>
              </li>
            )}
            {items.map((t) => <TicketRow key={t.id} ticket={t} active={t.id === selectedId} meId={meId} now={now} onSelect={() => onSelect(t.id)} />)}
            {hasNextPage && (
              <li ref={sentinel} className="px-3 py-3 text-center">
                {pageError ? (
                  <Button size="sm" variant="ghost" onClick={() => void fetchNextPage()}>Tải thêm thất bại — thử lại</Button>
                ) : (
                  <span className="inline-flex items-center gap-2 text-[12px] text-faint"><Spinner />Đang tải thêm…</span>
                )}
              </li>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}

function TicketRow({ ticket, active, meId, now, onSelect }: { ticket: AdminTicket; active: boolean; meId: number; now: number; onSelect: () => void }) {
  const status = ticketStatus(ticket.status);
  const waiting = ticket.waiting_since ? minutesSince(ticket.waiting_since, now) : null;
  const overdue = waiting !== null && waiting > OVERDUE_MINUTES;
  const lastAt = ticket.last_message_at ?? ticket.last_message?.created_at ?? ticket.created_at;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active || undefined}
        className={cn(
          "block w-full px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris/40",
          active ? "bg-iris-soft/50" : "hover:bg-raised/50",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className={cn("min-w-0 truncate text-[13px]", ticket.unread_count > 0 || waiting !== null ? "font-semibold text-fg" : "text-fg")}>{ticketTitle(ticket)}</span>
          {waiting !== null ? (
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]", overdue ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>
              <Clock size={11} />chờ {formatDuration(waiting)}
            </span>
          ) : (
            <span className="shrink-0 font-mono text-[11px] text-faint">{formatDuration(minutesSince(lastAt, now))}</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-muted">{ticketPreview(ticket) || "—"}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Tag>{ticket.kind === "helpdesk" ? KIND_LABEL.helpdesk : ROLE_LABEL[ticket.requester?.role ?? "buyer"]}</Tag>
          {ticket.kind === "helpdesk" && ticket.requester && <Tag>{ROLE_LABEL[ticket.requester.role]}</Tag>}
          {ticket.order_code && <Tag className="font-mono">{ticket.order_code}</Tag>}
          {status !== "open" && <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>}
          {ticket.tags.slice(0, 2).map((tag) => <Tag key={tag} tone="iris">{tag}</Tag>)}
          <span className="ml-auto text-[11px] text-faint">
            {ticket.assignee ? (ticket.assignee.id === meId ? "Bạn" : ticket.assignee.email.split("@")[0]) : "Chưa ai nhận"}
          </span>
          {ticket.unread_count > 0 && (
            <span className="inline-flex min-w-4.5 items-center justify-center rounded-full bg-iris px-1.5 py-0.5 text-[10px] font-bold text-white">{ticket.unread_count}</span>
          )}
        </div>
      </button>
    </li>
  );
}
