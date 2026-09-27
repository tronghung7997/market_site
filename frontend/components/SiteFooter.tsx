"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo, Shield } from "./Icons";
import type { SitePageLink } from "@/lib/types";

type FooterLink = { label: string; href: string };

/* `pages` là danh sách trang admin cấu hình (site_pages) — layout server fetch
   rồi truyền xuống để footer không phải gọi API ở client. Mọi dòng ở footer là
   một link thật: mục nào chưa có trang đích thì không đưa lên. */
export default function SiteFooter({ pages = [] }: { pages?: SitePageLink[] }) {
  const t = useTranslations("footer");
  const pathname = usePathname();

  // Hide footer on full-height workspace pages like messages
  if (
    pathname?.startsWith("/messages") ||
    pathname?.includes("/messages")
  ) {
    return null;
  }

  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: t("shop"),
      links: [
        { label: t("marketplace"), href: "/" },
        { label: t("categories"), href: "/categories" },
        { label: t("solutions"), href: "/solutions" },
        { label: t("search"), href: "/search" },
      ],
    },
    {
      title: t("help"),
      links: [
        { label: t("helpCenter"), href: "/support" },
        { label: t("buyingGuide"), href: "/support#buying" },
        { label: t("safety"), href: "/support#safety" },
        { label: t("contact"), href: "/support#contact" },
        { label: t("blog"), href: "/blog" },
      ],
    },
    {
      title: t("policies"),
      links: pages.map((page) => ({ label: page.title, href: `/legal/${page.slug}` })),
    },
    {
      title: t("sellers"),
      links: [
        { label: t("openShop"), href: "/sell" },
        { label: t("feesPayouts"), href: "/sell#fees" },
        { label: t("sellerPortal"), href: "/seller" },
      ],
    },
  ].filter((column) => column.links.length > 0);

  return (
    <footer className="border-t border-line bg-surface mt-16">
      <div className="border-b border-line">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px] text-muted">
          <span className="flex items-center gap-2"><Shield size={15} className="text-good" /> {t("escrow")}</span>
          <span aria-hidden className="text-faint">·</span>
          <span>{t("support")}</span>
          <span aria-hidden className="text-faint">·</span>
          <span>{t("refund")}</span>
          <span aria-hidden className="text-faint">·</span>
          <span className="flex flex-wrap items-center gap-2">
            {t("payment")}
            {[t("bankTransfer"), "USDT"].map((method) => (
              <span key={method} className="px-1.5 py-0.5 rounded-md border border-line bg-base font-mono text-[11px] text-muted">{method}</span>
            ))}
          </span>
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-10 grid gap-8 grid-cols-2 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="col-span-2 md:col-span-1">
          <Logo />
          <p className="mt-3 text-[13px] text-muted max-w-xs leading-relaxed">{t("about")}</p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-[12px] font-semibold text-faint mb-3">{column.title}</h2>
            <ul className="space-y-2">
              {column.links.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-[13px] text-muted hover:text-fg">{item.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-[12px] text-faint">
          <span>{t("copyright", { year: new Date().getFullYear() })}</span>
          <span>{t("legal")}</span>
        </div>
      </div>
    </footer>
  );
}
