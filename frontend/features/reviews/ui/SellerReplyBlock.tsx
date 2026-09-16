"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/utils";
import { Store } from "@/components/Icons";

/** Storefront rendering of a seller's public answer under a review. */
export function SellerReplyBlock({ body, repliedAt, sellerName }: { body: string; repliedAt?: string | null; sellerName?: string | null }) {
  const t = useTranslations("reviews");
  const locale = useLocale();
  return (
    <div className="mt-2.5 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
        <span className="inline-flex items-center gap-1 font-semibold text-fg"><Store size={11} className="text-iris" /> {t("sellerReplyTitle", { name: sellerName ?? t("sellerFallback") })}</span>
        {repliedAt && <span className="text-faint">· {formatDate(repliedAt, locale)}</span>}
      </div>
      <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
