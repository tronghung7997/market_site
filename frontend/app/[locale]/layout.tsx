import "../globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata, siteOrigin } from "@/lib/seo";
import { signedBackendFetch } from "@/lib/bff-request-signing";
import { Suspense } from "react";
import { Newsreader, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/query-provider";
import {
  CurrencyProvider,
  MONEY_CONFIG_FALLBACK,
  parseDisplayCurrency,
  type DisplayCurrency,
  type MoneyConfig,
} from "@/lib/money";
import TopNav from "@/components/TopNav";
import SiteFooter from "@/components/SiteFooter";
import ChromeGate from "@/components/ChromeGate";
import RouteProgress from "@/components/RouteProgress";
import ReferralCapture from "@/components/ReferralCapture";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "@/i18n/routing";

/**
 * Server-side public money config so first paint uses admin default (no flash).
 * Returns null on failure so CurrencyProvider can client-retry via /api proxy.
 */
async function loadMoneyConfig(): Promise<MoneyConfig | null> {
  try {
    const res = await signedBackendFetch("/public/money-config", {
      // Short-lived cache — admin rate changes should show within a minute.
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<MoneyConfig>;
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
  } catch {
    return null;
  }
}

const newsreader = Newsreader({
  subsets: ["latin", "vietnamese"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap",
});
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"], variable: "--font-bvp", display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jbmono", display: "swap",
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

  // Cookie preference wins; otherwise admin/ENV default from server config.
  // null initialConfig → client retries; first paint still uses FALLBACK defaults.
  const jar = await cookies();
  const cookieCurrency = parseDisplayCurrency(jar.get("display_currency")?.value);
  const initialConfig = await loadMoneyConfig();
  const initialCurrency: DisplayCurrency =
    cookieCurrency ??
    initialConfig?.display_currency_default ??
    MONEY_CONFIG_FALLBACK.display_currency_default;

  return (
    <html lang={locale} className={`${newsreader.variable} ${beVietnam.variable} ${jbMono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <NextIntlClientProvider>
          <AuthProvider>
            <QueryProvider>
              <CurrencyProvider
                initialCurrency={initialCurrency}
                initialConfig={initialConfig}
              >
                <TooltipProvider>
                  <RouteProgress />
                  <Suspense fallback={null}><ReferralCapture /></Suspense>
                  <a
                    href="#main-content"
                    className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-iris focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-surface"
                  >
                    {tc("skipToContent")}
                  </a>
                  <ChromeGate><TopNav /></ChromeGate>
                  <main id="main-content" className="flex-1 flex flex-col">{children}</main>
                  <ChromeGate><SiteFooter /></ChromeGate>
                </TooltipProvider>
              </CurrencyProvider>
            </QueryProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
