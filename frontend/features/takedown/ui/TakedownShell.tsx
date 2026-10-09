"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui";
import { Plus } from "@/components/Icons";

/**
 * Frame for every buyer takedown page: title, the two-item section menu
 * (Dashboard / Link requests) and the "New takedown" action.
 * Signed-out visitors are sent to log in and come back.
 */
export function TakedownShell({ children }: { children: ReactNode }) {
  const t = useTranslations("takedown");
  const pathname = usePathname();
  const router = useRouter();
  const { account, loading } = useAuth();

  useEffect(() => {
    if (!loading && !account) router.push(`/login?next=${encodeURIComponent(pathname)}`);
  }, [account, loading, router, pathname]);

  const tabs = [
    { href: "/takedown", label: t("nav.dashboard"), active: pathname === "/takedown" },
    { href: "/takedown/requests", label: t("nav.requests"), active: pathname.startsWith("/takedown/requests") },
  ];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-serif text-[26px] font-semibold tracking-tight text-fg sm:text-[28px]">{t("title")}</h1>
            <p className="text-[14px] text-muted">{t("subtitle")}</p>
          </div>
          <Link href="/takedown/new" className={cn(buttonClass({ size: "lg" }), "ml-auto")}>
            <Plus size={16} aria-hidden /> {t("nav.new")}
          </Link>
        </header>

        <nav aria-label={t("nav.label")} className="flex gap-1 border-b border-line">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "relative -mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors",
                tab.active ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {children}
      </div>
    </div>
  );
}
