import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { adminRequestAllowed, isAdminPagePath } from "@/lib/admin-access";
import { geoDefaultsFromHeaders } from "@/lib/geo-defaults";
import { DISPLAY_CURRENCY_COOKIE } from "@/lib/money/constants";

const handleI18n = createMiddleware(routing);
const LOCALE_COOKIE = "NEXT_LOCALE";

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

  // First visit (no stored preference): seed locale + currency from the
  // visitor's country. next-intl resolves locale as path → NEXT_LOCALE cookie
  // → Accept-Language, so injecting the cookie into the request makes geo win
  // over the browser language while an explicit cookie still wins over geo.
  const geo = geoDefaultsFromHeaders(request.headers);
  const seedLocale = geo != null && !request.cookies.has(LOCALE_COOKIE);
  const seedCurrency = geo != null && !request.cookies.has(DISPLAY_CURRENCY_COOKIE);
  if (seedLocale) request.cookies.set(LOCALE_COOKIE, geo.locale);

  const response = handleI18n(request);

  // Session cookies: re-detect on the next browser session, unlike the
  // 1-year cookies written when the user picks a locale/currency by hand.
  if (seedLocale && !response.cookies.has(LOCALE_COOKIE)) {
    response.cookies.set(LOCALE_COOKIE, geo.locale, { path: "/", sameSite: "lax" });
  }
  if (seedCurrency) {
    response.cookies.set(DISPLAY_CURRENCY_COOKIE, geo.currency, { path: "/", sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
