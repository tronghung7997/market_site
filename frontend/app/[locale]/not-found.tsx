"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui";

export default function LocaleNotFound() {
  const t = useTranslations("notFound");
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center px-6 py-16">
      <Card className="p-8">
        <p className="text-[12px] font-medium uppercase tracking-wider text-faint">404</p>
        <h1 className="mt-2 font-serif text-[28px] font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">{t("body")}</p>
        <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-lg bg-iris px-5 text-sm font-medium text-surface hover:brightness-110">
          {t("backHome")}
        </Link>
      </Card>
    </div>
  );
}
