"use client";

import { type UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatConversationDetail, ChatMessage } from "@/lib/types";

export function mergeChatMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** A conversation's message timeline: hydrates from the polled detail,
 *  merges newer pages in, loads older history when scrolled to the top and
 *  keeps the view pinned to the bottom while the reader is there. Shared by
 *  the buyer/seller inbox and the admin support desk. */
export function useChatTimeline(selectedId: string | null, detail: ChatConversationDetail | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const stickToBottom = useRef(true);
  const hydratedRoom = useRef<string | null>(null);
  const olderRequestId = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    olderRequestId.current += 1;
    hydratedRoom.current = null;
    setMessages([]);
    setOlderCursor(null);
    setLoadingOlder(false);
    stickToBottom.current = true;
  }, [selectedId]);

  useEffect(() => {
    if (!detail || detail.id !== selectedId) return;
    if (hydratedRoom.current !== selectedId) {
      hydratedRoom.current = selectedId;
      setMessages(detail.messages);
      setOlderCursor(detail.next_cursor);
    } else {
      setMessages((prev) => mergeChatMessages(prev, detail.messages));
    }
  }, [detail, selectedId]);

  useLayoutEffect(() => {
    if (stickToBottom.current && timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [selectedId, messages]);

  const loadOlder = useCallback(async () => {
    if (!selectedId || olderCursor == null || loadingOlder) return;
    const requestId = ++olderRequestId.current;
    const roomId = selectedId;
    const node = timelineRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const page = await api.chatConversation(roomId, olderCursor);
      if (requestId !== olderRequestId.current) return;
      setMessages((prev) => mergeChatMessages(page.messages, prev));
      setOlderCursor(page.next_cursor);
      requestAnimationFrame(() => {
        if (node) node.scrollTop = node.scrollHeight - previousHeight;
      });
    } finally {
      if (requestId === olderRequestId.current) setLoadingOlder(false);
    }
  }, [selectedId, olderCursor, loadingOlder]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    if (node.scrollTop < 48) void loadOlder();
  };

  /** Cancels an in-flight older page (call before switching rooms). */
  const cancelOlder = () => { olderRequestId.current += 1; };
  const pinToBottom = () => { stickToBottom.current = true; };

  return { messages, olderCursor, loadingOlder, loadOlder, onScroll, timelineRef, cancelOlder, pinToBottom };
}
