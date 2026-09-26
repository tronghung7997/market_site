import { NextRequest, NextResponse } from "next/server";

import {
  buildTikTokProviderUrl,
  sanitizeLookupApiKey,
  tiktokLookupExpectedOrigin,
  tiktokLookupFromOwnFrontend,
} from "@/lib/tiktok-lookup";
import { clientIpFromHeaders } from "@/lib/admin-access";
import {
  LOOKUP_GLOBAL_PER_WINDOW,
  LOOKUP_PER_CLIENT_PER_WINDOW,
  LOOKUP_RESULT_CACHE_ENTRIES,
  LOOKUP_RESULT_TTL_MS,
  LOOKUP_WINDOW_MS,
  createLookupThrottle,
  createTtlCache,
} from "@/lib/lookup-guard";

export const runtime = "nodejs";

const PROVIDER_URL = process.env.TIKTOK_LOOKUP_API_URL;
const REQUEST_TIMEOUT_MS = 10_000;
const LOOKUP_ERROR_DETAIL = "Không thể thực hiện tra cứu lúc này. Vui lòng thử lại sau.";
const NOT_FOUND_DETAIL = "Không tìm thấy profile TikTok này.";

// Paid quota: repeat lookups of one profile are served from memory, and new
// lookups are throttled per client and per process (lib/lookup-guard).
const allowLookup = createLookupThrottle({
  perClientLimit: LOOKUP_PER_CLIENT_PER_WINDOW,
  globalLimit: LOOKUP_GLOBAL_PER_WINDOW,
  windowMs: LOOKUP_WINDOW_MS,
});
const lookupResults = createTtlCache<{ found: true; body: object } | { found: false }>({
  ttlMs: LOOKUP_RESULT_TTL_MS,
  maxEntries: LOOKUP_RESULT_CACHE_ENTRIES,
});

type ProviderProfile = {
  id?: unknown;
  uid?: unknown;
  unique_id?: unknown;
  nickname?: unknown;
  avatar?: unknown;
  verified?: unknown;
  private?: unknown;
  signature?: unknown;
  bio_link?: unknown;
  url?: unknown;
  language?: unknown;
  create_time?: unknown;
  commerce_user?: unknown;
  tt_seller?: unknown;
  follower_count?: unknown;
  following_count?: unknown;
  heart_count?: unknown;
  video_count?: unknown;
  friend_count?: unknown;
  digg_count?: unknown;
};

type ProviderPayload = {
  success?: unknown;
  username?: unknown;
  data?: {
    data?: ProviderProfile;
    meta?: { source?: unknown; fetched_at?: unknown };
  };
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asId(value: unknown): string | null {
  const text = asString(value);
  if (text) return text;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeTikTokProfile(value: string): string | null {
  const input = value.trim();
  if (!input) return null;
  const username = input.replace(/^@/, "");
  if (/^[A-Za-z0-9._-]{2,64}$/.test(username)) return `https://www.tiktok.com/@${username}`;
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === "tiktok.com" || hostname.endsWith(".tiktok.com"))) return null;
    const match = url.pathname.match(/^\/@([A-Za-z0-9._-]{2,64})(?:\/|$)/);
    return match ? `https://www.tiktok.com/@${match[1]}` : null;
  } catch {
    return null;
  }
}

function fetchedAt(value: unknown): string | null {
  const seconds = asNumber(value);
  if (!seconds) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export async function GET(request: NextRequest) {
  const expectedOrigin = tiktokLookupExpectedOrigin(request.headers, request.nextUrl.origin);
  if (!tiktokLookupFromOwnFrontend(request.headers, expectedOrigin)) {
    return NextResponse.json(
      { detail: LOOKUP_ERROR_DETAIL },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const normalizedUrl = normalizeTikTokProfile(request.nextUrl.searchParams.get("url") ?? "");
  if (!normalizedUrl) return NextResponse.json({ detail: "Nhập username hoặc link profile TikTok hợp lệ." }, { status: 400 });

  const cached = lookupResults.get(normalizedUrl);
  if (cached) {
    return cached.found
      ? NextResponse.json(cached.body, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ detail: NOT_FOUND_DETAIL }, { status: 404 });
  }
  if (!allowLookup(clientIpFromHeaders(request.headers))) {
    return NextResponse.json({ detail: LOOKUP_ERROR_DETAIL }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const apiKey = sanitizeLookupApiKey(process.env.LOOKUP_API_KEY ?? "");
  if (!apiKey) return NextResponse.json({ detail: LOOKUP_ERROR_DETAIL }, { status: 503 });
  if (!PROVIDER_URL) return NextResponse.json({ detail: LOOKUP_ERROR_DETAIL }, { status: 503 });

  let providerUrl: URL;
  try {
    providerUrl = buildTikTokProviderUrl(PROVIDER_URL, normalizedUrl, apiKey);
  } catch {
    return NextResponse.json({ detail: LOOKUP_ERROR_DETAIL }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(providerUrl, {
      headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.json({ detail: LOOKUP_ERROR_DETAIL }, { status: 502 });
  }
  if (!upstream.ok) {
    if (upstream.status === 404) {
      lookupResults.set(normalizedUrl, { found: false });
      return NextResponse.json({ detail: NOT_FOUND_DETAIL }, { status: 404 });
    }
    return NextResponse.json({ detail: LOOKUP_ERROR_DETAIL }, { status: 502 });
  }

  const payload = await upstream.json().catch(() => null) as ProviderPayload | null;
  const profile = payload?.data?.data;
  const id = asId(profile?.id) ?? asId(profile?.uid);
  const username = asString(profile?.unique_id) ?? asString(payload?.username);
  if (payload?.success !== true || !profile || !id || !username) {
    return NextResponse.json({ detail: LOOKUP_ERROR_DETAIL }, { status: 502 });
  }

  const body = {
    success: true,
    platform: "tiktok",
    username,
    profile: {
      id, username, nickname: asString(profile.nickname), avatar: asString(profile.avatar), verified: profile.verified === true,
      private: profile.private === true, bio: asString(profile.signature), bio_link: asString(profile.bio_link),
      url: asString(profile.url) ?? normalizedUrl, follower_count: asNumber(profile.follower_count),
      following_count: asNumber(profile.following_count), heart_count: asNumber(profile.heart_count), video_count: asNumber(profile.video_count),
      friend_count: asNumber(profile.friend_count), digg_count: asNumber(profile.digg_count),
      language: asString(profile.language), created_at: fetchedAt(profile.create_time),
      commerce_user: profile.commerce_user === true, tt_seller: profile.tt_seller === true,
    },
    meta: { source: asString(payload.data?.meta?.source), fetched_at: fetchedAt(payload.data?.meta?.fetched_at) },
  };
  lookupResults.set(normalizedUrl, { found: true, body });
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
