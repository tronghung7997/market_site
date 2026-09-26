import { NextRequest, NextResponse } from "next/server";
import { signedBackendFetch } from "@/lib/bff-request-signing";

// Public images while MEDIA_PUBLIC_BASE_URL is empty (backend
// /public/media/{key}). Keys are immutable, so the backend answers with a
// one-year immutable Cache-Control that a CDN in front of the site honours.
// The key always ends in ".webp", which keeps next-intl's matcher (proxy.ts)
// away from this route.
const KEY_PATTERN = /^pub\/[a-z_]+\/\d{4}\/\d{2}\/[a-z2-7]{16}_(?:full|thumb)\.webp$/;
const PASSED_HEADERS = ["content-type", "cache-control", "etag", "content-disposition"];

type RouteContext = { params: Promise<{ key: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { key } = await context.params;
  const path = key.join("/");
  if (!KEY_PATTERN.test(path)) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const headers = new Headers();
  const etag = request.headers.get("if-none-match");
  if (etag) headers.set("if-none-match", etag);
  let upstream: Response;
  try {
    upstream = await signedBackendFetch(`/public/media/${path}`, { headers, cache: "no-store" });
  } catch {
    return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const out = new Headers({ "X-Content-Type-Options": "nosniff" });
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!upstream.ok && upstream.status !== 304) out.set("Cache-Control", "no-store");
  const body = upstream.status === 200 ? upstream.body : null;
  return new NextResponse(body, { status: upstream.status, headers: out });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
