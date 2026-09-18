"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Logo, ShieldCheck } from "@/components/Icons";
import { cn } from "@/lib/cn";

/**
 * Two-column entry layout for sign-in / sign-up / recovery.
 *
 * Left (desktop only): one editorial statement about escrow plus three plain
 * facts — the reason a first-time visitor should hand us an email. Right: the
 * form on a white surface. On phones the statement collapses to the wordmark
 * and the form takes the full width.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  variant = "storefront",
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Secondary navigation under the form ("No account? Sign up"). */
  footer?: ReactNode;
  variant?: "storefront" | "admin";
  /** Room for a wider form (confirmation pages with two actions). */
  wide?: boolean;
}) {
  const t = useTranslations("authShell");
  const admin = variant === "admin";

  return (
    <div className={cn("flex-1 aura", admin && "min-h-screen")}>
      <div className="mx-auto grid w-full max-w-[1120px] min-h-[calc(100vh-3.5rem)] grid-cols-1 gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-16 lg:py-16">
        <aside className="flex flex-col gap-8 lg:gap-12">
          <Link href="/" className="inline-flex w-fit items-center" aria-label="GMMO">
            <Logo />
          </Link>
          <div className="hidden lg:block">
            <p className="font-serif text-[34px] font-semibold leading-[1.15] tracking-tight text-fg xl:text-[38px]">
              {admin ? t("adminStatement") : t("statement")}
            </p>
            {!admin && (
              <ul className="mt-9 max-w-[420px] divide-y divide-line border-y border-line text-[14px] leading-relaxed text-muted">
                <li className="py-3.5"><span className="font-medium text-fg">{t("fact1Title")}</span> — {t("fact1")}</li>
                <li className="py-3.5"><span className="font-medium text-fg">{t("fact2Title")}</span> — {t("fact2")}</li>
                <li className="py-3.5"><span className="font-medium text-fg">{t("fact3Title")}</span> — {t("fact3")}</li>
              </ul>
            )}
            {admin && (
              <p className="mt-6 max-w-[420px] text-[14px] leading-relaxed text-muted">{t("adminNote")}</p>
            )}
          </div>
        </aside>

        <section className="w-full lg:justify-self-end">
          <div className={cn("mx-auto w-full rounded-card border border-line bg-card p-6 shadow-card sm:p-8 lg:mx-0", wide ? "max-w-[520px]" : "max-w-[440px]")}>
            <header className="mb-6">
              <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-fg sm:text-[28px]">{title}</h1>
              {subtitle && <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{subtitle}</p>}
            </header>
            {children}
            {footer && <div className="mt-6 border-t border-line pt-5 text-[13px] text-muted">{footer}</div>}
          </div>
          <p className="mx-auto mt-4 flex max-w-[440px] items-center gap-1.5 text-[12px] text-faint lg:mx-0">
            <ShieldCheck size={14} className="shrink-0 text-good" />
            {t("secure")}
          </p>
        </section>
      </div>
    </div>
  );
}
