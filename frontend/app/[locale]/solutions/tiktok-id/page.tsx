"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { TikTokLookupResponse } from "@/lib/types";
import { Banner, Button, Card, CopyButton, Input, Tag } from "@/components/ui";
import { ArrowRight, Check, Clock, Search, Shield, Verified } from "@/components/Icons";

function formatCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function ResultSkeleton() {
  return <div className="space-y-5 border-t border-line px-5 py-5 sm:px-6" aria-busy="true" aria-label="Loading result">
    <div className="flex items-center gap-3"><div className="h-12 w-12 animate-pulse rounded-xl bg-raised" /><div className="flex-1 space-y-2"><div className="h-4 w-32 animate-pulse rounded bg-raised" /><div className="h-3 w-24 animate-pulse rounded bg-raised" /></div></div>
    <div className="rounded-xl border border-line bg-surface p-4"><div className="h-3 w-20 animate-pulse rounded bg-raised" /><div className="mt-3 h-7 w-52 animate-pulse rounded bg-raised" /></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-raised" />)}</div>
  </div>;
}

export default function TikTokIdPage() {
  const t = useTranslations("tiktokLookup");
  const apiErrorMessage = useApiErrorMessage();
  const locale = useLocale();
  const [value, setValue] = useState("");
  const [result, setResult] = useState<TikTokLookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const lookup = async (event?: FormEvent<HTMLFormElement>, example?: string) => {
    event?.preventDefault();
    const input = example ?? value;
    if (example) setValue(example);
    if (!input.trim()) { setError(t("errors.empty")); setResult(null); return; }
    setLoading(true); setError(null); setResult(null);
    try { setResult(await api.tiktokLookup(input)); }
    catch (cause) { setError(apiErrorMessage(cause, t("errors.generic"))); }
    finally { setLoading(false); }
  };

  const profile = result?.profile;
  useEffect(() => {
    if (profile) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [profile]);

  const stats = profile ? [
    [t("stats.followers"), formatCount(profile.follower_count, locale)],
    [t("stats.likes"), formatCount(profile.heart_count, locale)],
    [t("stats.videos"), formatCount(profile.video_count, locale)],
    [t("stats.following"), formatCount(profile.following_count, locale)],
    [t("stats.friends"), formatCount(profile.friend_count, locale)],
    [t("stats.diggs"), formatCount(profile.digg_count, locale)],
  ] : [];

  return <div className="bg-surface">
    <section className="mx-auto grid max-w-[1120px] gap-5 px-6 py-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(480px,1.28fr)] lg:items-start lg:py-6">
      <div>
        <Link href="/solutions" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-iris-hi">{t("back")} <ArrowRight size={14} /></Link>
        <div className="mb-2 inline-flex items-center gap-2 text-[12px] font-medium text-iris-hi"><span className="grid h-6 w-6 place-items-center rounded-md bg-iris-soft"><Search size={13} /></span>{t("eyebrow")}</div>
        <h1 className="max-w-md font-serif text-[clamp(2.1rem,3.6vw,3.15rem)] leading-[1.06] tracking-tight">{t("title")}</h1>
        <p className="mt-2 max-w-[44ch] text-[14px] leading-relaxed text-muted">{t("subtitle")}</p>
        <div className="mt-4 space-y-1.5 border-l border-iris/30 pl-3.5">
          <div className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted"><Shield size={16} className="mt-0.5 shrink-0 text-iris" />{t("benefits.private")}</div>
          <div className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted"><Clock size={16} className="mt-0.5 shrink-0 text-iris" />{t("benefits.fast")}</div>
        </div>
      </div>

      <Card className="overflow-hidden border-line-2 p-0 shadow-card-lg">
        <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-2 sm:px-5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">{t("workspace.title")}</span>
          {profile ? <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-good"><Check size={13} />{t("workspace.ready")}</span> : <span className="text-[12px] text-faint">TikTok</span>}
        </div>
        <form className="px-4 py-3 sm:px-5" onSubmit={lookup} noValidate>
          <label htmlFor="tiktok-profile" className="mb-1.5 block text-[13px] font-medium text-fg">{t("input.label")}</label>
          <div className="flex flex-col gap-2 sm:flex-row"><Input id="tiktok-profile" value={value} onChange={(event) => setValue(event.target.value)} placeholder={t("input.placeholder")} autoComplete="off" spellCheck="false" className="h-10 flex-1" /><Button size="md" type="submit" disabled={loading} className="h-10 px-5">{loading ? t("actions.loading") : t("actions.submit")}</Button></div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{t("input.hint")}</p>
          <button type="button" onClick={() => lookup(undefined, "https://www.tiktok.com/@katyperry")} className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-iris-hi hover:text-iris"><Search size={13} /> {t("actions.example")}</button>
        </form>

        {loading && <ResultSkeleton />}
        {error && <div className="border-t border-line p-4 sm:px-5"><Banner tone="bad" title={t("errors.title")}>{error}</Banner></div>}
        {!loading && !error && !result && <div className="border-t border-line px-4 py-5 sm:px-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-muted"><Search size={17} /></span><div><h2 className="text-[14px] font-semibold text-fg">{t("empty.title")}</h2><p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">{t("empty.description")}</p></div></div></div>}

        {profile && !loading && <div ref={resultRef} className="border-t border-line">
          <div className="flex items-center gap-2 bg-good-soft/55 px-4 py-2 text-[12px] font-medium text-good sm:px-5"><Check size={14} />{t("workspace.found")}</div>
          <div className="p-3.5 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                {profile.avatar ? <img src={profile.avatar} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl border border-line object-cover" referrerPolicy="no-referrer" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-iris-soft font-serif text-xl font-semibold text-iris-hi">{profile.username.slice(0, 1).toUpperCase()}</span>}
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-serif text-[22px] font-semibold tracking-tight">{profile.nickname ?? profile.username}</h2>{profile.verified && <Tag tone="iris"><Verified size={12} /> {t("profile.verified")}</Tag>}</div><a href={profile.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-[13px] text-muted hover:text-iris-hi">@{profile.username}</a></div>
              </div>
              {profile.private && <Tag tone="warn">{t("profile.private")}</Tag>}
            </div>
            <div className="mt-3 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line sm:grid-cols-3">{stats.map(([label, count], index) => <div key={label} className={index < 3 ? "bg-iris-soft/45 px-3 py-2.5 sm:px-4" : "bg-panel px-3 py-2.5 sm:px-4"}><div className={index < 3 ? "font-mono text-[18px] font-semibold tabular text-fg" : "font-mono text-[15px] font-semibold tabular"}>{count}</div><div className="mt-0.5 text-[11px] text-faint">{label}</div></div>)}</div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-faint">{profile.created_at && <span>{t("profile.createdAt", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(profile.created_at)) })}</span>}{profile.language && <span>{t("profile.language", { language: profile.language.toUpperCase() })}</span>}{profile.commerce_user && <Tag tone="neutral">{t("profile.commerce")}</Tag>}{profile.tt_seller && <Tag tone="neutral">{t("profile.seller")}</Tag>}</div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2.5"><div className="flex min-w-0 items-center gap-2"><span className="text-[11px] text-faint">{t("profile.numericId")}</span><code className="truncate font-mono text-[12px] tabular text-muted">{profile.id}</code></div><CopyButton text={profile.id} label={t("actions.copy")} copiedLabel={t("actions.copied")} className="shrink-0 rounded-lg bg-iris px-3.5 py-2 text-[12px] font-semibold text-white shadow-card transition-all hover:-translate-y-px hover:brightness-110 hover:text-white active:translate-y-0" /></div>
            {(profile.bio || profile.bio_link) && <div className="mt-5 border-t border-line pt-5"><h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">{t("profile.about")}</h3>{profile.bio && <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-muted">{profile.bio}</p>}{profile.bio_link && <a href={profile.bio_link} target="_blank" rel="noreferrer" className="mt-2 block break-all text-[13px] font-medium text-iris-hi hover:text-iris">{profile.bio_link}</a>}</div>}
            {result.meta.fetched_at && <p className="mt-5 flex items-center gap-1.5 text-[11px] text-faint"><Check size={12} className="text-good" />{t("profile.fetchedAt", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.meta.fetched_at)) })}</p>}
          </div>
        </div>}
      </Card>
    </section>
  </div>;
}
