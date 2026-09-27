"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, Input } from "@/components/ui";
import {
  AlertTriangle, ChevronDown, ChevronRight, FileText, Flag, Headset, MessageCircle, Package, Search, ShieldCheck, Store, Wallet,
} from "@/components/Icons";
import { openHelpdesk } from "@/features/helpdesk";
import { cn } from "@/lib/cn";
import type { SitePageLink } from "@/lib/types";
import { countByTopic, filterFaq, SUPPORT_FAQ, SUPPORT_TOPICS, type FaqEntry, type SupportTopic } from "../model";

const TOPIC_ICONS: Record<SupportTopic, typeof Package> = {
  orders: Package,
  payments: Wallet,
  account: ShieldCheck,
  disputes: Flag,
  sellers: Store,
  safety: AlertTriangle,
};

const BUYING_STEPS = ["topUp", "buy", "check", "finish"] as const;
const SAFETY_POINTS = ["otp", "offPlatform", "evidence", "password"] as const;

/** Slug of the admin page that holds GMMO's contact details, when one exists. */
const CONTACT_PAGE_SLUG = "contact";

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

export function SupportCenter({ pages }: { pages: SitePageLink[] }) {
  const t = useTranslations("support");
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<SupportTopic | null>(null);
  // `/support?q=…#faq` (from the ⌘K palette) opens with that search applied.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!q) return;
    setQuery(q.slice(0, 80));
    requestAnimationFrame(() => scrollToId("faq"));
  }, []);

  const entries = useMemo<FaqEntry[]>(
    () => SUPPORT_TOPICS.flatMap((tp) => SUPPORT_FAQ[tp].map((id) => ({
      id, topic: tp, q: t(`faq.${id}.q`), a: t(`faq.${id}.a`),
    }))),
    [t],
  );
  const visible = useMemo(() => filterFaq(entries, { topic, query }), [entries, topic, query]);
  const counts = useMemo(() => countByTopic(entries, query), [entries, query]);
  const totalMatches = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const contactPage = pages.find((page) => page.slug === CONTACT_PAGE_SLUG) ?? null;

  const pickTopic = (next: SupportTopic | null, scroll: boolean) => {
    setTopic(next);
    if (scroll) scrollToId("faq");
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 py-8 sm:py-12 space-y-12">
      <section aria-labelledby="support-title" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-end">
        <div className="max-w-[640px]">
          <h1 id="support-title" className="font-serif text-[32px] sm:text-[40px] leading-[1.1] tracking-tight font-semibold">{t("title")}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{t("lead")}</p>
          <form
            role="search"
            className="mt-6 relative"
            onSubmit={(e) => { e.preventDefault(); scrollToId("faq"); }}
          >
            <label htmlFor="support-search" className="sr-only">{t("searchLabel")}</label>
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              id="support-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-11 pl-10 text-[14px]"
              autoComplete="off"
            />
          </form>
        </div>
        <nav aria-label={t("shortcutsLabel")} className="grid gap-2">
          {([
            { key: "orders", href: "/orders", icon: Package },
            { key: "wallet", href: "/wallet", icon: Wallet },
            { key: "messages", href: "/messages", icon: MessageCircle },
          ] as const).map(({ key, href, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              className="group flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 hover:border-line-2 transition-colors"
            >
              <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-iris-soft text-iris-hi"><Icon size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">{t(`shortcuts.${key}.title`)}</span>
                <span className="block text-[12.5px] text-muted">{t(`shortcuts.${key}.body`)}</span>
              </span>
              <ChevronRight size={15} className="text-faint group-hover:text-fg transition-colors" />
            </Link>
          ))}
        </nav>
      </section>

      <section aria-labelledby="topics-title">
        <h2 id="topics-title" className="font-serif text-[20px] font-semibold tracking-tight mb-4">{t("topicsTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SUPPORT_TOPICS.map((tp) => {
            const Icon = TOPIC_ICONS[tp];
            const on = topic === tp;
            return (
              <button
                key={tp}
                type="button"
                aria-pressed={on}
                onClick={() => pickTopic(on ? null : tp, true)}
                className={cn(
                  "flex items-start gap-3 rounded-card border bg-surface p-4 text-left transition-colors",
                  on ? "border-iris ring-1 ring-iris" : "border-line hover:border-line-2",
                )}
              >
                <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-raised text-fg"><Icon size={16} /></span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{t(`topics.${tp}.title`)}</span>
                  <span className="block mt-0.5 text-[12.5px] text-muted leading-relaxed">{t(`topics.${tp}.body`)}</span>
                  <span className="block mt-2 text-[12px] text-faint">{t("questionCount", { count: SUPPORT_FAQ[tp].length })}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section id="buying" aria-labelledby="buying-title" className="scroll-mt-24">
          <Card className="p-5 sm:p-6 h-full">
            <h2 id="buying-title" className="font-serif text-[20px] font-semibold tracking-tight">{t("buyingTitle")}</h2>
            <p className="mt-1.5 text-[13px] text-muted leading-relaxed">{t("buyingLead")}</p>
            <ol className="mt-5 space-y-4">
              {BUYING_STEPS.map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span aria-hidden className="grid place-items-center h-7 w-7 shrink-0 rounded-full border border-line-2 font-mono text-[12px] font-semibold text-fg">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{t(`buyingSteps.${step}.title`)}</span>
                    <span className="block mt-0.5 text-[13px] text-muted leading-relaxed">{t(`buyingSteps.${step}.body`)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </section>

        <section id="safety" aria-labelledby="safety-title" className="scroll-mt-24">
          <div className="h-full rounded-card border border-warn/25 bg-warn-soft p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-warn shrink-0 mt-1" />
              <div className="min-w-0">
                <h2 id="safety-title" className="font-serif text-[20px] font-semibold tracking-tight">{t("safetyTitle")}</h2>
                <p className="mt-1.5 text-[13px] text-fg/85 leading-relaxed">{t("safetyLead")}</p>
              </div>
            </div>
            <ul className="mt-4 space-y-2.5">
              {SAFETY_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-[13px] leading-relaxed">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                  <span>{t(`safetyPoints.${point}`)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
              <button
                type="button"
                onClick={() => openHelpdesk({ draft: t("safetyReportDraft") })}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-fg px-3.5 text-[13px] font-medium text-surface hover:opacity-90"
              >
                <Flag size={13} /> {t("safetyReport")}
              </button>
              <Link href="/account" className="inline-flex items-center gap-1 text-[13px] font-medium text-fg underline underline-offset-2 hover:no-underline">
                {t("safetyAction")} <ChevronRight size={13} />
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <h2 id="faq-title" className="font-serif text-[20px] font-semibold tracking-tight">{t("faqTitle")}</h2>
        </div>
        <div role="group" aria-label={t("topicsTitle")} className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
          <FilterChip on={topic === null} onClick={() => pickTopic(null, false)}>
            {t("faqAll")} <span className="font-mono text-[11px] opacity-75">{totalMatches}</span>
          </FilterChip>
          {SUPPORT_TOPICS.map((tp) => (
            <FilterChip key={tp} on={topic === tp} onClick={() => pickTopic(tp, false)}>
              {t(`topics.${tp}.title`)} <span className="font-mono text-[11px] opacity-75">{counts[tp]}</span>
            </FilterChip>
          ))}
        </div>
        <Card className="mt-3 overflow-hidden">
          {visible.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-[13.5px] text-muted">{t("faqEmpty", { query: query.trim() })}</p>
              <button
                type="button"
                onClick={() => { setQuery(""); setTopic(null); }}
                className="mt-3 text-[13px] font-medium text-iris-hi hover:underline"
              >
                {t("faqClear")}
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((entry) => (
                <li key={entry.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[14px] font-medium hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris [&::-webkit-details-marker]:hidden">
                      <span>{entry.q}</span>
                      <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="px-5 pb-4 -mt-1 text-[13.5px] leading-relaxed text-muted max-w-[760px]">{entry.a}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section id="contact" aria-labelledby="contact-title" className="scroll-mt-24">
        <h2 id="contact-title" className="font-serif text-[20px] font-semibold tracking-tight">{t("contactTitle")}</h2>
        <p className="mt-1.5 text-[13px] text-muted">{t("contactLead")}</p>
        <div className={cn("mt-4 grid gap-3 md:grid-cols-2", contactPage ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
          <ChannelCard icon={Package} title={t("channels.order.title")} body={t("channels.order.body")} action={t("channels.order.action")} href="/orders" />
          <ChannelCard icon={MessageCircle} title={t("channels.shop.title")} body={t("channels.shop.body")} action={t("channels.shop.action")} href="/messages" />
          <ChannelCard
            icon={Headset}
            title={t("channels.desk.title")}
            body={t("channels.desk.body")}
            action={t("channels.desk.action")}
            onClick={() => openHelpdesk({ draft: t("channels.desk.draft") })}
          />
          {contactPage && (
            <ChannelCard icon={FileText} title={t("channels.platform.title")} body={t("channels.platform.body")} action={t("channels.platform.action")} href={`/legal/${contactPage.slug}`} />
          )}
        </div>
      </section>

      {pages.length > 0 && (
        <section aria-labelledby="policies-title">
          <h2 id="policies-title" className="text-[13px] font-semibold text-faint mb-3">{t("policiesTitle")}</h2>
          <ul className="flex flex-wrap gap-2">
            {pages.filter((page) => page.slug !== CONTACT_PAGE_SLUG).map((page) => (
              <li key={page.slug}>
                <Link href={`/legal/${page.slug}`} className="inline-flex items-center rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-muted hover:text-fg hover:border-line-2 transition-colors">
                  {page.title}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/sell" className="inline-flex items-center rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-muted hover:text-fg hover:border-line-2 transition-colors">
                {t("sellerGuide")}
              </Link>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 h-8 rounded-lg border px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors",
        on ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:text-fg hover:border-line-2",
      )}
    >
      {children}
    </button>
  );
}

/** A way to get help: a page to go to (`href`) or the GMMO chat (`onClick`). */
function ChannelCard({ icon: Icon, title, body, action, href, onClick }: {
  icon: typeof Package; title: string; body: string; action: string; href?: string; onClick?: () => void;
}) {
  const actionClass = "mt-4 inline-flex items-center gap-1 self-start text-[13px] font-medium text-iris-hi hover:underline";
  return (
    <Card className="p-5 flex flex-col">
      <span className="grid place-items-center h-9 w-9 rounded-lg bg-raised text-fg"><Icon size={16} /></span>
      <h3 className="mt-3 text-[14px] font-medium">{title}</h3>
      <p className="mt-1 text-[13px] text-muted leading-relaxed flex-1">{body}</p>
      {href ? (
        <Link href={href} className={actionClass}>{action} <ChevronRight size={13} /></Link>
      ) : (
        <button type="button" onClick={onClick} className={actionClass}>{action} <ChevronRight size={13} /></button>
      )}
    </Card>
  );
}
