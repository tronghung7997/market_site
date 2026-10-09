"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { Banner, Button, Card, Skeleton, buttonClass } from "@/components/ui";
import { AlertCircle, ChevronRight, Inbox, Plus } from "@/components/Icons";
import { BUCKETS, countByBucket, needsBuyer, sortRequests, type Bucket } from "../model";
import { useTakedownRequests } from "../useTakedown";
import { LinkCell, StatusTag, StepBar } from "./parts";

const BUCKET_TONE: Record<Bucket, string> = {
  review: "text-iris-hi", quoted: "text-warn", processing: "text-iris-hi", warranty: "text-good", finished: "text-fg",
};

export function TakedownDashboard() {
  const t = useTranslations("takedown");
  const { formatCheckoutMoney } = useMoney();
  const locale = useLocale();
  const { account, loading } = useAuth();
  const query = useTakedownRequests(account?.id, !loading && Boolean(account));
  const requests = useMemo(() => sortRequests(query.data ?? []), [query.data]);
  const quotes = requests.filter(needsBuyer);
  const counts = countByBucket(requests);

  if (query.isPending) return <DashboardSkeleton />;
  if (query.isError) {
    return (
      <Banner tone="bad" icon={<AlertCircle size={15} aria-hidden />} title={t("dashboard.error")}
        action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("dashboard.retry")}</Button>} />
    );
  }
  if (requests.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <Inbox size={28} className="text-faint" aria-hidden />
        <p className="text-[16px] font-semibold text-fg">{t("dashboard.emptyTitle")}</p>
        <p className="max-w-md text-[14px] text-muted">{t("dashboard.emptyBody")}</p>
        <Link href="/takedown/new" className={buttonClass({ size: "lg" })}><Plus size={16} aria-hidden /> {t("nav.new")}</Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {quotes.length > 0 && (
        <section aria-labelledby="td-needs-you" className="rounded-card border border-warn/30 bg-warn-soft p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="td-needs-you" className="text-[16px] font-semibold text-fg">{t("dashboard.needsYou")} · {quotes.length}</h2>
            <p className="text-[13px] text-muted">{t("dashboard.needsYouHint")}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {quotes.map((r) => (
              <li key={r.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3">
                <span className="min-w-0 flex-1 basis-64"><LinkCell request={r} /></span>
                <span className="font-mono text-[17px] font-semibold tabular text-fg">{r.price !== null ? formatCheckoutMoney(r.price, { locale }) : "—"}</span>
                <Link href={`/takedown/requests/${r.code}`} className={buttonClass({ size: "md" })}>{t("dashboard.viewQuote")}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card className="overflow-hidden p-0">
        <h2 className="sr-only">{t("dashboard.summaryLabel")}</h2>
        <ul className="grid grid-cols-2 sm:grid-cols-5">
          {BUCKETS.map((bucket, i) => (
            <li key={bucket} className={cn(i > 0 && "border-line sm:border-l", i % 2 === 1 && "border-l", i >= 2 && "border-t sm:border-t-0")}>
              <Link
                href={`/takedown/requests?status=${bucket}`}
                className="flex h-full flex-col gap-1 px-4 py-3 transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris"
              >
                <span className={cn("text-[12px] font-medium", counts[bucket] === 0 ? "text-faint" : BUCKET_TONE[bucket])}>{t(`bucket.${bucket}`)}</span>
                <span className={cn("font-mono text-[22px] font-semibold leading-none tabular", counts[bucket] === 0 ? "text-faint" : "text-fg")}>{counts[bucket]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-0">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-[16px] font-semibold text-fg">{t("dashboard.recent")}</h2>
          <Link href="/takedown/requests" className="ml-auto text-[13px] font-medium text-iris hover:text-iris-hi">{t("dashboard.viewAll")}</Link>
        </div>
        <ul>
          {requests.slice(0, 6).map((r) => (
            <li key={r.code} className="border-b border-line last:border-b-0">
              <Link
                href={`/takedown/requests/${r.code}`}
                className="grid grid-cols-1 items-center gap-x-5 gap-y-2 px-4 py-3 transition-colors hover:bg-raised/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris sm:grid-cols-[minmax(0,1fr)_160px_200px_16px] sm:px-5"
              >
                <LinkCell request={r} />
                <StepBar request={r} />
                <span><StatusTag request={r} /></span>
                <ChevronRight size={16} className="hidden text-faint sm:block" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Skeleton className="h-[120px] rounded-card" />
      <Skeleton className="h-[72px] rounded-card" />
      <Skeleton className="h-[320px] rounded-card" />
    </div>
  );
}
