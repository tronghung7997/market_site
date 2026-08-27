"use client";

import { useEffect } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

let source: EventSource | null = null;
let listeners = 0;
const clients = new Set<QueryClient>();

function invalidate(client: QueryClient, conversationId?: string) {
  client.invalidateQueries({ queryKey: queryKeys.chat() });
  client.invalidateQueries({ queryKey: queryKeys.actionItems() });
  if (conversationId) {
    client.invalidateQueries({ queryKey: queryKeys.chatDetail(conversationId) });
  }
}

function invalidateAll(conversationId?: string) {
  for (const client of clients) invalidate(client, conversationId);
}

function onMessage(message: MessageEvent) {
  let conversationId: string | undefined;
  try {
    const event = JSON.parse(message.data) as { conversation_id?: string };
    conversationId = event.conversation_id;
  } catch {
    conversationId = undefined;
  }
  invalidateAll(conversationId);
}

export function useChatEvents(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    clients.add(client);
    if (!source || source.readyState === EventSource.CLOSED) {
      source?.close();
      source = new EventSource("/api/chat/events");
      source.onmessage = onMessage;
      source.onopen = () => invalidateAll();
    }
    listeners += 1;
    return () => {
      clients.delete(client);
      listeners -= 1;
      if (listeners <= 0 && source) {
        source.close();
        source = null;
        listeners = 0;
      }
    };
  }, [client, enabled]);
}
