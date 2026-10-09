"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TakedownAdminDetail, TakedownCreate, TakedownRequest } from "@/lib/types";
import { isTerminal } from "./model";

/** Open requests refresh on their own: the partner reports progress through webhooks. */
const DETAIL_REFRESH_MS = 10_000;
const LIST_REFRESH_MS = 30_000;

const keys = {
  all: ["takedown"] as const,
  mine: (accountId: number | null | undefined) => ["takedown", "mine", accountId ?? null] as const,
  one: (accountId: number | null | undefined, code: string) => ["takedown", "one", accountId ?? null, code] as const,
  admin: () => ["takedown", "admin", "list"] as const,
  adminOne: (code: string) => ["takedown", "admin", "one", code] as const,
  adminStatus: () => ["takedown", "admin", "status"] as const,
};

export function useTakedownRequests(accountId: number | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.mine(accountId),
    queryFn: () => api.takedown.list(),
    enabled,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
    refetchInterval: (query) => (query.state.data?.some((r) => !isTerminal(r.status)) ? LIST_REFRESH_MS : false),
  });
}

export function useTakedownRequest(accountId: number | null | undefined, code: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.one(accountId, code),
    queryFn: () => api.takedown.get(code),
    enabled: enabled && Boolean(code),
    refetchInterval: (query) => (query.state.data && !isTerminal(query.state.data.status) ? DETAIL_REFRESH_MS : false),
    refetchIntervalInBackground: false,
    retry: false,
  });
}

function useRefresh() {
  const client = useQueryClient();
  return (request?: TakedownRequest) => {
    if (request) {
      client.setQueriesData<TakedownRequest>({ queryKey: ["takedown", "one"] }, (old) => (old && old.code === request.code ? request : old));
    }
    void client.invalidateQueries({ queryKey: ["wallet"] });
    return client.invalidateQueries({ queryKey: keys.all });
  };
}

export function useCreateTakedown() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: TakedownCreate) => api.takedown.create(body),
    onSuccess: (r) => refresh(r),
  });
}

/** Buyer decisions: accept / decline the quote, cancel, ask for warranty work. */
export function useTakedownActions() {
  const refresh = useRefresh();
  const accept = useMutation({ mutationFn: (code: string) => api.takedown.accept(code), onSuccess: (r) => refresh(r) });
  const decline = useMutation({ mutationFn: (code: string) => api.takedown.decline(code), onSuccess: (r) => refresh(r) });
  const cancel = useMutation({ mutationFn: (code: string) => api.takedown.cancel(code), onSuccess: (r) => refresh(r) });
  const warranty = useMutation({
    mutationFn: ({ code, note }: { code: string; note: string }) => api.takedown.warranty(code, note),
    onSuccess: (r) => refresh(r),
  });
  return { accept, decline, cancel, warranty };
}

export function useTakedownServiceStatus() {
  return useQuery({ queryKey: keys.adminStatus(), queryFn: () => api.takedown.admin.status(), staleTime: 60_000 });
}

export function useAdminTakedownRequests(enabled: boolean) {
  return useQuery({
    queryKey: keys.admin(),
    queryFn: () => api.takedown.admin.list(),
    enabled,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
    refetchInterval: LIST_REFRESH_MS,
  });
}

export function useAdminTakedownRequest(code: string) {
  return useQuery({
    queryKey: keys.adminOne(code),
    queryFn: () => api.takedown.admin.get(code),
    enabled: Boolean(code),
    refetchInterval: (query) => (query.state.data && !isTerminal(query.state.data.status) ? DETAIL_REFRESH_MS : false),
    retry: false,
  });
}

export function useAdminTakedownActions() {
  const client = useQueryClient();
  const settle = (detail: TakedownAdminDetail) => {
    client.setQueryData(keys.adminOne(detail.code), detail);
    return client.invalidateQueries({ queryKey: keys.all });
  };
  const price = useMutation({
    mutationFn: ({ code, price }: { code: string; price: number }) => api.takedown.admin.price(code, price),
    onSuccess: settle,
  });
  const sync = useMutation({ mutationFn: (code: string) => api.takedown.admin.sync(code), onSuccess: settle });
  return { price, sync };
}
