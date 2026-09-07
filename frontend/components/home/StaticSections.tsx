"use client";

/** Các section nội dung tĩnh của trang chủ: Cách hoạt động, Tại sao chọn,
 *  Khách hàng nói gì, FAQ, banner CTA bán hàng. Chỉ FAQ có state (mở/đóng).
 *
 *  ⚠️ Testimonials + badge sao ở hero là nội dung DỰNG SẴN (chưa có nguồn
 *  thật) — đang chờ chủ sản phẩm quyết gỡ hay thay số thật; xem checklist
 *  refactor Đợt 4. */

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { ArrowRight, Bolt, Check, Clock, Search, Shield, Star, Verified } from "@/components/Icons";
import { SectionHead } from "./SectionHead";
import { ChevronIcon } from "./MarketSection";

export function HowItWorks() {
  const t = useTranslations("home");
  return (
    <section className="border-t border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
        <SectionHead title={t("howTitle")} sub={t("howSubtitle")} />
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { step: "1", icon: <Search size={22} />, title: t("howStep1Title"), desc: t("howStep1Desc") },
            { step: "2", icon: <Shield size={22} />, title: t("howStep2Title"), desc: t("howStep2Desc") },
            { step: "3", icon: <Check size={22} />, title: t("howStep3Title"), desc: t("howStep3Desc") },
          ].map((item) => (
            <Card key={item.step} className="p-6 relative">
              <span className="absolute top-4 right-5 font-mono text-[40px] font-bold text-faint">{item.step}</span>
              <span className="grid place-items-center h-11 w-11 rounded-lg bg-iris-soft text-iris border border-iris/15">
                {item.icon}
              </span>
              <div className="mt-4 font-medium text-[15px]">{item.title}</div>
              <p className="mt-1.5 text-[13px] text-muted leading-relaxed">{item.desc}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

export function WhyUs() {
  const t = useTranslations("home");
  return (
    <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
      <SectionHead title={t("whyTitle")} sub={t("whySubtitle")} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: <Shield size={20} />, title: t("whyEscrowTitle"), desc: t("whyEscrowDesc") },
          { icon: <Bolt size={20} />, title: t("whyDeliveryTitle"), desc: t("whyDeliveryDesc") },
          { icon: <Verified size={20} />, title: t("whyVerifiedTitle"), desc: t("whyVerifiedDesc") },
          { icon: <Clock size={20} />, title: t("whySupportTitle"), desc: t("whySupportDesc") },
        ].map((item) => (
          <Card key={item.title} interactive className="p-5">
            <span className="grid place-items-center h-10 w-10 rounded-lg bg-iris-soft text-iris border border-iris/15">
              {item.icon}
            </span>
            <div className="mt-4 font-medium text-[15px]">{item.title}</div>
            <p className="mt-1 text-[13px] text-muted leading-relaxed">{item.desc}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function Testimonials() {
  const t = useTranslations("home");
  return (
    <section className="border-y border-line bg-surface">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
        <SectionHead title={t("testimonialsTitle")} sub={t("testimonialsSubtitle")} />
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { name: "Minh Tuấn", role: t("review1Role"), initials: "MT", quote: t("review1Quote"), rating: 5 },
            { name: "Thu Hà", role: t("review2Role"), initials: "TH", quote: t("review2Quote"), rating: 5 },
            { name: "Đức Anh", role: t("review3Role"), initials: "ĐA", quote: t("review3Quote"), rating: 4 },
          ].map((review) => (
            <Card key={review.name} className="p-6">
              <div className="flex items-center gap-1 text-warn text-[14px]" aria-label={t("ratingLabel", { rating: review.rating })}>
                {Array.from({ length: review.rating }, (_, i) => <Star key={i} size={14} className="fill-warn" />)}
                {Array.from({ length: 5 - review.rating }, (_, i) => <Star key={`e${i}`} size={14} className="text-line-2" />)}
              </div>
              <p className="mt-3 text-[13.5px] text-muted leading-relaxed italic">&ldquo;{review.quote}&rdquo;</p>
              <div className="mt-4 flex items-center gap-3">
                <span className="grid place-items-center h-9 w-9 rounded-full bg-iris-soft text-iris text-[13px] font-semibold border border-iris/15">{review.initials}</span>
                <div>
                  <div className="text-[13.5px] font-medium">{review.name}</div>
                  <div className="text-[12px] text-faint">{review.role}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FaqSection() {
  const t = useTranslations("home");
  const faqItems = Array.from({ length: 12 }, (_, index) => ({
    q: t(`faq${index + 1}Q`),
    a: t(`faq${index + 1}A`),
  }));
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const mid = Math.ceil(faqItems.length / 2);
  const left = faqItems.slice(0, mid);
  const right = faqItems.slice(mid);

  const renderItem = (item: (typeof faqItems)[number], i: number) => (
    <Card key={i} className="overflow-hidden">
      <button
        onClick={() => toggle(i)}
        className="flex items-center justify-between w-full px-5 py-4 text-left"
      >
        <span className="font-medium text-[14px] pr-4">{item.q}</span>
        <ChevronIcon open={openSet.has(i)} />
      </button>
      {openSet.has(i) && (
        <div className="px-5 pb-4 text-[13px] text-muted leading-relaxed border-t border-line pt-3">
          {item.a}
        </div>
      )}
    </Card>
  );

  return (
    <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
      <SectionHead title={t("faqTitle")} sub={t("faqSubtitle")} />
      <div className="grid gap-2 md:grid-cols-2 md:gap-x-5 md:gap-y-2 items-start">
        <div className="space-y-2">
          {left.map((item, i) => renderItem(item, i))}
        </div>
        <div className="space-y-2">
          {right.map((item, i) => renderItem(item, mid + i))}
        </div>
      </div>
    </section>
  );
}

export function CtaBanner() {
  const t = useTranslations("home");
  return (
    <section className="border-t border-line aura">
      <div className="w-full mx-auto max-w-[1200px] px-6 py-16 text-center">
        <h2 className="font-serif text-[clamp(1.6rem,3vw,2.4rem)] tracking-tight">
          {t("ctaTitle")} <span className="text-iris italic">GMMO</span>
        </h2>
        <p className="mt-3 text-[14px] text-muted max-w-md mx-auto leading-relaxed">
          {t("ctaDescription")}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/seller/apply"><Button size="lg">{t("ctaApply")} <ArrowRight size={16} /></Button></Link>
          <Link href="#market"><Button size="lg" variant="secondary">{t("ctaMarket")}</Button></Link>
        </div>
      </div>
    </section>
  );
}
