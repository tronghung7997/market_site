"use client";

/** Các section nội dung tĩnh của trang chủ: Cách hoạt động, FAQ, banner CTA
 *  bán hàng. Chỉ FAQ có state (mở/đóng). Đánh giá của người
 *  mua lấy từ dữ liệu thật (features/catalog/ui/HomeTrust.tsx). */

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { ArrowRight, Check, Shield, Wallet } from "@/components/Icons";
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
            { step: "1", icon: <Wallet size={22} />, title: t("howStep1Title"), desc: t("howStep1Desc") },
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
        <Link href="/support#buying" className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-iris-hi hover:underline">
          {t("howGuide")} <ArrowRight size={13} />
        </Link>
      </div>
    </section>
  );
}

export function FaqSection() {
  const t = useTranslations("home");
  // Six questions a buyer asks first; the rest live in the help center.
  const faqItems = [1, 2, 3, 5, 7, 10].map((n) => ({
    q: t(`faq${n}Q`),
    a: t(`faq${n}A`),
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
        type="button"
        aria-expanded={openSet.has(i)}
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
      <Link href="/support#faq" className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-iris-hi hover:underline">
        {t("faqMore")} <ArrowRight size={13} />
      </Link>
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
          <Link href="/sell"><Button size="lg">{t("ctaApply")} <ArrowRight size={16} /></Button></Link>
          <Link href="#market"><Button size="lg" variant="secondary">{t("ctaMarket")}</Button></Link>
        </div>
      </div>
    </section>
  );
}
