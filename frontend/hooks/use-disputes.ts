import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { Dispute } from "@/lib/types";

export function useDisputes() {
  return useQuery({
    queryKey: queryKeys.disputes(),
    queryFn: () => api.adminDisputes(),
    select: (data) => data.items,
  });
}

export function useDisputeDetail(id: number | null) {
  return useQuery({
    queryKey: queryKeys.disputeDetail(id ?? 0),
    queryFn: () => api.adminDisputeDetail(id!),
    enabled: !!id,
  });
}

export function useRefundDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api.refundDispute(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.disputes() });
    },
  });
}

export function useRejectDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api.rejectDispute(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.disputes() });
    },
  });
}
