import { NextRequest, NextResponse } from "next/server";

import { facebookEntityType, normalizeFacebookTarget } from "@/lib/facebook-lookup";
import { lookupExpectedOrigin, lookupFromOwnFrontend, resolveLookupEndpoint, sanitizeLookupApiKey, withLookupApiKey } from "@/lib/lookup-gateway";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 20_000;
const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Provider row for `/fb-module/find-id`. Everything is optional — the UI is
 *  driven by what actually came back, not by the entity type. */
type ProviderPayload = {
  id?: unknown;
  username?: unknown;
  name?: unknown;
  type?: unknown;
  profile_picture_url?: unknown;
  likers_count?: unknown;
  description?: unknown;
  members_count?: unknown;
  privacy?: unknown;
  old_page_id?: unknown;
  url?: unknown;
  url_request?: unknown;
  source?: unknown;
  data_status?: unknown;
  cached?: unknown;
  detail?: unknown;
  message?: unknown;
  error?: unknown;
};

function fail(status: number, code: "LOOKUP_INVALID_INPUT" | "LOOKUP_NOT_FOUND" | "LOOKUP_RATE_LIMITED" | "LOOKUP_UNAVAILABLE") {
  return NextResponse.json({ detail: code, error_code: code }, { status, headers: NO_STORE });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asId(value: unknown): string | null {
  const text = asString(value);
  if (text && /^\d+$/.test(text)) return text;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

/** Provider errors nest as `{detail:{detail:{error:"find_id: unresolved …"}}}`. */
function providerErrorText(payload: ProviderPayload | null): string {
  let node: unknown = payload;
  for (let depth = 0; depth < 4 && node && typeof node === "object"; depth += 1) {
    const rec = node as Record<string, unknown>;
    node = rec.detail ?? rec.error ?? rec.message;
  }
  return typeof node === "string" ? node : "";
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

export async function GET(request: NextRequest) {
  const expectedOrigin = lookupExpectedOrigin(request.headers, request.nextUrl.origin);
  if (!lookupFromOwnFrontend(request.headers, expectedOrigin)) return fail(403, "LOOKUP_UNAVAILABLE");

  const target = normalizeFacebookTarget(request.nextUrl.searchParams.get("url") ?? "");
  if (!target) return fail(400, "LOOKUP_INVALID_INPUT");

  const apiKey = sanitizeLookupApiKey(process.env.LOOKUP_API_KEY ?? "");
  const endpoint = resolveLookupEndpoint(process.env.FACEBOOK_LOOKUP_API_URL, process.env.TIKTOK_LOOKUP_API_URL, "/api/v1/fb-module/find-id");
  if (!apiKey || !endpoint) return fail(503, "LOOKUP_UNAVAILABLE");

  let upstream: Response;
  try {
    upstream = await fetch(withLookupApiKey(endpoint, apiKey), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ url: target.url }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    console.warn("[facebook-lookup] provider unreachable:", (cause as Error)?.message ?? cause, (cause as { cause?: { code?: string } })?.cause?.code);
    return fail(502, "LOOKUP_UNAVAILABLE");
  }

  const payload = await upstream.json().catch(() => null) as ProviderPayload | null;
  if (upstream.status === 404) return fail(404, "LOOKUP_NOT_FOUND");
  if (upstream.status === 429) return fail(429, "LOOKUP_RATE_LIMITED");
  if (upstream.status === 400 || upstream.status === 422) {
    // A target the provider could not resolve on any tier is "not found",
    // everything else on 4xx is our input shape.
    return /unresolved|not found|does not exist/i.test(providerErrorText(payload)) ? fail(404, "LOOKUP_NOT_FOUND") : fail(400, "LOOKUP_INVALID_INPUT");
  }
  if (!upstream.ok || !payload) {
    console.warn("[facebook-lookup] provider error:", upstream.status, JSON.stringify(payload)?.slice(0, 300));
    return fail(502, "LOOKUP_UNAVAILABLE");
  }

  const id = asId(payload.id);
  if (!id) return fail(404, "LOOKUP_NOT_FOUND");

  const type = facebookEntityType(payload.type);
  return NextResponse.json({
    success: true,
    platform: "facebook",
    query: { input: target.url, handle: target.handle, kind: target.kind },
    entity: {
      id,
      type,
      username: asString(payload.username),
      name: asString(payload.name),
      avatar: asString(payload.profile_picture_url),
      url: asString(payload.url) ?? target.url,
      description: asString(payload.description),
      likes: asCount(payload.likers_count),
      members: asCount(payload.members_count),
      privacy: asString(payload.privacy),
      old_page_id: asId(payload.old_page_id),
    },
    meta: {
      source: asString(payload.source),
      data_status: asString(payload.data_status),
      cached: payload.cached === true,
      fetched_at: new Date().toISOString(),
    },
  }, { headers: NO_STORE });
}
