"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function usePublicQuestions(productId: number, page: number) {
  return useQuery({
    queryKey: queryKeys.productQuestions(productId, page),
    queryFn: () => api.productQuestions(productId, page),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

/** The signed-in viewer's own questions on this product, answered or not. */
export function useMyQuestions(productId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.myProductQuestions(productId),
    queryFn: () => api.myProductQuestions(productId),
    enabled,
  });
}

export function useAskQuestion(productId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (question: string) => api.askProductQuestion(productId, question),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.myProductQuestions(productId) }),
  });
}
