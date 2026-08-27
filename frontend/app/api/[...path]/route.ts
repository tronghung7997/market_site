import { NextRequest, NextResponse } from "next/server";
import { signedHeaders } from "@/lib/bff-request-signing";
import { adminRequestAllowed, isAdminApiPath } from "@/lib/admin-access";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
  authCookieOptions,
  tokensFromLoginPayload,
} from "@/lib/bff-session";
import { buildUpstreamTarget } from "@/lib/bff-upstream";
import { SERVER_API_BASE } from "@/lib/server-api";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "content-type",
]);

function accessCookieOptions() {
  return authCookieOptions(ACCESS_MAX_AGE_SECONDS, IS_PRODUCTION);
}

function refreshCookieOptions() {
  return authCookieOptions(REFRESH_MAX_AGE_SECONDS, IS_PRODUCTION);
}

function applyAuthCookies(response: NextResponse, accessToken: string, refreshToken: string) {
  response.cookies.set(ACCESS_COOKIE, accessToken, accessCookieOptions());
  response.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  response.headers.set("Cache-Control", "no-store");
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
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

function copyAllowlistedHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (REQUEST_HEADER_ALLOWLIST.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

async function signedFetch(
  method: string,
  target: URL,
  headers: Headers,
  body?: ArrayBuffer,
): Promise<Response> {
  signedHeaders(method, target, body).forEach((value, name) => headers.set(name, value));
  return fetch(target, {
    method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });
}

async function rotateRefresh(request: NextRequest, refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  const upstreamTarget = buildUpstreamTarget(["auth", "refresh"], SERVER_API_BASE);
  if (!upstreamTarget) return null;
  const encoded = new TextEncoder().encode(JSON.stringify({ refresh_token: refreshToken }));
  const body = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  const headers = new Headers();
  const accept = request.headers.get("accept");
  const acceptLanguage = request.headers.get("accept-language");
  if (accept) headers.set("accept", accept);
  if (acceptLanguage) headers.set("accept-language", acceptLanguage);
  headers.set("content-type", "application/json");
  try {
    const upstream = await signedFetch("POST", upstreamTarget.target, headers, body);
    if (!upstream.ok) return null;
    const payload = await upstream.json() as { access_token?: string; refresh_token?: string };
    const tokens = tokensFromLoginPayload(payload);
    if (!tokens) return null;
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  } catch {
    return null;
  }
}

function passthroughUpstream(upstream: Response, extra?: (response: NextResponse) => void) {
  const responseHeaders = new Headers(upstream.headers);
  for (const name of ["set-cookie", "content-length", "connection", "content-encoding", "transfer-encoding", "server"]) {
    responseHeaders.delete(name);
  }
  responseHeaders.set("Cache-Control", "no-store");
  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
  extra?.(response);
  return response;
}

async function proxyLogout(request: NextRequest): Promise<NextResponse> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) {
    const upstreamTarget = buildUpstreamTarget(["auth", "logout"], SERVER_API_BASE);
    if (upstreamTarget) {
      const headers = new Headers();
      headers.set("authorization", `Bearer ${access}`);
      try {
        await signedFetch("POST", upstreamTarget.target, headers);
      } catch {
        // Cookie clear below is still required even if the backend is down.
      }
    }
  }
  const response = new NextResponse(null, { status: 204 });
  clearAuthCookies(response);
  return response;
}

async function proxy(request: NextRequest, segments: string[]) {
  if (!csrfAllowed(request)) {
    return NextResponse.json({ detail: "Cross-site request bị từ chối" }, { status: 403 });
  }

  const upstreamTarget = buildUpstreamTarget(segments, SERVER_API_BASE);
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
    return proxyLogout(request);
  }

  const refreshCookie = request.cookies.get(REFRESH_COOKIE)?.value;
  if (path === "auth/refresh") {
    if (!refreshCookie) {
      return NextResponse.json({ detail: "Token không hợp lệ" }, { status: 401 });
    }
    const rotated = await rotateRefresh(request, refreshCookie);
    if (!rotated) {
      const failed = NextResponse.json({ detail: "Token không hợp lệ" }, { status: 401 });
      clearAuthCookies(failed);
      return failed;
    }
    const response = NextResponse.json({ token_type: "bearer" });
    applyAuthCookies(response, rotated.accessToken, rotated.refreshToken);
    return response;
  }

  target.search = request.nextUrl.search;
  const headers = copyAllowlistedHeaders(request);
  let access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) headers.set("authorization", `Bearer ${access}`);

  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await signedFetch(request.method, target, headers, body);
  } catch {
    return NextResponse.json({ detail: "Backend tạm thời không khả dụng" }, { status: 502 });
  }

  if ((path === "auth/login" || path === "auth/admin/login") && upstream.ok) {
    const login = await upstream.json() as { access_token?: string; refresh_token?: string; token_type?: string };
    const tokens = tokensFromLoginPayload(login);
    if (!tokens) {
      return NextResponse.json({ detail: "Phản hồi đăng nhập không hợp lệ" }, { status: 502 });
    }
    const response = NextResponse.json({ token_type: tokens.tokenType });
    applyAuthCookies(response, tokens.accessToken, tokens.refreshToken);
    return response;
  }

  if (upstream.status === 401 && refreshCookie && path !== "auth/login" && path !== "auth/admin/login") {
    const rotated = await rotateRefresh(request, refreshCookie);
    if (rotated) {
      const retryHeaders = copyAllowlistedHeaders(request);
      retryHeaders.set("authorization", `Bearer ${rotated.accessToken}`);
      try {
        const retried = await signedFetch(request.method, target, retryHeaders, body);
        return passthroughUpstream(retried, (response) => {
          applyAuthCookies(response, rotated.accessToken, rotated.refreshToken);
        });
      } catch {
        return NextResponse.json({ detail: "Backend tạm thời không khả dụng" }, { status: 502 });
      }
    }
    const response = passthroughUpstream(upstream, clearAuthCookies);
    return response;
  }

  const response = passthroughUpstream(upstream);
  if (upstream.status === 401) clearAuthCookies(response);
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
