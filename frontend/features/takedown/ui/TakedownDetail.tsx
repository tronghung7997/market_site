"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/cn";
import { privateImageBase } from "@/lib/media";
import { useMoney } from "@/lib/money";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useWalletBalance } from "@/hooks/use-wallet";
import { Banner, Button, Card, CopyButton, Field, InlineNotice, Skeleton, Textarea, buttonClass } from "@/components/ui";
import { AlertCircle, CheckCircle2, ChevronLeft, ExternalLink, RotateCcw } from "@/components/Icons";
import { canCancel, openableUrl, platformOf, warrantyLeft, type TakedownRequest } from "../model";
import { useTakedownActions, useTakedownRequest } from "../useTakedown";
import { EvidenceShot, PlatformMark, StatusTag, StepTrack, useServiceLabel, useShortTime, useWarrantyLabel } from "./parts";

/** Re-renders every second while `active` — drives the warranty countdown. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function TakedownDetail({ code }: { code: string }) {
  const t = useTranslations("takedown");
  const params = useSearchParams();
  const { account, loading } = useAuth();
  const query = useTakedownRequest(account?.id, code, !loading && Boolean(account));
  const request = query.data;

  const back = (
    <Link href="/takedown/requests" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
      <ChevronLeft size={15} aria-hidden /> {t("detail.back")}
    </Link>
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        {back}
        <Skeleton className="h-[112px] rounded-card" />
        <Skeleton className="h-[240px] rounded-card" />
      </div>
    );
  }
  if (query.isError || !request) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Banner tone="bad" icon={<AlertCircle size={15} aria-hidden />} title={missing ? t("detail.notFound") : t("detail.error")}
          action={missing ? undefined : <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("dashboard.retry")}</Button>} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {back}
      {params.get("sent") === "1" && request.status === "review" && (
        <Banner tone="good" icon={<CheckCircle2 size={15} aria-hidden />}>{t("form.sent", { code: request.code })}</Banner>
      )}
      <HeaderCard request={request} />
      <ProgressCard request={request} />
      {request.evidence.length > 0 && <EvidenceCard request={request} />}
    </div>
  );
}

function HeaderCard({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown");
  const time = useShortTime();
  const warranty = useWarrantyLabel();
  const serviceLabel = useServiceLabel();
  const href = openableUrl(request.url);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-muted">{t("detail.link")}</span>
        <div className="flex flex-wrap items-start gap-3">
          <PlatformMark platform={platformOf(request.url)} className="h-9 w-9" />
          <p className="min-w-0 flex-1 basis-72 break-all font-mono text-[14px] leading-relaxed text-fg">{request.url}</p>
          <div className="flex shrink-0 gap-2">
            <CopyButton text={request.url} label={t("detail.copyLink")} copiedLabel={t("detail.copied")} className={buttonClass({ variant: "secondary", size: "sm" })} />
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                <ExternalLink size={13} aria-hidden /> {t("detail.openLink")}
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 border-t border-line pt-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
          <div><dt className="text-[11px] text-faint">{t("detail.info")}</dt><dd className="font-mono text-fg">{request.code}</dd></div>
          <div><dt className="text-[11px] text-faint">{t("detail.service")}</dt><dd className="text-fg">{serviceLabel(request.service)}</dd></div>
          <div><dt className="text-[11px] text-faint">{t("list.colCreated")}</dt><dd className="font-mono text-fg">{time(request.created_at)}</dd></div>
          <div><dt className="text-[11px] text-faint">{t("list.colWarranty")}</dt><dd className="text-fg">{warranty(request.warranty_hours)}</dd></div>
        </dl>
        <span className="ml-auto"><StatusTag request={request} /></span>
      </div>
      {request.note && (
        <p className="whitespace-pre-line rounded-lg bg-raised/60 px-3 py-2 text-[13px] text-muted"><span className="font-medium text-fg">{t("detail.note")}:</span> {request.note}</p>
      )}
    </Card>
  );
}

function ProgressCard({ request }: { request: TakedownRequest }) {
  const time = useShortTime();
  const subs = [
    time(request.quoted_at ?? request.created_at),
    time(request.accepted_at),
    time(request.processing_at),
    time(request.warranty_until ?? request.completed_at),
    time(request.finished_at),
  ];
  return (
    <Card className="flex flex-col gap-5 p-5">
      <StepTrack request={request} subs={subs} />
      <NowPanel request={request} />
      {canCancel(request) && <CancelRow request={request} />}
    </Card>
  );
}

function Panel({ tone, title, children }: { tone: "neutral" | "warn" | "iris" | "good" | "bad"; title: string; children?: ReactNode }) {
  const t = useTranslations("takedown.detail");
  const tones = {
    neutral: "border-line bg-raised/50",
    warn: "border-warn/30 bg-warn-soft",
    iris: "border-iris/25 bg-iris-soft",
    good: "border-good/25 bg-good-soft",
    bad: "border-bad/25 bg-bad-soft",
  } as const;
  return (
    <section aria-label={t("now")} className={cn("flex flex-col gap-3 rounded-card border p-4 sm:p-5", tones[tone])}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("now")}</span>
      <h2 className="text-[18px] font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function NowPanel({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown.detail");
  const { formatCheckoutMoney } = useMoney();
  const locale = useLocale();
  const time = useShortTime();
  const warranty = useWarrantyLabel();
  const amount = request.price !== null ? formatCheckoutMoney(request.price, { locale }) : "—";
  const body = (text: string) => <p className="text-[14px] text-muted">{text}</p>;

  switch (request.status) {
    case "review": return <Panel tone="neutral" title={t("reviewTitle")}>{body(t("reviewBody"))}</Panel>;
    case "quoted": return <QuotePanel request={request} />;
    case "started": return <Panel tone="iris" title={t("startedTitle")}>{body(t("startedBody", { amount, time: time(request.accepted_at) ?? "" }))}</Panel>;
    case "processing": return <Panel tone="iris" title={t("processingTitle")}>{body(t("processingBody", { time: time(request.processing_at ?? request.accepted_at) ?? "", amount }))}</Panel>;
    case "warranty": return <WarrantyPanel request={request} />;
    case "warranty_claim": return <Panel tone="warn" title={t("warrantyClaimTitle")}>{body(t("warrantyClaimBody"))}</Panel>;
    case "done": return <Panel tone="good" title={t("doneTitle")}>{body(t("doneBody", { warranty: warranty(request.warranty_hours), time: time(request.finished_at) ?? "" }))}</Panel>;
    case "failed": return <Panel tone="bad" title={t("failedTitle")}>{body(t("failedBody", { amount, time: time(request.finished_at) ?? "" }))}</Panel>;
    case "declined": return <Panel tone="neutral" title={t("declinedTitle")}>{body(t("declinedBody"))}</Panel>;
    case "rejected": return <Panel tone="neutral" title={t("rejectedTitle")}>{body(t("rejectedBody"))}</Panel>;
    case "cancelled": return <Panel tone="neutral" title={t("cancelledTitle")}>{body(request.refunded ? t("cancelledRefunded", { amount }) : t("cancelledBody"))}</Panel>;
  }
}

function QuotePanel({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown.detail");
  const { formatCheckoutMoney, formatBrowseMoney } = useMoney();
  const locale = useLocale();
  const errorMessage = useApiErrorMessage();
  const warranty = useWarrantyLabel();
  const { account } = useAuth();
  const wallet = useWalletBalance(Boolean(account));
  const { accept, decline } = useTakedownActions();
  const [error, setError] = useState<string | null>(null);
  const price = request.price ?? 0;
  const balance = wallet.data?.available_balance ?? null;
  const short = balance !== null && balance < price ? price - balance : 0;

  const run = async (action: typeof accept) => {
    setError(null);
    try { await action.mutateAsync(request.code); } catch (err) { setError(errorMessage(err, t("actionFailed"))); }
  };

  return (
    <Panel tone="warn" title={t("quotedTitle")}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
          <span className="font-mono text-[34px] font-semibold leading-none tabular text-fg">{formatCheckoutMoney(price, { locale })}</span>
          <span className="text-[13px] text-muted">{t("quotedIncludes", { warranty: warranty(request.warranty_hours) })}</span>
          <span className="text-[13px] text-muted">
            {balance === null ? <Skeleton className="inline-block h-4 w-32 align-middle" /> : t("balance", { amount: formatBrowseMoney(balance, { locale }) })}
          </span>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[260px]">
          {short > 0 ? (
            <>
              <InlineNotice tone="bad" icon={<AlertCircle size={13} aria-hidden />}>{t("balanceShort", { amount: formatCheckoutMoney(short, { locale }) })}</InlineNotice>
              <Link href="/wallet" className={buttonClass({ size: "lg", block: true })}>{t("topUp")}</Link>
            </>
          ) : (
            <>
              <Button size="lg" block loading={accept.isPending} disabled={decline.isPending} onClick={() => void run(accept)}>{t("accept")}</Button>
              <span className="text-center text-[12px] text-muted">{t("acceptHint", { amount: formatCheckoutMoney(price, { locale }) })}</span>
            </>
          )}
          <Button variant="secondary" size="lg" block loading={decline.isPending} disabled={accept.isPending} onClick={() => void run(decline)}>{t("reject")}</Button>
          <span className="text-center text-[12px] text-muted">{t("rejectHint")}</span>
        </div>
      </div>
      {error && <InlineNotice tone="bad" icon={<AlertCircle size={13} aria-hidden />}>{error}</InlineNotice>}
    </Panel>
  );
}

function WarrantyPanel({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown.detail");
  const time = useShortTime();
  const errorMessage = useApiErrorMessage();
  const now = useNow(true);
  const left = warrantyLeft(request, now);
  const { warranty } = useTakedownActions();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pad = (n: number) => String(n).padStart(2, "0");

  const submit = async () => {
    setError(null);
    if (!note.trim()) return;
    try {
      await warranty.mutateAsync({ code: request.code, note: note.trim() });
      setOpen(false);
      setNote("");
    } catch (err) {
      setError(errorMessage(err, t("actionFailed")));
    }
  };

  return (
    <Panel tone="good" title={t("warrantyTitle")}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <p className="min-w-0 flex-1 basis-64 text-[14px] text-muted">{t("warrantyBody", { time: time(request.completed_at) ?? "" })}</p>
        {left && (
          <div className="flex flex-col items-start gap-0.5 sm:items-end">
            <span className="text-[12px] text-muted">{t("warrantyLeft")}</span>
            <span className="font-mono text-[26px] font-semibold leading-none tabular text-fg" role="timer">
              {pad(left.hours)}:{pad(left.minutes)}:{pad(left.seconds)}
            </span>
          </div>
        )}
        {!open && (
          <Button variant="secondary" size="lg" onClick={() => setOpen(true)}>
            <RotateCcw size={15} aria-hidden /> {t("reportBack")}
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <Field label={t("claimLabel")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} placeholder={t("claimPlaceholder")} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button loading={warranty.isPending} disabled={!note.trim()} onClick={() => void submit()}>{t("claimSubmit")}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("back")}</Button>
          </div>
        </div>
      )}
      {error && <InlineNotice tone="bad" icon={<AlertCircle size={13} aria-hidden />}>{error}</InlineNotice>}
    </Panel>
  );
}

function CancelRow({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown.detail");
  const errorMessage = useApiErrorMessage();
  const { cancel } = useTakedownActions();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <span className="min-w-0 flex-1 basis-64 text-[12.5px] text-muted">{t("cancelHint")}</span>
      <Button variant="ghost" loading={cancel.isPending}
        onClick={async () => { setError(null); try { await cancel.mutateAsync(request.code); } catch (err) { setError(errorMessage(err, t("actionFailed"))); } }}>
        {t("cancel")}
      </Button>
      {error && <InlineNotice tone="bad" icon={<AlertCircle size={13} aria-hidden />} className="w-full">{error}</InlineNotice>}
    </div>
  );
}

function EvidenceCard({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown.detail");
  const base = privateImageBase.takedown(request.code);
  const shots = request.evidence.map((kind) => ({
    key: kind, label: t(kind === "live" ? "evidenceLive" : "evidenceDead"), url: `${base}/${kind}`,
  }));
  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-[16px] font-semibold text-fg">{t("evidence")}</h2>
      {shots.length === 0 ? (
        <p className="text-[13px] text-muted">{t("evidenceEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {shots.map((shot) => (
            <li key={shot.key} className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-fg">{shot.label}</span>
              <EvidenceShot url={shot.url} label={shot.label} brokenLabel={t("evidenceBroken")} className="max-h-[420px]" />
              <a href={shot.url} target="_blank" rel="noopener" className="text-[12.5px] font-medium text-iris hover:text-iris-hi">{t("evidenceOpen")}</a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
