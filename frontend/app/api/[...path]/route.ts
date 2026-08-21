import { NextRequest, NextResponse } from "next/server";
import { adminRequestAllowed, isAdminApiPath } from "@/lib/admin-access";

const SESSION_COOKIE = "dx_session";
const API_TARGET = (
  process.env.BUILT_API_URL
  ?? process.env.API_URL
  ?? "http://localhost:8001"
).replace(/\/$/, "");
const API_BASE = new URL(`${API_TARGET}/`);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "content-type",
]);

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60,
  };
}

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

function externalRequestOrigin(request: NextRequest): string {
  const host = firstForwardedValue(request.headers.get("x-forwarded-host"))
    ?? request.headers.get("host");
  const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto"))
    ?? request.nextUrl.protocol.replace(/:$/, "");

  if (host && (protocol === "http" || protocol === "https")) {
    try {
      return new URL(`${protocol}://${host}`).origin;
    } catch {
      // Fall back to Next's parsed origin for malformed proxy headers.
    }
  }
  return request.nextUrl.origin;
}

function csrfAllowed(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  // Fetch Metadata is set by the browser and cannot be changed by page JS.
  // Trust its same-origin verdict so an internal Next URL behind Nginx does
  // not reject legitimate POSTs from the public HTTPS origin.
  if (fetchSite === "same-origin") return true;
  const origin = request.headers.get("origin");
  return origin === null || origin === externalRequestOrigin(request);
}

function buildUpstreamTarget(segments: string[]): { path: string; target: URL } | null {
  const normalizedSegments: string[] = [];
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    // Route params may already be decoded by Next. Reject separators, traversal,
    // NULs, and nested percent-encoding before URL normalization can reinterpret
    // them as another upstream route.
    if (
      decoded === "."
      || decoded === ".."
      || decoded.includes("/")
      || decoded.includes("\\")
      || decoded.includes("\0")
      || decoded.includes("%")
    ) {
      return null;
    }
    normalizedSegments.push(decoded);
  }

  const path = normalizedSegments.join("/");
  if (normalizedSegments[0] === "internal") return null;

  const target = new URL(normalizedSegments.map(encodeURIComponent).join("/"), API_BASE);
  if (target.origin !== API_BASE.origin || !target.pathname.startsWith(API_BASE.pathname)) {
    return null;
  }
  return { path, target };
}

async function proxy(request: NextRequest, segments: string[]) {
  if (!csrfAllowed(request)) {
    return NextResponse.json({ detail: "Cross-site request bị từ chối" }, { status: 403 });
  }

  const upstreamTarget = buildUpstreamTarget(segments);
  if (!upstreamTarget) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }
  const { path, target } = upstreamTarget;
  if (isAdminApiPath(path) && !adminRequestAllowed(request.headers)) {
    return NextResponse.json(
      { detail: "Not found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (path === "auth/session" && UNSAFE_METHODS.has(request.method)) {
    const response = new NextResponse(null, { status: 204 });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  target.search = request.nextUrl.search;
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (REQUEST_HEADER_ALLOWLIST.has(name.toLowerCase())) headers.set(name, value);
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) headers.set("authorization", `Bearer ${token}`);

  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "Backend tạm thời không khả dụng" }, { status: 502 });
  }

  if ((path === "auth/login" || path === "auth/admin/login") && upstream.ok) {
    const login = await upstream.json() as { access_token?: string; token_type?: string };
    if (!login.access_token) {
      return NextResponse.json({ detail: "Phản hồi đăng nhập không hợp lệ" }, { status: 502 });
    }
    const response = NextResponse.json({ token_type: login.token_type ?? "bearer" });
    response.cookies.set(SESSION_COOKIE, login.access_token, sessionCookieOptions());
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const responseHeaders = new Headers(upstream.headers);
  // `fetch` transparently decompresses upstream responses. Forwarding the
  // original Content-Encoding would make browsers try to decompress the
  // already-decoded body a second time (ERR_CONTENT_DECODING_FAILED).
  for (const name of ["set-cookie", "content-length", "connection", "content-encoding", "transfer-encoding", "server"]) {
    responseHeaders.delete(name);
  }
  responseHeaders.set("Cache-Control", "no-store");
  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
  if (upstream.status === 401) response.cookies.delete(SESSION_COOKIE);
  return response;
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handler(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
