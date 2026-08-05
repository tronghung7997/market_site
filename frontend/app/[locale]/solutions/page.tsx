"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Button, Card } from "@/components/ui";
import { ArrowRight, Bolt, Search, Shield } from "@/components/Icons";

const SOLUTION_META = [
  { key: "scraper" as const, href: "/products/11", icon: Bolt, accent: "iris" as const },
  { key: "takedown" as const, href: "/products/12", icon: Shield, accent: "good" as const },
];

const accentMap = {
  iris: {
    bg: "bg-iris-soft",
    text: "text-iris-hi",
    border: "border-iris/20",
    badge: "bg-iris text-white",
    hoverBorder: "group-hover:border-iris/40",
  },
  good: {
    bg: "bg-good-soft",
    text: "text-good",
    border: "border-good/20",
    badge: "bg-good text-white",
    hoverBorder: "group-hover:border-good/40",
  },
};

export default function SolutionsPage() {
  const t = useTranslations("solutions");

  const solutions = SOLUTION_META.map((meta) => {
    const features = t.raw(`${meta.key}.features`) as { label: string; detail: string }[];
    const stats = t.raw(`${meta.key}.stats`) as { value: string; label: string }[];
    return {
      ...meta,
      eyebrow: t(`${meta.key}.eyebrow`),
      title: t(`${meta.key}.title`),
      subtitle: t(`${meta.key}.subtitle`),
      description: t(`${meta.key}.description`),
      price: t(`${meta.key}.price`),
      features,
      stats,
    };
  });

  const trust = t.raw("trust") as string[];

  return (
    <div>
      <section className="border-b border-line">
        <div className="w-full mx-auto max-w-[1200px] px-6 pt-16 pb-14 text-center">
          <div className="inline-flex items-center gap-2 text-[12px] font-medium text-iris bg-iris-soft border border-iris/20 px-3 py-1 rounded-full mb-6">
            <Bolt size={12} />
            {t("badge")}
          </div>
          <h1 className="font-serif text-[clamp(1.8rem,4vw,2.8rem)] tracking-tight leading-[1.15] max-w-[680px] mx-auto">
            {t("heroTitle1")}{" "}
            <br className="hidden sm:block" />
            <span className="text-iris italic">{t("heroTitle2")}</span>
          </h1>
          <p className="mt-4 text-[15px] text-muted max-w-[520px] mx-auto leading-relaxed">
            {t("heroSubtitle")}
          </p>
        </div>
      </section>

      <section className="bg-surface">
        <div className="w-full mx-auto max-w-[1200px] px-6 py-14">
          <Link href="/solutions/tiktok-id" className="group mb-6 block">
            <Card className="relative overflow-hidden border-iris/25 bg-iris-soft/35 p-0 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-iris/45 group-hover:shadow-card-lg">
              <div className="absolute inset-y-0 right-0 hidden w-[42%] bg-[radial-gradient(circle_at_72%_46%,rgba(79,70,229,0.18),transparent_48%)] lg:block" />
              <div className="relative grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="max-w-xl">
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="grid h-10 w-10 place-items-center rounded-lg border border-iris/20 bg-surface text-iris-hi">
                      <Search size={19} />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iris-hi">
                      {t("lookup.eyebrow")}
                    </span>
                  </div>
                  <h2 className="font-serif text-[23px] font-semibold tracking-tight">{t("lookup.title")}</h2>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{t("lookup.description")}</p>
                </div>
                <div className="flex items-center gap-3 text-[13px] font-medium text-iris-hi">
                  {t("lookup.cta")}
                  <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Card>
          </Link>
          <div className="grid gap-6 lg:grid-cols-2">
            {solutions.map((s) => {
              const a = accentMap[s.accent];
              return (
                <Link key={s.key} href={s.href} className="group">
                  <Card
                    className={cn(
                      "p-0 h-full flex flex-col overflow-hidden border transition-all duration-200",
                      a.border,
                      a.hoverBorder,
                      "group-hover:shadow-card-lg group-hover:-translate-y-1",
                    )}
                  >
                    <div className="px-6 pt-6 pb-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <span className={cn("grid place-items-center h-10 w-10 rounded-lg", a.bg, a.text)}>
                            <s.icon size={20} />
                          </span>
                          <span className={cn("text-[11px] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 rounded", a.badge)}>
                            {s.eyebrow}
                          </span>
                        </div>
                        <ArrowRight
                          size={18}
                          className="text-faint group-hover:text-fg group-hover:translate-x-0.5 transition-all"
                        />
                      </div>
                      <h2 className="font-serif text-[22px] font-semibold tracking-tight">{s.title}</h2>
                      <p className="text-[13.5px] text-muted mt-1">{s.subtitle}</p>
                    </div>

                    <div className="px-6 pb-5">
                      <p className="text-[13px] text-muted leading-relaxed">{s.description}</p>
                    </div>

                    <div className="px-6 pb-5 grid grid-cols-2 gap-2.5 flex-1">
                      {s.features.map((f) => (
                        <div key={f.label} className="rounded-lg bg-raised/60 border border-line px-3 py-2.5">
                          <div className="font-mono text-[14px] font-semibold tabular">{f.label}</div>
                          <div className="text-[11.5px] text-faint mt-0.5">{f.detail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-auto px-6 py-4 border-t border-line bg-raised/40 flex items-center justify-between">
                      <div className="flex items-center gap-5">
                        {s.stats.map((st) => (
                          <div key={st.label} className="text-center">
                            <div className={cn("font-mono text-[15px] font-semibold tabular", a.text)}>{st.value}</div>
                            <div className="text-[10.5px] text-faint">{st.label}</div>
                          </div>
                        ))}
                      </div>
                      <div className="text-right">
                        <div className="text-[10.5px] text-faint">{t("priceFrom")}</div>
                        <div className="font-mono text-[13px] font-semibold">{s.price}</div>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-line">
        <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
          <div className="text-center mb-6">
            <h3 className="font-serif text-[18px] font-semibold tracking-tight">{t("trustTitle")}</h3>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {trust.map((line, i) => (
              <div key={i} className="flex items-start gap-2.5 text-[13px] text-muted">
                <span className="mt-0.5 shrink-0 h-4 w-4 rounded-full bg-good-soft grid place-items-center">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-good">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </span>
                {line}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="aura">
        <div className="w-full mx-auto max-w-[1200px] px-6 py-16 text-center">
          <h2 className="font-serif text-[clamp(1.4rem,3vw,2rem)] tracking-tight">{t("ctaTitle")}</h2>
          <p className="mt-2 text-[14px] text-muted max-w-md mx-auto">{t("ctaSubtitle")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/register">
              <Button size="lg">
                {t("ctaRegister")} <ArrowRight size={16} />
              </Button>
            </Link>
            <Link href="/">
              <Button size="lg" variant="secondary">{t("ctaExplore")}</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
