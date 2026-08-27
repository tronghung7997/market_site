"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const CHAT_REFETCH_MS = 8_000;

export function useChatConversations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.chatList(),
    queryFn: () => api.chatConversations("all"),
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: enabled ? CHAT_REFETCH_MS : false,
  });
}

export function useChatConversation(id: string | null) {
  return useQuery({
    queryKey: queryKeys.chatDetail(id ?? ""),
    queryFn: () => api.chatConversation(id!),
    enabled: !!id,
    refetchOnWindowFocus: true,
    refetchInterval: id ? CHAT_REFETCH_MS : false,
  });
}

export function useSendChatMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, body, clientMessageId }: { conversationId: string; body: string; clientMessageId: string }) => api.sendChatMessage(conversationId, body, clientMessageId),
    onSuccess: (_, variables) => {
      client.invalidateQueries({ queryKey: queryKeys.chatDetail(variables.conversationId) });
      client.invalidateQueries({ queryKey: queryKeys.chat() });
      client.invalidateQueries({ queryKey: queryKeys.actionItems() });
    },
  });
}

export function useCreateInquiry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, message, clientMessageId }: { productId: number; message: string; clientMessageId: string }) => api.createInquiry(productId, message, clientMessageId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.chat() });
      client.invalidateQueries({ queryKey: queryKeys.actionItems() });
    },
  });
}
