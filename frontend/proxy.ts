import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { adminRequestAllowed, isAdminPagePath } from "@/lib/admin-access";

const handleI18n = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  if (/^\/en\/admin(?:\/|$)/.test(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = request.nextUrl.pathname.replace(/^\/en(?=\/admin(?:\/|$))/, "/vi");
    return NextResponse.redirect(redirectUrl);
  }

  if (
    isAdminPagePath(request.nextUrl.pathname, routing.locales)
    && !adminRequestAllowed(request.headers)
  ) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return handleI18n(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
