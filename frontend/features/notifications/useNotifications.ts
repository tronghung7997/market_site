"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { NotificationCategory, NotificationCounts } from "@/lib/types";

const POLL_MS = 60_000;
const PAGE_SIZE = 20;

/** Unread totals for the bell badge; polled, and refreshed by chat events. */
export function useNotificationCounts(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notificationCounts(),
    queryFn: api.notificationCounts,
    enabled,
    refetchInterval: enabled ? POLL_MS : false,
    refetchOnWindowFocus: true,
  });
}

/** Newest first, paged by id. `category` "all" lists every category. */
export function useNotificationFeed(category: NotificationCategory | "all", enabled = true, pageSize = PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.notificationFeed(category), pageSize],
    queryFn: ({ pageParam }) => api.notifications({
      category: category === "all" ? undefined : category, before: pageParam, limit: pageSize,
    }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids?: number[]; category?: NotificationCategory }) => api.markNotificationsRead(body),
    onSuccess: (counts: NotificationCounts) => {
      client.setQueryData(queryKeys.notificationCounts(), counts);
      client.invalidateQueries({ queryKey: queryKeys.notifications() });
    },
  });
}
