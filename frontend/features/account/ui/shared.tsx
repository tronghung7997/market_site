"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";

export function Panel({ title, hint, children, aside, className }: { title: string; hint?: string; children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-card border border-line bg-card shadow-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
          {hint && <p className="mt-0.5 max-w-[64ch] text-[12.5px] leading-relaxed text-muted">{hint}</p>}
        </div>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Label left, control right — the same rhythm as admin settings, storefront copy. */
export function Row({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[180px_1fr] sm:items-start sm:gap-5">
      <span className="pt-2 text-[13px] font-medium text-fg">{label}</span>
      <div className="min-w-0 max-w-[520px]">
        {children}
        {error ? <p className="mt-1 text-[12px] text-bad" role="alert">{error}</p> : hint ? <p className="mt-1 text-[12px] text-faint">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Two-to-three way segmented control (language, currency). */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <span className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", value === o.value ? "bg-iris text-white" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Save bar under a form: quiet when clean, amber when dirty, red when invalid. */
export function SaveBar({ dirty, valid, saving, problem, onSave, onReset }: {
  dirty: boolean; valid: boolean; saving: boolean; problem?: string; onSave: () => void; onReset: () => void;
}) {
  const t = useTranslations("account");
  return (
    <div className={cn("mt-5 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5", dirty ? "border-warn/40 bg-warn-soft" : "border-line bg-surface")}>
      <span className="min-w-0 flex-1 text-[12.5px]">
        {dirty && !valid ? <span className="text-bad">{problem}</span> : dirty ? <span className="font-medium text-fg">{t("unsaved")}</span> : <span className="text-muted">{t("noChanges")}</span>}
      </span>
      {dirty && <Button size="sm" variant="ghost" onClick={onReset} disabled={saving}>{t("undo")}</Button>}
      <Button size="sm" onClick={onSave} disabled={!dirty || !valid || saving}>{saving ? t("saving") : t("save")}</Button>
    </div>
  );
}

/** "Chrome · macOS" from a user agent, or the raw string when unsure. */
export function describeDevice(ua: string | null | undefined, unknown: string): string {
  if (!ua) return unknown;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : null;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  if (!browser && !os) return ua.length > 48 ? ua.slice(0, 48) + "…" : ua;
  return [browser, os].filter(Boolean).join(" · ");
}

/** "5 minutes ago" in the viewer's language. */
export function relativeTime(iso: string | null | undefined, locale: string, never: string): string {
  if (!iso) return never;
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale === "vi" ? "vi" : "en", { numeric: "auto" });
  if (abs < 60_000) return rtf.format(0, "minute");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return new Date(iso).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US");
}
