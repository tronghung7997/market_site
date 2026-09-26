"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CHAT_POLL_WITHOUT_STREAM_MS, chatRefetchInterval } from "@/lib/chat-polling";
import { queryKeys } from "@/lib/query-keys";
import { useChatStreamLive } from "./use-chat-events";

export function useChatConversations(enabled = true) {
  const streamLive = useChatStreamLive();
  return useQuery({
    queryKey: queryKeys.chatList(),
    queryFn: () => api.chatConversations("all"),
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: chatRefetchInterval(enabled, streamLive),
  });
}

export function useChatConversation(id: string | null) {
  const streamLive = useChatStreamLive();
  return useQuery({
    queryKey: queryKeys.chatDetail(id ?? ""),
    queryFn: () => api.chatConversation(id!),
    enabled: !!id,
    refetchOnWindowFocus: true,
    refetchInterval: chatRefetchInterval(!!id, streamLive),
  });
}

export function useSendChatMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, body, clientMessageId, attachments = [] }: { conversationId: string; body: string; clientMessageId: string; attachments?: string[] }) =>
      api.sendChatMessage(conversationId, body, clientMessageId, attachments),
    onSuccess: (_, variables) => {
      client.invalidateQueries({ queryKey: queryKeys.chatDetail(variables.conversationId) });
      client.invalidateQueries({ queryKey: queryKeys.chat() });
      client.invalidateQueries({ queryKey: queryKeys.adminSupportList() });
      client.invalidateQueries({ queryKey: queryKeys.actionItems() });
    },
  });
}

export function useAdminSupportConversations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminSupportList(),
    queryFn: () => api.adminSupportConversations(),
    enabled,
    refetchOnWindowFocus: true,
    // Admin consoles do not open the chat stream, so they keep the fast poll.
    refetchInterval: enabled ? CHAT_POLL_WITHOUT_STREAM_MS : false,
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
