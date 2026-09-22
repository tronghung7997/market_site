import "../globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { fetchPublicJson, pageMetadata, siteOrigin } from "@/lib/seo";
import type { SitePageLink } from "@/lib/types";
import { Suspense } from "react";
import { Newsreader, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { storefrontMessages } from "@/i18n/client-messages";
import { notFound } from "next/navigation";
import { pairedCurrencyForLocale } from "@/lib/geo-defaults";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/query-provider";
import {
  CurrencyProvider,
  parseDisplayCurrency,
  type DisplayCurrency,
  type MoneyConfig,
} from "@/lib/money";
import TopNav from "@/components/TopNav";
import SiteFooter from "@/components/SiteFooter";
import ChromeGate from "@/components/ChromeGate";
import RouteProgress from "@/components/RouteProgress";
import ReferralCapture from "@/components/ReferralCapture";
import { MaintenanceGate } from "@/features/site-status";
import ClarityTag from "@/components/ClarityTag";
import { isValidClarityId } from "@/lib/clarity";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/toast";
import { routing } from "@/i18n/routing";

/**
 * Server-side public money config so first paint uses admin default (no flash).
 * Returns null on failure so CurrencyProvider can client-retry via /api proxy.
 *
 * Goes through `fetchPublicJson` (shared `unstable_cache`, 60 s) on purpose:
 * a raw `signedBackendFetch` with `next: { revalidate }` never hits Next's
 * fetch cache because the HMAC headers change every second, so it cost one
 * backend round-trip per page view.
 */
async function loadMoneyConfig(locale: string): Promise<MoneyConfig | null> {
  const body = await fetchPublicJson<Partial<MoneyConfig>>("/public/money-config", locale);
  if (!body) return null;
  const rate =
    typeof body.display_fx_rate === "number" &&
    Number.isFinite(body.display_fx_rate) &&
    body.display_fx_rate > 0
      ? body.display_fx_rate
      : null;
  const def = parseDisplayCurrency(body.display_currency_default) ?? "USD";
  return {
    ledger_currency: "VND",
    display_fx_rate: rate,
    display_currency_default: def,
    allow_user_toggle: !!body.allow_user_toggle,
    allow_locale_toggle: !!body.allow_locale_toggle,
    // Default true when API is older / missing the field — safer (hints stay on).
    show_fx_hints: body.show_fx_hints !== false,
  };
}

/**
 * Admin-managed third-party tag ids (Settings › Analytics). Same shared cache
 * as above, so a toggle in the admin shows up for visitors within a minute;
 * null on failure simply renders no tag.
 */
async function loadClarityProjectId(locale: string): Promise<string | null> {
  const body = await fetchPublicJson<{ clarity_project_id?: unknown }>("/public/analytics-config", locale);
  const id = typeof body?.clarity_project_id === "string" ? body.clarity_project_id : "";
  return isValidClarityId(id) ? id : null;
}

const newsreader = Newsreader({
  subsets: ["latin", "vietnamese"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap",
});
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"], variable: "--font-bvp", display: "swap",
});
// Prices render the "đ" sign (U+0111) in mono, which lives in the Vietnamese
// subset: without preloading it the glyph swaps in ~0.5 s after first paint
// and shifts the header wallet pill and every price column (CLS 0.5+).
const jbMono = JetBrains_Mono({
  subsets: ["latin", "vietnamese"], weight: ["400", "500", "600"], variable: "--font-jbmono", display: "swap",
});

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    metadataBase: new URL(siteOrigin()),
    ...pageMetadata({
      title: t("title"),
      description: t("description"),
      locale,
      path: "/",
    }),
  };
}

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const tc = await getTranslations({ locale, namespace: "common" });

  // null initialConfig → client retries; first paint still uses FALLBACK defaults.
  // Three independent reads, one wait — not three serial round-trips.
  const [initialConfig, clarityId, footerPages, messages] = await Promise.all([
    loadMoneyConfig(locale),
    loadClarityProjectId(locale),
    // Admin-configured footer pages; null on backend hiccup → footer shows no page links.
    fetchPublicJson<SitePageLink[]>("/public/site-pages", locale).then((pages) => pages ?? []),
    getMessages(),
  ]);
  // Visitor preference: explicit cookie → country → the locale's paired
  // currency (vi ↔ VND) → nothing (provider falls back to the admin default).
  // Passing only a *trusted* preference means the client never persists a
  // provisional value when the config fetch failed.
  // Currency pairs with the language (vi → VND, en → USD); cookie/geo only
  // still decide the locale itself (proxy.ts).
  const preferredCurrency: DisplayCurrency | undefined = pairedCurrencyForLocale(locale);

  return (
    <html lang={locale} className={`${newsreader.variable} ${beVietnam.variable} ${jbMono.variable}`}>
      <body className="min-h-screen flex flex-col">
        {/* Storefront scope only — seller/admin layouts re-provide their own
            namespaces (see i18n/client-messages.ts). */}
        <NextIntlClientProvider messages={storefrontMessages(messages)}>
          <AuthProvider>
            <QueryProvider>
              <CurrencyProvider
                initialCurrency={preferredCurrency}
                initialConfig={initialConfig}
              >
                <TooltipProvider>
                <ToastProvider>
                  <RouteProgress />
                  <Suspense fallback={null}><ReferralCapture /></Suspense>
                  {clarityId && <ClarityTag projectId={clarityId} />}
                  <a
                    href="#main-content"
                    className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-iris focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-surface"
                  >
                    {tc("skipToContent")}
                  </a>
                  <ChromeGate><TopNav /></ChromeGate>
                  <main id="main-content" className="flex-1 flex flex-col">
                    <ChromeGate fallback={children}><MaintenanceGate>{children}</MaintenanceGate></ChromeGate>
                  </main>
                  <ChromeGate><SiteFooter pages={footerPages} /></ChromeGate>
                </ToastProvider>
                </TooltipProvider>
              </CurrencyProvider>
            </QueryProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
