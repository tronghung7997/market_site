"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export function useChatEvents(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/chat/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string; conversation_id?: string };
        client.invalidateQueries({ queryKey: queryKeys.chat() });
        if (event.conversation_id) {
          client.invalidateQueries({ queryKey: queryKeys.chatDetail(event.conversation_id) });
        }
      } catch {
        client.invalidateQueries({ queryKey: queryKeys.chat() });
      }
    };
    return () => source.close();
  }, [client, enabled]);
}
