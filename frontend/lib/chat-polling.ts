/**
 * Chat queries poll as a fallback to the `/api/chat/events` stream.
 *
 * While the stream is open, every chat event already invalidates the chat
 * queries, so polling only guards against missed events (delivery is
 * best-effort, in-process on the backend). Without the stream (connecting,
 * dropped, unsupported), polling is the only source of freshness.
 */
export const CHAT_POLL_WITHOUT_STREAM_MS = 8_000;
export const CHAT_POLL_WITH_STREAM_MS = 60_000;

export function chatRefetchInterval(enabled: boolean, streamLive: boolean): number | false {
  if (!enabled) return false;
  return streamLive ? CHAT_POLL_WITH_STREAM_MS : CHAT_POLL_WITHOUT_STREAM_MS;
}
