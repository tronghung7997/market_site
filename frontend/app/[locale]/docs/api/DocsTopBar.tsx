"use client";

import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Icons";
import { buttonClass } from "@/components/ui";

type Labels = { docs: string; getKey: string; backToSite: string; language: string };

const LOCALES = [
  { code: "vi", label: "VI" },
  { code: "en", label: "EN" },
] as const;

/* Slim header of the API docs shell: brand, section name, key CTA, language. */
export default function DocsTopBar({ locale, labels }: { locale: string; labels: Labels }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <Link href="/" aria-label={labels.backToSite} className="text-fg">
        <span className="sm:hidden"><Logo withName={false} /></span>
        <span className="hidden sm:inline"><Logo /></span>
      </Link>
      <span aria-hidden className="h-5 w-px bg-line-2" />
      <span className="whitespace-nowrap text-[14px] font-medium text-fg">{labels.docs}</span>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <nav aria-label={labels.language} className="flex rounded-lg border border-line p-0.5 text-[12px] font-medium">
          {LOCALES.map(({ code, label }) => (
            <Link
              key={code}
              href="/docs/api"
              locale={code}
              aria-current={locale === code ? "true" : undefined}
              className={`rounded-md px-2 py-1 transition-colors ${locale === code ? "bg-raised text-fg" : "text-faint hover:text-fg"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Link href="/account?tab=api" className={buttonClass({ size: "sm" })}>{labels.getKey}</Link>
      </div>
    </header>
  );
}
