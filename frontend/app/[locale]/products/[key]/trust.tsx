"use client";

/** Product-page blocks that answer "can I trust this and what happens next":
 *  pay-inside notice, key facts, section navigation, delivery process, the
 *  seller-written Q&A, the shop card and buyer protection. Everything shown
 *  comes from the product, its packages or the shop's public profile. */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Banner, Card, Monogram } from "@/components/ui";
import { ChevronDown, ShieldCheck, Star, Store, Verified } from "@/components/Icons";
import { MediaImage } from "@/components/media/MediaImage";
import { fulfillmentFromProduct, fulfillmentTagValues } from "@/lib/fulfillment";
import { sellerPath } from "@/lib/routes";
import { cn } from "@/lib/cn";
import { timeLeftLabel } from "@/lib/time";
import type { ProductDetail, SellerProfile } from "@/lib/types";
import { SellerPresence, TrustBadge } from "@/features/sellers";
import { deliverySummary } from "./purchase";
import { SectionHead } from "./sections";

/** "What you receive" when the seller wrote none. A manual (SLA) package's
 *  generic line is about timing, which the Delivery fact already says. */
function useReceiveFallback(product: ProductDetail): string {
  const t = useTranslations("products");
  const fulfillment = fulfillmentFromProduct(product);
  return fulfillment.kind === "sla"
    ? t("factReceiveInOrder")
    : t(`fulfillmentReceive.${fulfillment.kind}`, fulfillmentTagValues(fulfillment));
}

export function PayInsideNotice({ days }: { days: number }) {
  const t = useTranslations("products");
  return (
    <Banner
      tone="iris"
      icon={<ShieldCheck size={15} />}
      title={t("payInsideTitle")}
      className="mb-4"
      action={<Link href="/legal/escrow" className="text-[12.5px] font-medium underline underline-offset-2">{t("escrowPolicy")}</Link>}
    >
      <span className="text-fg/80">{t("payInsideBody", { days })}</span>
    </Banner>
  );
}

/** Three facts a buyer compares first; one segmented surface, not three cards. */
export function KeyFacts({ product }: { product: ProductDetail }) {
  const t = useTranslations("products");
  const summary = deliverySummary(product.variants, product.pricing_strategy);
  const delivery = summary.kind === "instant"
    ? t("factDeliveryInstant")
    : summary.kind === "hours"
      ? t("factDeliveryHours", { hours: summary.hours })
      : summary.kind === "mixed"
        ? t("factDeliveryMixed", { hours: summary.hours })
        : t("factDeliveryAuto");
  const fallback = useReceiveFallback(product);
  const receive = product.delivery_note?.split("\n")[0]?.trim() || fallback;
  const facts = [
    { label: t("factDelivery"), value: delivery },
    { label: t("factProtection"), value: t("factProtectionValue", { days: product.escrow_days }) },
    { label: t("factReceive"), value: receive },
  ];
  return (
    <section aria-label={t("factsLabel")}>
      <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col-reverse gap-1 bg-surface px-4 py-3">
            <dd className="text-[13px] font-medium leading-snug line-clamp-2">{fact.value}</dd>
            <dt className="text-[11.5px] text-muted">{fact.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

export type ProductSection = { id: string; label: string };

/** Sticky in-page navigation; the section in view is marked current. */
export function SectionNav({ sections }: { sections: ProductSection[] }) {
  const t = useTranslations("products");
  const [current, setCurrent] = useState<string | null>(sections[0]?.id ?? null);
  const ids = sections.map((s) => s.id).join(",");

  useEffect(() => {
    const els = ids.split(",").map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);

  if (sections.length < 2) return null;
  return (
    <nav
      aria-label={t("sectionNav")}
      className="sticky top-14 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 bg-base/95 backdrop-blur supports-[backdrop-filter]:bg-base/80"
    >
      <ul className="flex gap-1 overflow-x-auto border-b border-line">
        {sections.map((section) => {
          const on = current === section.id;
          return (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "inline-flex h-11 items-center border-b-2 px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                  on ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
                )}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const PROCESS = ["Pay", "Deliver", "Check", "Release"] as const;

export function DeliveryCard({ product }: { product: ProductDetail }) {
  const t = useTranslations("products");
  const fallback = useReceiveFallback(product);
  const receive = product.delivery_note?.trim() || fallback;
  const steps = product.inspection_steps?.filter(Boolean) ?? [];
  return (
    <Card id="delivery" className="overflow-hidden scroll-mt-28">
      <SectionHead title={t("deliveryTitle")} />
      <div className="p-5 space-y-5 text-[13px]">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="text-[12.5px] font-semibold text-fg">{t("deliveryReceive")}</h3>
            <p className="mt-1.5 text-muted leading-relaxed whitespace-pre-line">{receive}</p>
          </div>
          <div>
            <h3 className="text-[12.5px] font-semibold text-fg">{t("deliveryCheck")}</h3>
            {steps.length > 0 ? (
              <ul className="mt-1.5 space-y-1.5">
                {steps.map((step) => (
                  <li key={step} className="flex items-start gap-2 text-muted leading-relaxed">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-iris" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-muted leading-relaxed">{t("deliveryCheckDefault")}</p>
            )}
          </div>
        </div>
        <div className="border-t border-line pt-4">
          <h3 className="text-[12.5px] font-semibold text-fg">{t("deliveryStepsLabel")}</h3>
          <ol className="mt-3 grid gap-3 sm:grid-cols-4">
            {PROCESS.map((step, i) => (
              <li key={step} className="flex gap-2.5 sm:flex-col sm:gap-2">
                <span aria-hidden className="grid place-items-center h-6 w-6 shrink-0 rounded-full border border-line-2 font-mono text-[11px] font-semibold">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block font-medium text-fg">{t(`deliveryStep${step}`, { days: product.escrow_days })}</span>
                  <span className="block text-[12px] text-muted leading-relaxed">{t(`deliveryStep${step}Body`)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}

export function FaqCard({ product }: { product: ProductDetail }) {
  const t = useTranslations("products");
  const items = product.faq?.filter((item) => item.q && item.a) ?? [];
  if (items.length === 0) return null;
  return (
    <Card id="faq" className="overflow-hidden scroll-mt-28">
      <SectionHead title={t("faqTitle")} />
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.q}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 text-[13.5px] font-medium hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris [&::-webkit-details-marker]:hidden">
                <span>{item.q}</span>
                <ChevronDown size={15} className="shrink-0 text-faint transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-5 pb-4 -mt-0.5 text-[13px] leading-relaxed text-muted whitespace-pre-line">{item.a}</p>
            </details>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted">{t("faqAsk")}</p>
    </Card>
  );
}

/** "About the shop" row under the reviews: identity, public track record and
 *  a way into the shop. Figures come from the shop's public profile. */
export function SellerCard({ seller }: { seller: SellerProfile }) {
  const t = useTranslations("products");
  const locale = useLocale();
  const since = seller.member_since
    ? new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { month: "short", year: "numeric" }).format(new Date(seller.member_since))
    : null;
  const nf = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");
  const rated = seller.rating_avg != null && seller.review_count > 0;
  return (
    <Card className="overflow-hidden">
      <SectionHead title={t("sellerCardTitle")} />
      <div className="p-5 flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
        <div className="flex items-center gap-3 md:w-[240px] md:shrink-0">
          {seller.logo ? (
            <MediaImage image={seller.logo} alt="" className="h-11 w-11 shrink-0 rounded-full border border-line" />
          ) : (
            <Monogram text={seller.display_name} className="h-11 w-11 shrink-0 rounded-full" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link href={sellerPath(seller)} className="truncate text-[14px] font-medium hover:underline">{seller.display_name}</Link>
              {seller.tier_badge && <MediaImage image={seller.tier_badge} alt="" className="h-4 w-4 shrink-0 rounded-sm" />}
            </div>
            <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-good"><Verified size={12} /> {t("verified")}</span>
            <TrustBadge seller={seller} compact />
            <SellerPresence seller={seller} className="mt-1 flex-col gap-y-0.5" />
          </div>
        </div>
        <dl className="grid flex-1 grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
          <div className="flex flex-col-reverse gap-0.5 bg-surface px-2 py-2.5">
            <dt className="text-[11.5px] text-muted">{rated ? t("sellerReviewsCount", { count: seller.review_count }) : t("sellerRating")}</dt>
            <dd className="flex items-center justify-center gap-1 font-mono text-[14px] font-semibold tabular">
              {rated
                ? <><Star size={12} className="text-warn fill-warn" /> {seller.rating_avg!.toFixed(1)}</>
                : <span className="font-sans text-[12px] font-normal text-muted">{t("sellerNoRating")}</span>}
            </dd>
          </div>
          <div className="flex flex-col-reverse gap-0.5 bg-surface px-2 py-2.5">
            <dt className="text-[11.5px] text-muted">{t("sellerCompleted")}</dt>
            <dd className="font-mono text-[14px] font-semibold tabular">{nf.format(seller.completed_order_count)}</dd>
          </div>
          <div className="flex flex-col-reverse gap-0.5 bg-surface px-2 py-2.5">
            <dt className="text-[11.5px] text-muted">{t("sellerSince")}</dt>
            <dd className="text-[12.5px] font-medium">{since ?? "—"}</dd>
          </div>
        </dl>
        <Link
          href={sellerPath(seller)}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line-2 bg-raised px-4 text-[13px] font-medium hover:border-faint transition-colors"
        >
          <Store size={14} /> {t("sellerVisit")}
        </Link>
      </div>
    </Card>
  );
}

/** Live "protection ends in …" for a delivered order, the product's own
 *  checklist, and the way into the order to confirm or report a problem. */
export function InspectionPanel({ orderCode, escrowExpiresAt, steps }: {
  orderCode: string;
  escrowExpiresAt: string;
  steps?: string[] | null;
}) {
  const t = useTranslations("products");
  const locale = useLocale();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const left = timeLeftLabel(escrowExpiresAt, locale);
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(escrowExpiresAt));
  const checklist = steps?.filter(Boolean) ?? [];
  return (
    <section aria-label={t("inspectTitle")} className={cn(
      "rounded-lg border p-3.5 space-y-2.5",
      left ? "border-warn/25 bg-warn-soft" : "border-line bg-raised/60",
    )}>
      <p className="flex items-start gap-2 text-[12.5px] font-medium text-fg">
        <ShieldCheck size={14} className={cn("mt-0.5 shrink-0", left ? "text-warn" : "text-muted")} />
        <span>
          {left ? t("protectionLeft", { left }) : t("protectionEnded")}
          <span className="block text-[11.5px] font-normal text-muted"><time dateTime={escrowExpiresAt}>{date}</time></span>
        </span>
      </p>
      {left && checklist.length > 0 && (
        <div>
          <p className="text-[11.5px] font-semibold text-muted">{t("inspectTitle")}</p>
          <ul className="mt-1 space-y-1">
            {checklist.map((step) => (
              <li key={step} className="flex items-start gap-2 text-[12px] text-fg/85">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {left && (
        <Link
          href={`/orders?order=${encodeURIComponent(orderCode)}`}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline"
        >
          {t("protectionAction")}
        </Link>
      )}
    </section>
  );
}
