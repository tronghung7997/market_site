"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui";
import { AlertCircle, Check, CheckCircle2, Clock, Activity, LinkIcon, X } from "@/components/Icons";
import {
  STEPS, platformOf, shortLink, statusView, stepStates,
  type Platform, type StepState, type TakedownRequest, type TakedownService, type TakedownWarrantyHours, type Tone,
} from "../model";

type StepInput = Pick<TakedownRequest, "status" | "accepted_at" | "completed_at">;

const TONE_ICON: Record<Tone, typeof Clock> = {
  iris: Activity, warn: AlertCircle, good: CheckCircle2, bad: X, neutral: Clock,
};

/** Status label + icon in the global tone semantics (meaning never by colour alone). */
export function StatusTag({ request, label, className }: {
  request: Pick<TakedownRequest, "status">;
  /** Override for another audience (the admin console words states from our side). */
  label?: (key: string) => string;
  className?: string;
}) {
  const t = useTranslations("takedown.status");
  const { key, tone } = statusView(request);
  const Icon = TONE_ICON[tone];
  return (
    <Tag tone={tone} className={cn("whitespace-nowrap py-1 text-[12px]", className)}>
      <Icon size={12} aria-hidden /> {label ? label(key) : t(key)}
    </Tag>
  );
}

const SEG: Record<StepState, string> = {
  done: "bg-fg",
  current: "bg-iris",
  waiting_you: "bg-warn",
  failed: "bg-bad",
  todo: "bg-line-2",
  closed: "bg-line",
};

/** Five-segment progress for list rows. The accessible name spells out the step. */
export function StepBar({ request, className }: { request: StepInput; className?: string }) {
  const t = useTranslations("takedown.steps");
  const states = stepStates(request);
  const at = Math.max(0, states.findIndex((s) => s !== "done"));
  const reached = states.every((s) => s === "done") ? STEPS.length - 1 : at;
  return (
    <span
      role="img"
      aria-label={`${t("label")}: ${reached + 1}/${STEPS.length} · ${t(STEPS[reached])}`}
      className={cn("flex w-full gap-[3px]", className)}
    >
      {states.map((s, i) => <span key={STEPS[i]} className={cn("h-1.5 flex-1 rounded-sm", SEG[s])} />)}
    </span>
  );
}

const NODE: Record<StepState, string> = {
  done: "bg-fg text-surface",
  current: "bg-iris text-white ring-4 ring-iris-soft",
  waiting_you: "bg-warn text-white ring-4 ring-warn-soft",
  failed: "bg-bad text-white",
  todo: "bg-surface text-faint border border-line-2",
  closed: "bg-raised text-faint",
};

/** Large five-step tracker for the request page. `subs` adds a line under each step (times, notes). */
export function StepTrack({ request, subs }: { request: StepInput; subs: (string | null)[] }) {
  const t = useTranslations("takedown.steps");
  const states = stepStates(request);
  return (
    <ol aria-label={t("label")} className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-0">
      {STEPS.map((step, i) => {
        const s = states[i];
        const active = s === "current" || s === "waiting_you";
        return (
          <li key={step} aria-current={active ? "step" : undefined} className="flex items-start gap-3 sm:flex-col sm:gap-2 sm:pr-3">
            <div className="flex items-center sm:w-full">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-[13px] font-semibold", NODE[s])}>
                {s === "done" ? <Check size={15} aria-hidden /> : s === "failed" ? <X size={15} aria-hidden /> : s === "waiting_you" ? "!" : i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span aria-hidden className={cn("ml-2 hidden h-0.5 flex-1 rounded sm:block", s === "done" ? "bg-fg" : "bg-line-2")} />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 pt-1 sm:pt-0">
              <span className={cn("text-[14px] font-semibold", s === "todo" || s === "closed" ? "text-faint" : "text-fg")}>{t(step)}</span>
              {subs[i] && <span className="font-mono text-[11.5px] tabular text-faint">{subs[i]}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const PLATFORM_MARK: Record<Platform, string> = { tiktok: "TT", facebook: "FB", instagram: "IG", youtube: "YT" };

/** Platform monogram when the link is recognised; a neutral link glyph otherwise. */
export function PlatformMark({ platform, className }: { platform: Platform | null; className?: string }) {
  const t = useTranslations("takedown.platform");
  const label = platform ? t(platform) : t("other");
  return (
    <span
      title={label}
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg font-mono text-[10px] font-semibold",
        platform ? "bg-ink-panel text-surface" : "bg-raised text-muted",
        className,
      )}
    >
      {platform ? <span aria-hidden>{PLATFORM_MARK[platform]}</span> : <LinkIcon size={14} aria-hidden />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Platform mark + the link on one clipped line (full link in the tooltip) + code below. */
export function LinkCell({ request, showCode = true }: { request: Pick<TakedownRequest, "url" | "code">; showCode?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <PlatformMark platform={platformOf(request.url)} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span title={request.url} className="truncate font-mono text-[13px] font-medium text-fg">{shortLink(request.url)}</span>
        {showCode && <span className="font-mono text-[11.5px] text-faint">{request.code}</span>}
      </span>
    </span>
  );
}

export function useWarrantyLabel() {
  const t = useTranslations("takedown.warranty");
  return (hours: TakedownWarrantyHours) => t(`h${hours}`);
}

export function useServiceLabel() {
  const t = useTranslations("takedown.service");
  return (service: TakedownService) => t(service);
}

/** Short absolute time in the viewer's time zone: "09/10 14:20" (day/month, 24 h). */
export function useShortTime() {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
}

/** One partner screenshot served by our backend; a failed load shows a line instead of a broken image. */
export function EvidenceShot({ url, label, brokenLabel, className }: { url: string; label: string; brokenLabel: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-line-2 bg-raised px-4 text-center text-[12.5px] text-muted">{brokenLabel}</div>;
  }
  return (
    <a href={url} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg border border-line bg-raised">
      <img src={url} alt={label} loading="lazy" onError={() => setBroken(true)} className={cn("w-full object-contain", className)} />
    </a>
  );
}
