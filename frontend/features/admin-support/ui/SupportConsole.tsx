"use client";

/** Admin › Hỗ trợ: ticket queue (views, filters, cursor-paged), the selected
 *  conversation with internal notes and a canned-reply composer, and the
 *  requester's context. The URL carries the ticket (/admin/support/{id}) and
 *  the filters, written with the History API. "/" focuses search. */

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useChatConversation } from "@/hooks/use-chat";
import { useChatEvents } from "@/hooks/use-chat-events";
import { Spinner } from "@/components/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageCircle } from "@/components/Icons";
import type { AdminTicketPage } from "@/lib/types";
import { supportKeys, useNow, useTicket, useTicketContext, useTicketList, useTicketNotes } from "../data";
import { isTypingTarget, parseSupportUrl, splitSupportPath, supportUrlSearch, type SupportFilters } from "../model";
import { CannedRepliesDialog } from "./CannedRepliesDialog";
import { ContextPanel } from "./ContextPanel";
import { TicketList } from "./TicketList";
import { TicketPane } from "./TicketPane";

function useSupportUrl() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = React.useMemo(() => parseSupportUrl(new URLSearchParams(searchParams.toString())), [searchParams]);
  const selectedId = splitSupportPath(pathname).id;
  const write = React.useCallback((patch: { filters?: Partial<SupportFilters>; id?: string | null }, mode: "push" | "replace" = "replace") => {
    const current = new URLSearchParams(window.location.search);
    const { base, id } = splitSupportPath(window.location.pathname);
    const qs = supportUrlSearch({ ...parseSupportUrl(current), ...patch.filters }, current);
    const nextId = patch.id === undefined ? id : patch.id;
    const url = `${base}${nextId ? `/${encodeURIComponent(nextId)}` : ""}${qs ? `?${qs}` : ""}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);
  return { filters, selectedId, write };
}

export function SupportConsole() {
  const { account, loading } = useAuth();
  const queryClient = useQueryClient();
  const { filters, selectedId, write } = useSupportUrl();
  const now = useNow();
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [cannedOpen, setCannedOpen] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);
  useChatEvents(!!account);

  const { items } = useTicketList(filters);
  const detail = useChatConversation(selectedId);
  const context = useTicketContext(selectedId);
  const notes = useTicketNotes(selectedId);
  const listed = items.find((t) => t.id === selectedId) ?? null;
  const single = useTicket(selectedId, listed);
  const ticket = listed ?? (single.data?.id === selectedId ? single.data : null);

  const onFilters = React.useCallback((patch: Partial<SupportFilters>) => write({ filters: patch }), [write]);
  const select = React.useCallback((id: string | null) => write({ id }, "push"), [write]);

  // Opening a thread marks it read server-side; clear the badge in loaded pages now.
  React.useEffect(() => {
    if (!detail.data || detail.data.id !== selectedId) return;
    queryClient.setQueriesData<{ pages: AdminTicketPage[]; pageParams: unknown[] }>({ queryKey: supportKeys.lists() }, (data) =>
      data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === selectedId && t.unread_count ? { ...t, unread_count: 0 } : t)) })) } : data,
    );
  }, [detail.data, selectedId, queryClient]);

  React.useEffect(() => { setContextOpen(false); }, [selectedId]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target as HTMLElement | null) || document.querySelector("[role='dialog']")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading || !account) return <div className="grid min-h-[420px] place-items-center"><Spinner /></div>;

  const contextPanel = selectedId ? (
    <ContextPanel conversationId={selectedId} context={context} room={detail.data} onOpenTicket={(id) => select(id)} />
  ) : null;

  return (
    <div className="h-[calc(100dvh-168px)] min-h-[520px]">
      <section className="grid h-full overflow-hidden rounded-xl border border-line bg-surface shadow-card lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)_300px]">
        <TicketList
          filters={filters}
          onFilters={onFilters}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          meId={account.id}
          now={now}
          searchRef={searchRef}
          onManageCanned={() => setCannedOpen(true)}
          hidden={!!selectedId}
        />

        <main className={selectedId ? "flex min-h-0 flex-col overflow-hidden" : "hidden min-h-0 flex-col overflow-hidden lg:flex"} aria-label="Hội thoại">
          {selectedId ? (
            <TicketPane
              key={selectedId}
              id={selectedId}
              ticket={ticket}
              detail={detail}
              context={context}
              notes={notes}
              meId={account.id}
              onBack={() => select(null)}
              onShowContext={() => setContextOpen(true)}
              onManageCanned={() => setCannedOpen(true)}
            />
          ) : (
            <div className="grid h-full place-items-center bg-raised/30 p-6 text-center">
              <div className="max-w-xs">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-iris-soft text-iris"><MessageCircle size={22} /></div>
                <p className="mt-3 text-[14px] font-semibold text-fg">Chọn một ticket</p>
                <p className="mt-1 text-[12.5px] text-muted">Hàng “Chờ trả lời” xếp người chờ lâu nhất lên đầu. Nhấn <kbd className="font-mono">/</kbd> để tìm.</p>
              </div>
            </div>
          )}
        </main>

        <aside className="hidden min-h-0 overflow-y-auto border-l border-line bg-base/30 p-3 xl:block" aria-label="Thông tin ticket">
          {contextPanel ?? <p className="py-10 text-center text-[12px] text-faint">Thông tin người gửi hiện ở đây.</p>}
        </aside>
      </section>

      <Dialog open={contextOpen} onOpenChange={setContextOpen}>
        <DialogContent className="max-h-[88vh] max-w-md overflow-y-auto border-line bg-base text-fg">
          <DialogHeader><DialogTitle className="text-[15px] text-fg">Thông tin ticket</DialogTitle></DialogHeader>
          {contextPanel}
        </DialogContent>
      </Dialog>

      <CannedRepliesDialog open={cannedOpen} onClose={() => setCannedOpen(false)} />
    </div>
  );
}
