"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useChatConversations(perspective: "buyer" | "seller") {
  return useQuery({ queryKey: queryKeys.chatList(perspective), queryFn: () => api.chatConversations(perspective) });
}

export function useChatConversation(id: string | null) {
  return useQuery({ queryKey: queryKeys.chatDetail(id ?? ""), queryFn: () => api.chatConversation(id!), enabled: !!id });
}

export function useSendChatMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, body, clientMessageId }: { conversationId: string; body: string; clientMessageId: string }) => api.sendChatMessage(conversationId, body, clientMessageId),
    onSuccess: (_, variables) => {
      client.invalidateQueries({ queryKey: queryKeys.chatDetail(variables.conversationId) });
      client.invalidateQueries({ queryKey: queryKeys.chat() });
    },
  });
}

export function useCreateInquiry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, message, clientMessageId }: { productId: number; message: string; clientMessageId: string }) => api.createInquiry(productId, message, clientMessageId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.chat() }),
  });
}
