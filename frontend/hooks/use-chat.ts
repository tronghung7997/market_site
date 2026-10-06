"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { chatRefetchInterval } from "@/lib/chat-polling";
import { queryKeys } from "@/lib/query-keys";
import { useChatStreamLive } from "./use-chat-events";

/** `perspective` "seller" asks the API for shop chats only: the list is capped
 *  at the 50 most recent rooms, so filtering an "all" list in the browser
 *  would drop shop chats for a seller who also buys a lot. */
export function useChatConversations(enabled = true, perspective: "all" | "seller" = "all") {
  const streamLive = useChatStreamLive();
  return useQuery({
    queryKey: [...queryKeys.chatList(), perspective] as const,
    queryFn: () => api.chatConversations(perspective),
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
