"use client";

/** Where a sent seller application stands: the three stages of /sell with
 *  the current one marked, and what the applicant sent. */

import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { Category, SellerApplication } from "@/lib/types";
import { Button, Card, Tag } from "@/components/ui";
import { ArrowRight, Check } from "@/components/Icons";

const STAGES = ["apply", "review", "sell"] as const;

function categoryNames(categories: Category[], ids: number[]): string[] {
  const all = new Map<number, string>();
  const walk = (list: Category[]) => list.forEach((c) => { all.set(c.id, c.name); walk(c.children ?? []); });
  walk(categories);
  return ids.map((id) => all.get(id)).filter((name): name is string => !!name);
}

export function ApplyStatus({ application, onOpenWorkspace }: { application: SellerApplication; onOpenWorkspace: () => void }) {
  const t = useTranslations("seller");
  const ta = useTranslations("seller.apply");
  const ts = useTranslations("sell");
  const locale = useLocale();
  const approved = application.status === "approved";
  const current = approved ? 2 : 1;
  const ids = application.category_ids ?? [];
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.categories(), staleTime: 5 * 60_000, enabled: ids.length > 0 });
  const names = categories.data ? categoryNames(categories.data, ids) : [];

  return (
    <Card className="p-5 sm:p-7">
      <ol className="grid grid-cols-3 gap-2" aria-label={ta("stepsLabel")}>
        {STAGES.map((stage, i) => {
          const done = i < current || approved;
          const now = i === current && !approved;
          return (
            <li key={stage} aria-current={now ? "step" : undefined} className="min-w-0">
              <span className={cn("block h-1 rounded-full", done ? "bg-good" : now ? "bg-warn" : "bg-line")} />
              <span className={cn("mt-2 flex items-center gap-1.5 text-[12px] font-medium", done || now ? "text-fg" : "text-muted")}>
                <span className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                  done ? "border-good bg-good text-white" : now ? "border-warn text-warn" : "border-line-2 text-faint",
                )}>
                  {done ? <Check size={11} /> : i + 1}
                </span>
                <span className="truncate">{ts(`process.${stage}.title`)}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Tag tone={approved ? "good" : "warn"}>{approved ? t("approved") : t("pending")}</Tag>
        <time dateTime={application.created_at} className="text-[12px] text-faint">{ta("sentAt", { date: formatDateTime(application.created_at, locale) })}</time>
      </div>
      <h2 className="mt-2 font-serif text-[22px] tracking-tight break-words">{application.business_name}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        {approved ? t("approvedDescription") : ta("pendingBody")}
      </p>

      {names.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {names.map((name) => <span key={name} className="rounded-md border border-line bg-raised/50 px-2 py-1 text-[12px] text-muted">{name}</span>)}
        </div>
      )}

      {approved ? (
        <Button className="mt-5" onClick={onOpenWorkspace}>{t("openWorkspace")}</Button>
      ) : (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold">{ta("whileWaiting")}</h3>
          <ul className="mt-2 space-y-2 text-[13px]">
            <li>
              <Link href="/sell#fees" className="inline-flex items-center gap-1 font-medium text-iris-hi hover:underline">{ta("waitFees")} <ArrowRight size={13} /></Link>
            </li>
            <li>
              <Link href="/legal/terms" className="inline-flex items-center gap-1 font-medium text-iris-hi hover:underline">{ta("waitTerms")} <ArrowRight size={13} /></Link>
            </li>
          </ul>
        </div>
      )}
    </Card>
  );
}
