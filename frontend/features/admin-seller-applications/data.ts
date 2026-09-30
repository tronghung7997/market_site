"use client";

import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AdminSellerApplicationList, SellerApplicationInfoField, SellerApplicationStatus } from "@/lib/types";
import { QUEUE_PAGE_SIZE, UNDO_MS } from "./model";

export const applicationKeys = {
  all: ["admin", "seller-applications"] as const,
  queue: (status: SellerApplicationStatus, q: string) => ["admin", "seller-applications", "queue", status, q] as const,
  detail: (id: number) => ["admin", "seller-applications", "detail", id] as const,
};

export function useApplicationQueue(status: SellerApplicationStatus, q: string) {
  const query = useInfiniteQuery({
    queryKey: applicationKeys.queue(status, q),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.adminSellerApplications({ status, search: q || undefined, page: pageParam, per_page: QUEUE_PAGE_SIZE }),
    getNextPageParam: (last: AdminSellerApplicationList, pages) =>
      pages.reduce((n, p) => n + p.items.length, 0) < last.total ? pages.length + 1 : undefined,
    placeholderData: (prev) => prev,
  });
  const pages = query.data?.pages ?? [];
  const items = React.useMemo(() => {
    const seen = new Set<number>();
    return pages.flatMap((p) => p.items).filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  }, [pages]);
  const last = pages[pages.length - 1];
  return { query, items, total: last?.total ?? 0, counts: last?.counts, avgReviewHours: last?.avg_review_hours ?? null };
}

export function useApplicationDetail(id: number | null) {
  return useQuery({
    queryKey: applicationKeys.detail(id ?? 0),
    queryFn: () => api.adminSellerApplication(id!),
    enabled: id !== null,
  });
}

export function useAddApplicationNote(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.adminAddSellerApplicationNote(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: applicationKeys.detail(id) }),
  });
}

export type Decision =
  | { kind: "approve" }
  | { kind: "reject"; reason: string; resubmitAfterDays: number }
  | { kind: "info"; note: string; fields: SellerApplicationInfoField[] };

export interface PendingDecision {
  appId: number;
  name: string;
  decision: Decision;
  dueAt: number;
}

function send(appId: number, d: Decision) {
  if (d.kind === "approve") return api.adminApproveSellerApplication(appId);
  if (d.kind === "reject") return api.adminRejectSellerApplication(appId, d.reason, d.resubmitAfterDays);
  return api.adminRequestSellerApplicationInfo(appId, d.note, d.fields);
}

/** One decision at a time is held for `UNDO_MS` so "Hoàn tác" never needs a
 *  backend undo. A second decision, unmounting or leaving the page sends the
 *  held one immediately (the calls use `keepalive`). */
export function useDeferredDecisions({ onSent, onFailed }: {
  onSent: (p: PendingDecision) => void;
  onFailed: (p: PendingDecision, error: unknown) => void;
}) {
  const [pending, setPending] = React.useState<PendingDecision | null>(null);
  const pendingRef = React.useRef<PendingDecision | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = React.useRef({ onSent, onFailed });
  React.useEffect(() => { callbacks.current = { onSent, onFailed }; });

  const flush = React.useCallback(() => {
    const held = pendingRef.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pendingRef.current = null;
    setPending(null);
    if (!held) return;
    send(held.appId, held.decision)
      .then(() => callbacks.current.onSent(held))
      .catch((e) => callbacks.current.onFailed(held, e));
  }, []);

  const schedule = React.useCallback((p: Omit<PendingDecision, "dueAt">) => {
    flush();
    const held = { ...p, dueAt: Date.now() + UNDO_MS };
    pendingRef.current = held;
    setPending(held);
    timer.current = setTimeout(flush, UNDO_MS);
  }, [flush]);

  const undo = React.useCallback((): PendingDecision | null => {
    const held = pendingRef.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pendingRef.current = null;
    setPending(null);
    return held;
  }, []);

  React.useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  return { pending, schedule, undo, flush };
}
