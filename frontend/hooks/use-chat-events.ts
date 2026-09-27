"use client";

import { useEffect, useSyncExternalStore } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

let source: EventSource | null = null;
let listeners = 0;
const clients = new Set<QueryClient>();

// Whether the shared stream is currently open; chat polling slows down while it is.
let live = false;
const liveSubscribers = new Set<() => void>();

function setLive(next: boolean) {
  if (live === next) return;
  live = next;
  for (const notify of liveSubscribers) notify();
}

function subscribeLive(notify: () => void) {
  liveSubscribers.add(notify);
  return () => {
    liveSubscribers.delete(notify);
  };
}

export function useChatStreamLive(): boolean {
  return useSyncExternalStore(subscribeLive, () => live, () => false);
}

function invalidate(client: QueryClient, conversationId?: string) {
  client.invalidateQueries({ queryKey: queryKeys.chat() });
  client.invalidateQueries({ queryKey: queryKeys.actionItems() });
  // A new chat message may add or bump a notification row.
  client.invalidateQueries({ queryKey: queryKeys.notifications() });
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
      source.onopen = () => {
        setLive(true);
        invalidateAll();
      };
      // Fires when the connection drops (the browser then reconnects).
      source.onerror = () => setLive(false);
    }
    listeners += 1;
    return () => {
      clients.delete(client);
      listeners -= 1;
      if (listeners <= 0 && source) {
        source.close();
        source = null;
        listeners = 0;
        setLive(false);
      }
    };
  }, [client, enabled]);
}
