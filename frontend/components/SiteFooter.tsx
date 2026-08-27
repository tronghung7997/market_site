"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo, Shield } from "./Icons";

export default function SiteFooter() {
  const t = useTranslations("footer");
  const pathname = usePathname();

  // Hide footer on full-height workspace pages like messages
  if (
    pathname?.startsWith("/messages") ||
    pathname?.includes("/messages")
  ) {
    return null;
  }

  const columns = [
    { title: t("products"), links: [t("socialAccounts"), t("proxy"), t("emailSoftware"), t("pricing")] },
    { title: t("business"), links: [t("wholesale"), t("consulting"), t("sla"), t("invoice")] },
    {
      title: t("help"),
      links: [
        { label: t("docs"), href: null },
        { label: t("faq"), href: null },
        { label: t("policy"), href: "/legal/escrow" },
        { label: t("terms"), href: "/legal/terms" },
        { label: t("privacy"), href: "/legal/privacy" },
        { label: t("contact"), href: null },
      ],
    },
  ];

  return (
    <footer className="border-t border-line bg-surface mt-16">
      <div className="border-b border-line">
        <div className="mx-auto max-w-[1200px] px-6 py-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px] text-muted">
          <span className="flex items-center gap-2"><Shield size={15} className="text-good" /> {t("escrow")}</span>
          <span className="flex items-center gap-2 text-faint">·</span>
          <span>{t("support")}</span><span className="flex items-center gap-2 text-faint">·</span>
          <span>{t("refund")}</span><span className="flex items-center gap-2 text-faint">·</span>
          <span className="flex items-center gap-2">{t("payment")}{["VISA", "ATM", "MoMo", "USDT"].map((method) => <span key={method} className="px-1.5 py-0.5 rounded border border-line bg-base font-mono text-[11px] text-muted">{method}</span>)}</span>
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] px-6 py-10 grid gap-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div><Logo /><p className="mt-3 text-[13px] text-muted max-w-xs leading-relaxed">{t("about")}</p></div>
        {columns.map((column) => (
          <div key={column.title}>
            <div className="text-[12px] font-semibold uppercase tracking-wider text-faint mb-3">{column.title}</div>
            <ul className="space-y-2">{column.links.map((item) => {
              const label = typeof item === "string" ? item : item.label;
              const href = typeof item === "string" ? null : item.href;
              return (
                <li key={label}>
                  {href ? (
                    <Link href={href} className="text-[13px] text-muted hover:text-fg">{label}</Link>
                  ) : (
                    <span className="text-[13px] text-muted">{label}</span>
                  )}
                </li>
              );
            })}</ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line"><div className="mx-auto max-w-[1200px] px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-[12px] text-faint"><span>{t("copyright", { year: new Date().getFullYear() })}</span><span>{t("legal")}</span></div></div>
    </footer>
  );
}
