"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export const REVIEW_PAGE_SIZE = 20;

export function useSellerReviews(params: { productId?: number; unrepliedOnly?: boolean; page?: number }) {
  const query = { ...params, perPage: REVIEW_PAGE_SIZE };
  return useQuery({
    queryKey: queryKeys.sellerReviews({ ...query }),
    queryFn: () => api.sellerReviews(query),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

function useInvalidateReviews(productId?: number) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sellerReviews() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.adminReviews() }),
    productId ? queryClient.invalidateQueries({ queryKey: queryKeys.productDetail(productId) }) : Promise.resolve(),
  ]);
}

export function useReplyToReview(productId?: number) {
  const invalidate = useInvalidateReviews(productId);
  return useMutation({
    mutationFn: ({ reviewId, body }: { reviewId: number; body: string }) => api.sellerReplyReview(reviewId, body),
    onSettled: () => void invalidate(),
  });
}

export function useDeleteReviewReply(productId?: number) {
  const invalidate = useInvalidateReviews(productId);
  return useMutation({
    mutationFn: (reviewId: number) => api.sellerDeleteReviewReply(reviewId),
    onSettled: () => void invalidate(),
  });
}

export function useAdminReviews(params: { productId?: number; hidden?: boolean; page?: number }) {
  const query = { ...params, perPage: REVIEW_PAGE_SIZE };
  return useQuery({
    queryKey: queryKeys.adminReviews({ ...query }),
    queryFn: () => api.adminReviews(query),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useSetReviewVisibility(productId?: number) {
  const invalidate = useInvalidateReviews(productId);
  return useMutation({
    mutationFn: ({ reviewId, hidden, reason }: { reviewId: number; hidden: boolean; reason?: string }) =>
      api.adminSetReviewVisibility(reviewId, hidden, reason),
    onSettled: () => void invalidate(),
  });
}
