/**
 * Country-based first-visit defaults: Vietnam → vi + VND, everywhere else →
 * en + USD. An explicit user choice (cookie) always wins; this only fills in
 * the blanks on a request that carries no preference yet.
 *
 * The country comes from Cloudflare's `CF-IPCountry` header (needs
 * "IP Geolocation" enabled on the zone). Without it we return null and the
 * caller keeps its previous behaviour (Accept-Language / admin default).
 */
import type { AppLocale } from "@/i18n/routing";
import type { DisplayCurrency } from "@/lib/money/constants";

export const GEO_COUNTRY_HEADER = "cf-ipcountry";

/** Non-production override so geo paths can be exercised without Cloudflare. */
export const GEO_COUNTRY_OVERRIDE_ENV = "GEO_COUNTRY_OVERRIDE";

export type GeoDefaults = { country: string; locale: AppLocale; currency: DisplayCurrency };

/**
 * Normalize a raw country header to ISO alpha-2 or null. Cloudflare sends
 * `XX` (unknown) and `T1` (Tor) — both mean "no idea", so treat as absent.
 */
export function parseCountry(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  return code;
}

export function geoDefaultsForCountry(raw: string | null | undefined): GeoDefaults | null {
  const country = parseCountry(raw);
  if (!country) return null;
  return country === "VN"
    ? { country, locale: "vi", currency: "VND" }
    : { country, locale: "en", currency: "USD" };
}

/**
 * Resolve defaults from request headers, honouring the dev override env when
 * not in production.
 */
export function geoDefaultsFromHeaders(
  headers: { get(name: string): string | null },
  env: NodeJS.ProcessEnv = process.env,
): GeoDefaults | null {
  const override = env.NODE_ENV !== "production" ? env[GEO_COUNTRY_OVERRIDE_ENV] : undefined;
  return geoDefaultsForCountry(override || headers.get(GEO_COUNTRY_HEADER));
}

/**
 * The currency a locale is paired with when nothing else decided it: Vietnamese
 * readers see VND. Other locales return null so the admin default applies.
 */
export function pairedCurrencyForLocale(locale: string | null | undefined): DisplayCurrency | null {
  return locale === "vi" ? "VND" : null;
}
