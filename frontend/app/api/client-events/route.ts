import { NextRequest, NextResponse } from "next/server";

import { clientIpFromHeaders } from "@/lib/admin-access";
import { bffLog } from "@/lib/bff-log";
import { CLIENT_EVENT_MAX_BYTES, parseClientEvent } from "@/lib/client-events";
import { createLookupThrottle } from "@/lib/lookup-guard";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// Unauthenticated write into the log stream: bounded per visitor and per
// process so a script cannot flood it.
const allowEvent = createLookupThrottle({ perClientLimit: 20, globalLimit: 600, windowMs: 60_000 });

function reply(status: number) {
  return new NextResponse(null, { status, headers: NO_STORE });
}

/** Browser diagnostics (lib/client-events.ts) → one `client_*` log line. */
export async function POST(request: NextRequest) {
  // Fetch Metadata is set by the browser itself: only our own pages report.
  if (request.headers.get("sec-fetch-site") !== "same-origin") return reply(403);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > CLIENT_EVENT_MAX_BYTES) return reply(413);
  if (!allowEvent(clientIpFromHeaders(request.headers))) return reply(429);

  const text = await request.text();
  if (text.length > CLIENT_EVENT_MAX_BYTES) return reply(413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reply(400);
  }
  const fields = parseClientEvent(raw);
  if (!fields) return reply(400);

  bffLog("warning", "client_nav_stall", {
    ...fields,
    user_agent: (request.headers.get("user-agent") ?? "").slice(0, 200),
  });
  return reply(204);
}
