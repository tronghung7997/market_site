"use client";

/** Home-page trust blocks built only from real data: marketplace counts,
 *  buyer-written reviews, safety habits and the signed-in buyer's
 *  "orders waiting for you" reminder. Each block hides itself when it has
 *  nothing true to show. */

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Card, Tag } from "@/components/ui";
import { AlertCircle, ArrowRight, ShieldCheck, Star } from "@/components/Icons";
import { SectionHead } from "@/components/home/SectionHead";
import { useBuyerOrderStats } from "@/features/buyer-orders";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { MarketplaceStats, ShowcaseReview } from "@/lib/types";

const LG_COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

function formatCount(value: number, locale: string) {
  return value.toLocaleString(locale === "vi" ? "vi-VN" : "en-US");
}

/** One segmented summary (DESIGN.md §10): a cell per non-zero figure. */
export function MarketStatsStrip({ stats }: { stats: MarketplaceStats | null }) {
  const t = useTranslations("home");
  const locale = useLocale();
  if (!stats) return null;
  const cells = [
    { key: "products", value: stats.products_on_sale, label: t("statProducts", { count: stats.products_on_sale }) },
    { key: "sellers", value: stats.sellers_on_sale, label: t("statSellers", { count: stats.sellers_on_sale }) },
    { key: "orders", value: stats.completed_orders, label: t("statOrders", { count: stats.completed_orders }) },
  ].filter((cell) => cell.value > 0);
  const rated = stats.rating_avg != null && stats.review_count > 0;
  if (cells.length === 0 && !rated) return null;
  const total = cells.length + (rated ? 1 : 0);
  return (
    <section aria-label={t("statsLabel")} className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 pt-6">
      <dl className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line",
        "[&>div:last-child:nth-child(odd)]:col-span-2 lg:[&>div:last-child:nth-child(odd)]:col-span-1",
        LG_COLS[total],
      )}>
        {cells.map((cell) => (
          <div key={cell.key} className="flex flex-col-reverse gap-1.5 bg-surface px-4 py-3.5 sm:px-5">
            <dt className="text-[12.5px] text-muted">{cell.label}</dt>
            <dd className="font-mono text-[20px] sm:text-[22px] font-semibold tabular leading-none">{formatCount(cell.value, locale)}</dd>
          </div>
        ))}
        {rated && (
          <div className="flex flex-col-reverse gap-1.5 bg-surface px-4 py-3.5 sm:px-5">
            <dt className="text-[12.5px] text-muted">{t("statRating", { count: stats.review_count })}</dt>
            <dd className="flex items-center gap-1.5 font-mono text-[20px] sm:text-[22px] font-semibold tabular leading-none">
              <Star size={16} className="text-warn fill-warn" /> {stats.rating_avg!.toFixed(1)}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Signed-in buyers with delivered, unconfirmed orders get one reminder. */
export function AwaitingOrdersBanner() {
  const t = useTranslations("home");
  const { account } = useAuth();
  const stats = useBuyerOrderStats(account?.id, !!account);
  const count = stats.data?.awaiting_confirm ?? 0;
  if (!account || count === 0) return null;
  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 pt-5">
      <div role="status" className="flex flex-col gap-3 rounded-card border border-warn/25 bg-warn-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-warn shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-medium">{t("awaitingTitle", { count })}</p>
            <p className="mt-0.5 text-[13px] text-fg/80">{t("awaitingBody")}</p>
          </div>
        </div>
        <Link
          href="/orders?status=awaiting_confirm"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-iris px-4 text-[13px] font-medium text-white hover:brightness-110 transition"
        >
          {t("awaitingAction")} <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={label}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={13} className={i < rating ? "text-warn fill-warn" : "text-line-2"} />
      ))}
    </span>
  );
}

/** Newest written reviews on products still on sale; replaces the old
 *  hard-coded testimonials. */
export function LatestReviews({ reviews }: { reviews: ShowcaseReview[] }) {
  const t = useTranslations("home");
  const locale = useLocale();
  if (reviews.length === 0) return null;
  const dateFmt = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium" });
  return (
    <section className="border-y border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-6 lg:py-8">
        <SectionHead title={t("reviewsTitle")} sub={t("reviewsSubtitle")} />
        <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review) => (
            <li key={review.id}>
              <Card className="h-full p-5 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <Stars rating={review.rating} label={t("reviewStars", { rating: review.rating })} />
                  <time dateTime={review.created_at} className="text-[12px] text-faint">{dateFmt.format(new Date(review.created_at))}</time>
                </div>
                <p className="mt-3 text-[13.5px] leading-relaxed text-fg line-clamp-4 whitespace-pre-line">{review.comment}</p>
                <div className="mt-auto pt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
                  <span className="font-medium text-fg">{review.reviewer_label}</span>
                  <Tag tone="good">{t("reviewPurchased")}</Tag>
                  <span className="min-w-0 truncate">
                    {review.product_path ? (
                      <Link href={review.product_path} className="hover:text-fg underline decoration-line-2 underline-offset-2">
                        {t("reviewAbout", { product: review.product_title })}
                      </Link>
                    ) : t("reviewAbout", { product: review.product_title })}
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function SafeTrading() {
  const t = useTranslations("home");
  const points = [t("safetyPay"), t("safetyOtp"), t("safetyCheck"), t("safetyEvidence")];
  return (
    <section className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-6 lg:py-8">
      <SectionHead title={t("safetyTitle")} sub={t("safetySubtitle")} />
      <Card className="p-5 sm:p-6">
        <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed">
              <ShieldCheck size={16} className="text-good shrink-0 mt-0.5" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-[13px] font-medium">
          <Link href="/support#safety" className="inline-flex items-center gap-1 text-iris-hi hover:underline">{t("safetyLink")} <ArrowRight size={13} /></Link>
          <Link href="/legal/escrow" className="inline-flex items-center gap-1 text-iris-hi hover:underline">{t("escrowPolicy")} <ArrowRight size={13} /></Link>
        </div>
      </Card>
    </section>
  );
}
