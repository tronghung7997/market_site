import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "dx_session";
const API_TARGET = (
  process.env.BUILT_API_URL
  ?? process.env.API_URL
  ?? "http://localhost:8001"
).replace(/\/$/, "");
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60,
  };
}

function csrfAllowed(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  return origin === null || origin === request.nextUrl.origin;
}

async function proxy(request: NextRequest, segments: string[]) {
  if (!csrfAllowed(request)) {
    return NextResponse.json({ detail: "Cross-site request bị từ chối" }, { status: 403 });
  }

  const path = segments.join("/");
  if (path === "internal" || path.startsWith("internal/")) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }
  if (path === "auth/session" && UNSAFE_METHODS.has(request.method)) {
    const response = new NextResponse(null, { status: 204 });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  const target = new URL(`${API_TARGET}/${path}`);
  target.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  for (const name of ["host", "cookie", "content-length", "connection", "authorization"]) {
    headers.delete(name);
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

  if (path === "auth/login" && upstream.ok) {
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
  for (const name of ["set-cookie", "content-length", "connection", "transfer-encoding", "server"]) {
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
