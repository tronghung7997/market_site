"use client";

import Script from "next/script";
import { usePathname } from "@/i18n/navigation";

/** Google Analytics 4 property for gmmo.info (public measurement id). */
export const GA_MEASUREMENT_ID = "G-M546E6KS66";

/** Loads gtag.js everywhere EXCEPT the admin console, same rule as ClarityTag. */
export default function GaTag() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
      <Script id="ga-gtag" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(GA_MEASUREMENT_ID)});`}
      </Script>
    </>
  );
}
