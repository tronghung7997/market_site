"use client";

import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { facebookIdLink, normalizeFacebookTarget } from "@/lib/facebook-lookup";
import type { FacebookEntityType, FacebookLookupResponse } from "@/lib/types";
import { Banner, Button, Card, CopyButton, Input, Tag } from "@/components/ui";
import { ArrowRight, Check, Clock, ExternalLink, Flag, Globe, RotateCcw, Search, User, Users, X } from "@/components/Icons";
import { entityFacts, type RecentLookup } from "../model";
import { failureStatus, useFacebookLookup } from "../useFacebookLookup";

const EXAMPLES = [
  { key: "exampleProfile", value: "https://www.facebook.com/zuck" },
  { key: "examplePage", value: "https://www.facebook.com/meta" },
  { key: "exampleGroup", value: "https://www.facebook.com/groups/tuyendungit" },
] as const;

const TYPE_ICON: Record<FacebookEntityType, typeof User> = { Profile: User, Page: Flag, Group: Users, Event: Clock, Unknown: Globe };

function TypeTag({ type }: { type: FacebookEntityType }) {
  const t = useTranslations("facebookLookup");
  const Icon = TYPE_ICON[type];
  return <Tag tone="iris"><Icon size={11} /> {t(`result.type.${type}`)}</Tag>;
}

function ResultSkeleton() {
  return (
    <div className="space-y-4 border-t border-line p-4 sm:p-5" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 animate-pulse rounded-xl bg-raised" />
        <div className="flex-1 space-y-2"><div className="h-4 w-40 animate-pulse rounded bg-raised" /><div className="h-3 w-24 animate-pulse rounded bg-raised" /></div>
      </div>
      <div className="rounded-xl border border-line p-4"><div className="h-3 w-20 animate-pulse rounded bg-raised" /><div className="mt-3 h-8 w-60 animate-pulse rounded bg-raised" /><div className="mt-3 flex gap-2"><div className="h-8 w-28 animate-pulse rounded-lg bg-raised" /><div className="h-8 w-36 animate-pulse rounded-lg bg-raised" /></div></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-raised" />)}</div>
    </div>
  );
}

function RecentChip({ item, onPick }: { item: RecentLookup; onPick: (input: string) => void }) {
  const Icon = TYPE_ICON[item.type] ?? Globe;
  return (
    <button type="button" onClick={() => onPick(item.input)} title={item.input} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-iris/40 hover:text-fg">
      <Icon size={11} className="shrink-0 text-faint" />
      <span className="truncate">{item.name ?? item.id}</span>
    </button>
  );
}

function Result({ result }: { result: FacebookLookupResponse }) {
  const t = useTranslations("facebookLookup");
  const locale = useLocale();
  const { entity, meta } = result;
  const facts = entityFacts(entity, locale);
  const permanent = facebookIdLink(entity.id, entity.type);
  const partial = meta.data_status === "partial";
  const initial = (entity.name ?? entity.username ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="border-t border-line">
      <div className="flex items-center gap-2 bg-good-soft/55 px-4 py-2 text-[12px] font-medium text-good sm:px-5"><Check size={14} />{t("workspace.found")}</div>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          {entity.avatar
            ? <img src={entity.avatar} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-xl border border-line object-cover" referrerPolicy="no-referrer" />
            : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-iris-soft font-serif text-2xl font-semibold text-iris-hi">{initial}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate font-serif text-[22px] font-semibold tracking-tight">{entity.name ?? entity.username ?? entity.id}</h2>
              <TypeTag type={entity.type} />
              <Tag tone={partial ? "warn" : "good"}>{partial ? t("result.dataPartial") : t("result.dataFull")}</Tag>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              {entity.username
                ? <a href={entity.url} target="_blank" rel="noreferrer" className="text-muted hover:text-iris-hi">@{entity.username}</a>
                : <span className="text-faint">{t("result.noUsername")}</span>}
              <a href={entity.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-iris-hi hover:text-iris"><ExternalLink size={12} />{t("actions.open")}</a>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-iris/25 bg-iris-soft/40 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iris-hi">{t("result.idLabel")}</div>
          <div className="mt-1 break-all font-mono text-[26px] font-semibold leading-tight tabular text-fg sm:text-[30px]">{entity.id}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CopyButton text={entity.id} label={t("actions.copyId")} copiedLabel={t("actions.copied")} className="rounded-lg bg-iris px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-card transition-all hover:-translate-y-px hover:brightness-110 hover:text-white active:translate-y-0" />
            <CopyButton text={permanent} label={t("actions.copyLink")} copiedLabel={t("actions.copied")} className="rounded-lg border border-line-2 bg-surface px-3.5 py-2 text-[12.5px] font-medium text-fg hover:border-iris/40 hover:text-iris-hi" />
          </div>
          <div className="mt-2.5 flex min-w-0 items-center gap-2 text-[11.5px] text-faint">
            <span className="shrink-0">{t("result.permanentLink")}</span>
            <a href={permanent} target="_blank" rel="noreferrer" className="truncate font-mono text-muted hover:text-iris-hi">{permanent.replace(/^https:\/\/www\./, "")}</a>
          </div>
        </div>

        {facts.length > 0 && (
          <div className={cn("grid grid-cols-2 divide-x divide-line overflow-hidden rounded-xl border border-line", facts.length >= 3 && "sm:grid-cols-3", facts.length === 4 && "sm:grid-cols-4")}>
            {facts.map((f) => (
              <div key={f.key} className="bg-panel px-3 py-2.5 sm:px-4">
                <div className="font-mono text-[16px] font-semibold tabular">{f.value}</div>
                <div className="mt-0.5 text-[11px] text-faint">{t(`result.${f.key}`)}</div>
              </div>
            ))}
          </div>
        )}

        {entity.description && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{t("result.about")}</h3>
            <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-muted">{entity.description}</p>
          </div>
        )}

        {partial && <Banner tone="warn">{t("result.partialNote")}</Banner>}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[11.5px] text-faint">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="truncate">{t("result.queried", { handle: result.query.handle })}</span>
            <span className="inline-flex items-center gap-1"><Check size={11} className="text-good" />{t("result.fetchedAt", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(meta.fetched_at)) })}</span>
            {meta.cached && <Tag tone="neutral">{t("result.cached")}</Tag>}
          </div>
          <CopyButton text={typeof window === "undefined" ? "" : window.location.href} label={t("actions.copyShare")} copiedLabel={t("actions.copied")} />
        </div>
      </div>
    </div>
  );
}

export function FacebookLookupPage() {
  const t = useTranslations("facebookLookup");
  const apiErrorMessage = useApiErrorMessage();
  const { value, setValue, target, result, failure, loading, recent, lookup, cancel, reset, clearRecent } = useFacebookLookup();
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [result]);

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void lookup(); };
  // Pasting a recognisable link is the whole job — run it straight away.
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (normalizeFacebookTarget(text)) { event.preventDefault(); void lookup(text); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); reset(); }
  };

  const status = failureStatus(failure);
  const failureMessage = failure?.code === "empty" ? t("errors.empty")
    : failure?.code === "invalid" ? t("errors.invalid")
      : failure ? apiErrorMessage(failure.cause, t("errors.generic")) : null;
  const supports = ["profile", "page", "group", "post", "numeric", "short"] as const;
  const showPreview = value.trim().length > 0 && !loading;

  return (
    <div className="bg-surface">
      <section className="mx-auto grid max-w-[1120px] gap-6 px-6 py-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(500px,1.28fr)] lg:items-start lg:py-8">
        <div>
          <Link href="/solutions" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-iris-hi">{t("back")} <ArrowRight size={14} /></Link>
          <div className="mb-2 inline-flex items-center gap-2 text-[12px] font-medium text-iris-hi"><span className="grid h-6 w-6 place-items-center rounded-md bg-iris-soft"><Search size={13} /></span>{t("eyebrow")}</div>
          <h1 className="max-w-md font-serif text-[clamp(2.1rem,3.6vw,3.15rem)] leading-[1.06] tracking-tight">{t("title")}</h1>
          <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-muted">{t("subtitle")}</p>

          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{t("supports.title")}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {supports.map((k) => <Tag key={k} tone="neutral" className="px-2 py-1 text-[11.5px]">{t(`supports.${k}`)}</Tag>)}
            </div>
          </div>

          <ol className="mt-5 space-y-2.5 border-l border-iris/30 pl-4">
            {(["one", "two", "three"] as const).map((k, i) => (
              <li key={k} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-iris-soft font-mono text-[11px] font-semibold text-iris-hi">{i + 1}</span>
                {t(`steps.${k}`)}
              </li>
            ))}
          </ol>
        </div>

        <Card className="overflow-hidden border-line-2 p-0 shadow-card-lg">
          <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-2 sm:px-5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">{t("workspace.title")}</span>
            {result
              ? <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-good"><Check size={13} />{t("workspace.ready")}</span>
              : <span className="text-[12px] text-faint">Facebook</span>}
          </div>

          <form className="px-4 py-3.5 sm:px-5" onSubmit={submit} noValidate>
            <label htmlFor="facebook-target" className="mb-1.5 block text-[13px] font-medium text-fg">{t("input.label")}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <Input id="facebook-target" value={value} onChange={(e) => setValue(e.target.value)} onPaste={onPaste} onKeyDown={onKeyDown} placeholder={t("input.placeholder")} autoComplete="off" spellCheck="false" inputMode="url" className="h-11 pl-9 pr-9" aria-invalid={failure?.code === "invalid" || undefined} />
                {value && <button type="button" onClick={reset} aria-label={t("input.clear")} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg"><X size={13} /></button>}
              </div>
              {loading
                // Distinct keys: if React reused the node, the click that cancels
                // would land on a button that has already turned into "submit".
                ? <Button key="cancel" size="md" type="button" variant="secondary" onClick={(e) => { e.preventDefault(); cancel(); }} className="h-11 px-5">{t("actions.cancel")}</Button>
                : <Button key="submit" size="md" type="submit" className="h-11 px-5">{t("actions.submit")}</Button>}
            </div>

            <div className="mt-1.5 min-h-[18px] text-[12px] leading-relaxed" aria-live="polite">
              {showPreview
                ? target
                  ? <span className="inline-flex max-w-full items-center gap-1.5 text-muted"><span className="shrink-0 text-faint">{t("preview.willLookup")}</span><Tag tone="iris">{t(`preview.kind.${target.kind}`)}</Tag><span className="truncate font-mono text-fg">{target.url.replace(/^https:\/\/www\./, "")}</span></span>
                  : <span className="text-warn">{t("preview.invalid")}</span>
                : <span className="text-faint">{t("input.hint")}</span>}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[12px]">
              <span className="text-faint">{t("actions.examples")}</span>
              {EXAMPLES.map((ex) => (
                <button key={ex.key} type="button" onClick={() => void lookup(ex.value)} className="rounded-full border border-iris/25 bg-iris-soft/40 px-2.5 py-1 font-medium text-iris-hi transition-colors hover:bg-iris-soft">{t(`actions.${ex.key}`)}</button>
              ))}
            </div>
            {recent.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="inline-flex items-center gap-1 text-faint"><RotateCcw size={11} />{t("recent.title")}</span>
                {recent.map((item) => <RecentChip key={item.id} item={item} onPick={(input) => void lookup(input)} />)}
                <button type="button" onClick={clearRecent} className="text-faint hover:text-fg">{t("recent.clear")}</button>
              </div>
            )}
          </form>

          {loading && <ResultSkeleton />}

          {!loading && failureMessage && (
            <div className="border-t border-line p-4 sm:px-5">
              <Banner tone="bad" title={t("errors.title")} action={failure?.code === "api" && status !== 400 ? <Button size="sm" variant="secondary" onClick={() => void lookup()}><RotateCcw size={13} />{t("actions.retry")}</Button> : undefined}>
                <p>{failureMessage}</p>
                {status === 404 && <p className="text-[12px] opacity-90">{t("errors.notFoundHint")}</p>}
              </Banner>
            </div>
          )}

          {!loading && !failureMessage && !result && (
            <div className="border-t border-line px-4 py-5 sm:px-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-muted"><Search size={17} /></span>
                <div><h2 className="text-[14px] font-semibold text-fg">{t("empty.title")}</h2><p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">{t("empty.description")}</p></div>
              </div>
            </div>
          )}

          {result && !loading && <div ref={resultRef}><Result result={result} /></div>}
        </Card>
      </section>
    </div>
  );
}
