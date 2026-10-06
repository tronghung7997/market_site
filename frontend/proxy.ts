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

  const response = CATALOG_IS_HOME ? catalogHome(request, handleI18n(request)) : handleI18n(request);

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

/** Whether "/" opens the catalog instead of the home page. Off for now: the
 *  home page stays the landing page until its review is settled (2026-10-06);
 *  flip it together with `app/[locale]/page.tsx` and `app/sitemap.ts`. */
const CATALOG_IS_HOME = false;

/** The storefront opens on the catalog: `/{locale}` (and the `/` → `/{locale}`
 *  hop of the i18n middleware) go straight to `/{locale}/categories` with one
 *  real redirect, instead of the page's streamed fallback redirect. */
function catalogHome(request: NextRequest, response: NextResponse): NextResponse {
  const home = (path: string) => {
    const match = /^\/([a-z]{2})\/?$/.exec(path);
    return match && (routing.locales as readonly string[]).includes(match[1]) ? match[1] : null;
  };
  const location = response.headers.get("location");
  const target = location ? new URL(location, request.nextUrl.origin) : null;
  const locale = target ? home(target.pathname) : home(request.nextUrl.pathname);
  if (!locale) return response;
  const url = target ?? request.nextUrl.clone();
  url.pathname = `/${locale}/categories`;
  const redirect = NextResponse.redirect(url, 307);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
