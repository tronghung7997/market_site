import "../globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
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
  const base = process.env.API_URL ?? "http://localhost:8001";
  try {
    const res = await fetch(`${base}/public/money-config`, {
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
  const localePath = locale === routing.defaultLocale ? "" : `/${locale}`;

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: localePath || "/",
      languages: { en: "/", vi: "/vi", "x-default": "/" },
    },
  };
}

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

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
                  <ChromeGate><TopNav /></ChromeGate>
                  <main className="flex-1 flex flex-col">{children}</main>
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
