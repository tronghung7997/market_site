"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { chatRefetchInterval } from "@/lib/chat-polling";
import { queryKeys } from "@/lib/query-keys";
import { useChatStreamLive } from "@/hooks/use-chat-events";
import type { ChatConversationDetail } from "@/lib/types";
import type { HelpdeskRole } from "./model";

/** The open panel's thread for one role. Reading it marks it read, so it
 *  only runs while the panel is open; the closed launcher reads unread
 *  counts from the shared chat list instead. */
export function useHelpdeskThread(role: HelpdeskRole, open: boolean) {
  const streamLive = useChatStreamLive();
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.helpdesk(role),
    queryFn: async () => {
      const thread = await api.helpdeskConversation(role);
      // Reading marked it read: refresh the unread badges that come from the list.
      void client.invalidateQueries({ queryKey: queryKeys.chatList() });
      void client.invalidateQueries({ queryKey: queryKeys.actionItems() });
      return thread;
    },
    enabled: open,
    refetchOnWindowFocus: open,
    refetchInterval: chatRefetchInterval(open, streamLive),
  });
}

export function useSendHelpdesk(role: HelpdeskRole) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, clientMessageId, attachments }: { body: string; clientMessageId: string; attachments: string[] }) =>
      api.postHelpdeskMessage(role, body, clientMessageId, attachments),
    onSuccess: (thread: ChatConversationDetail) => {
      client.setQueryData(queryKeys.helpdesk(role), thread);
      client.invalidateQueries({ queryKey: queryKeys.chatList() });
      client.invalidateQueries({ queryKey: queryKeys.actionItems() });
    },
  });
}
