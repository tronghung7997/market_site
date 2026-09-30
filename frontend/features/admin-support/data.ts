"use client";

import * as React from "react";
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { chatRefetchInterval } from "@/lib/chat-polling";
import { useChatStreamLive } from "@/hooks/use-chat-events";
import type {
  AdminTicket, AdminTicketContext, AdminTicketPage, CannedReply, CannedReplyInput, TicketStatusChange,
} from "@/lib/types";
import { dedupeTickets, listQuery, type SupportFilters } from "./model";

/** Under ["chat"] so the shared chat stream's invalidation refreshes the desk too. */
export const supportKeys = {
  all: ["chat", "admin-support"] as const,
  list: (f: SupportFilters) => ["chat", "admin-support", "list", f] as const,
  lists: () => ["chat", "admin-support", "list"] as const,
  stats: () => ["chat", "admin-support", "stats"] as const,
  context: (id: string) => ["chat", "admin-support", "context", id] as const,
  notes: (id: string) => ["chat", "admin-support", "notes", id] as const,
  ticket: (id: string) => ["chat", "admin-support", "ticket", id] as const,
  tags: () => ["chat", "admin-support", "tags"] as const,
  canned: () => ["admin", "canned-replies"] as const,
  admins: () => ["admin", "support-admins"] as const,
};

export function useTicketList(filters: SupportFilters) {
  const streamLive = useChatStreamLive();
  const query = useInfiniteQuery({
    queryKey: supportKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.adminSupportTickets({ ...listQuery(filters), cursor: pageParam }),
    getNextPageParam: (last: AdminTicketPage) => last.next_cursor ?? undefined,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: true,
    refetchInterval: chatRefetchInterval(true, streamLive),
  });
  const pages = query.data?.pages ?? [];
  const items = React.useMemo(() => dedupeTickets(pages), [pages]);
  return { query, items, counts: pages[0]?.counts };
}

export function useSupportStats() {
  return useQuery({ queryKey: supportKeys.stats(), queryFn: () => api.adminSupportStats(), refetchInterval: 60_000 });
}

/** One ticket by id, for when it is not in the loaded list (other tab, deep link, left the view after an action). */
export function useTicket(id: string | null, fromList: AdminTicket | null) {
  return useQuery({
    queryKey: supportKeys.ticket(id ?? ""),
    queryFn: () => api.adminSupportTicket(id!),
    enabled: !!id && !fromList,
    placeholderData: fromList ?? undefined,
  });
}

export function useTicketContext(id: string | null) {
  return useQuery({ queryKey: supportKeys.context(id ?? ""), queryFn: () => api.adminSupportContext(id!), enabled: !!id });
}

export function useTicketNotes(id: string | null) {
  return useQuery({ queryKey: supportKeys.notes(id ?? ""), queryFn: () => api.adminSupportNotes(id!), enabled: !!id });
}

export function useSupportTags() {
  return useQuery({ queryKey: supportKeys.tags(), queryFn: () => api.adminSupportTags(), staleTime: 60_000 });
}

export function useSupportAdmins() {
  return useQuery({
    queryKey: supportKeys.admins(),
    queryFn: () => api.adminAccounts({ role: "admin", status: "active", per_page: 100 }),
    staleTime: 5 * 60_000,
    select: (page) => page.items.map((a) => ({ id: a.id, email: a.email })),
  });
}

export function useCannedReplies() {
  return useQuery({ queryKey: supportKeys.canned(), queryFn: () => api.adminCannedReplies(), staleTime: 60_000 });
}

/** Writes a ticket the API returned into every loaded list page and the context. */
function applyTicket(client: QueryClient, ticket: AdminTicket) {
  client.setQueriesData<{ pages: AdminTicketPage[]; pageParams: unknown[] }>({ queryKey: supportKeys.lists() }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === ticket.id ? { ...t, ...ticket } : t)) })) } : data,
  );
  client.setQueryData<AdminTicket>(supportKeys.ticket(ticket.id), (cur) => (cur ? { ...cur, ...ticket } : ticket));
  client.setQueryData<AdminTicketContext>(supportKeys.context(ticket.id), (ctx) =>
    ctx ? { ...ctx, status: ticket.status, assignee: ticket.assignee, tags: ticket.tags, blocked_reason: ticket.blocked_reason } : ctx,
  );
}

function useTicketMutation<V>(fn: (id: string, v: V) => Promise<AdminTicket>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: V }) => fn(id, value),
    onSuccess: (ticket) => {
      applyTicket(client, ticket);
      void client.invalidateQueries({ queryKey: supportKeys.lists() });
      void client.invalidateQueries({ queryKey: supportKeys.stats() });
      void client.invalidateQueries({ queryKey: supportKeys.context(ticket.id) });
      void client.invalidateQueries({ queryKey: ["chat", "detail", ticket.id] });
    },
  });
}

export function useSetTicketStatus() {
  return useTicketMutation<TicketStatusChange>((id, body) => api.adminSupportSetStatus(id, body));
}

export function useAssignTicket() {
  return useTicketMutation<number | null>((id, assignee) => api.adminSupportAssign(id, assignee));
}

export function useSetTicketTags() {
  const client = useQueryClient();
  const m = useTicketMutation<string[]>((id, tags) => api.adminSupportSetTags(id, tags));
  return {
    ...m,
    mutateAsync: async (v: { id: string; value: string[] }) => {
      const r = await m.mutateAsync(v);
      void client.invalidateQueries({ queryKey: supportKeys.tags() });
      return r;
    },
  };
}

export function useAddTicketNote(id: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.adminAddSupportNote(id!, body),
    onSuccess: (note) => {
      client.setQueryData(supportKeys.notes(id ?? ""), (cur: typeof note[] | undefined) => (cur ? [...cur, note] : [note]));
      void client.invalidateQueries({ queryKey: supportKeys.notes(id ?? "") });
    },
  });
}

export function useSaveCannedReply() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: CannedReplyInput }): Promise<CannedReply> =>
      id === null ? api.adminCreateCannedReply(input) : api.adminUpdateCannedReply(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: supportKeys.canned() }),
  });
}

export function useDeleteCannedReply() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.adminDeleteCannedReply(id),
    onSuccess: () => client.invalidateQueries({ queryKey: supportKeys.canned() }),
  });
}

/** Re-renders every `ms` so waiting timers tick. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
