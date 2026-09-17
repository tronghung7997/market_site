import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { adminRequestAllowed, isAdminPagePath } from "@/lib/admin-access";
import { geoDefaultsFromHeaders, pairedCurrencyForLocale } from "@/lib/geo-defaults";
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
  if (seedLocale) request.cookies.set(LOCALE_COOKIE, geo.locale);

  const response = handleI18n(request);

  // Session cookies: re-detect on the next browser session, unlike the
  // 1-year cookies written when the user picks a locale/currency by hand.
  if (seedLocale && !response.cookies.has(LOCALE_COOKIE)) {
    response.cookies.set(LOCALE_COOKIE, geo.locale, { path: "/", sameSite: "lax" });
  }
  // Currency pairs with the country when we know it, else with the locale the
  // request just resolved to (vi ↔ VND) — so a Vietnamese reader without a
  // Cloudflare country header still lands on VND instead of the admin default.
  if (!request.cookies.has(DISPLAY_CURRENCY_COOKIE)) {
    const currency = geo?.currency ?? pairedCurrencyForLocale(resolvedLocale(request, response));
    if (currency) response.cookies.set(DISPLAY_CURRENCY_COOKIE, currency, { path: "/", sameSite: "lax" });
  }
  return response;
}

/** Locale the i18n middleware settled on: redirect target → request path → cookie. */
function resolvedLocale(request: NextRequest, response: NextResponse): string | null {
  const location = response.headers.get("location");
  const path = location ? new URL(location, request.nextUrl.origin).pathname : request.nextUrl.pathname;
  const first = path.split("/")[1];
  if ((routing.locales as readonly string[]).includes(first)) return first;
  return response.cookies.get(LOCALE_COOKIE)?.value ?? request.cookies.get(LOCALE_COOKIE)?.value ?? null;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
