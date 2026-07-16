import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Newsreader, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/query-provider";
import TopNav from "@/components/TopNav";
import SiteFooter from "@/components/SiteFooter";
import ChromeGate from "@/components/ChromeGate";
import RouteProgress from "@/components/RouteProgress";
import ReferralCapture from "@/components/ReferralCapture";
import { TooltipProvider } from "@/components/ui/tooltip";

const newsreader = Newsreader({
  subsets: ["latin", "vietnamese"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap",
});
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"], variable: "--font-bvp", display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jbmono", display: "swap",
});

export const metadata: Metadata = {
  title: "Proxora — Chợ tài khoản & dữ liệu số cho doanh nghiệp",
  description: "Nền tảng cung cấp tài khoản, proxy và dữ liệu số cho doanh nghiệp. Ký quỹ an toàn, giao ngay.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${newsreader.variable} ${beVietnam.variable} ${jbMono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <AuthProvider>
          <QueryProvider>
            <TooltipProvider>
              <RouteProgress />
              <Suspense fallback={null}><ReferralCapture /></Suspense>
              <ChromeGate><TopNav /></ChromeGate>
              <main className="flex-1 flex flex-col">{children}</main>
              <ChromeGate><SiteFooter /></ChromeGate>
            </TooltipProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
