"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, Spinner, Switch } from "@/components/ui";
import { CheckCircle2 } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";

/** Card with a section title; rows go inside. */
export function SettingsSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-card border border-line bg-card shadow-card", className)}>
      <div className="border-b border-line bg-raised/40 px-5 py-3">
        <h2 className="text-[13.5px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * One labelled knob. Default: explanation in a fixed left column, control
 * right next to it (no wide-screen gap). `stacked`: explanation on top and a
 * full-width control below — for text people actually have to write.
 */
export function SettingsRow({ title, hint, label, stacked = false, children }: {
  title: string; hint: string; label?: string; stacked?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={cn(
      "grid gap-3 border-b border-line px-5 py-4 last:border-b-0",
      // Label takes a third, control two thirds — the row fills whatever width the screen has.
      stacked
        ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:items-start xl:gap-x-10"
        : "md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-start md:gap-x-10",
    )}>
      <div className="max-w-[560px]">
        <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{hint}</p>
      </div>
      {/* A div, not a label: rows often hold several inputs (VI/EN, per-category tables). */}
      <div className={cn("block", !stacked && "max-w-[640px]")}>
        {label && <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>}
        {children}
      </div>
    </div>
  );
}

/** Switch + caption. `danger` colours the caption red while on (kill-switches, maintenance). */
export function SettingsToggle({ checked, onChange, label, disabled = false, danger = false }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; danger?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-3 text-[13px]", disabled && "opacity-50", checked ? (danger ? "font-semibold text-bad" : "font-medium text-fg") : "text-muted")}>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} className={cn(checked && danger && "border-bad bg-bad")} />
      {label}
    </span>
  );
}

export function SettingsLoading() {
  return <div className="grid place-items-center py-16"><Spinner /></div>;
}

export function SettingsLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations("adminSettingsCommon");
  return (
    <section className="rounded-card border border-line bg-card p-4 shadow-card text-[12.5px] text-bad">
      {message}
      <Button size="sm" variant="secondary" onClick={onRetry} className="ml-3">{t("retry")}</Button>
    </section>
  );
}

/**
 * Save bar that sticks to the bottom of the viewport while the panel is on
 * screen. Turns amber the moment something changes so nobody wonders whether
 * a toggle already applied; the result of Save is announced by a toast.
 */
export function SettingsFooter({
  updatedAt, dirty, valid, saving, onReset, onSave, problems = [], extra,
}: {
  /** Last-saved time; `undefined` when the config has no timestamp, `null` for "still on defaults". */
  updatedAt?: string | null;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  onReset: () => void;
  onSave: () => void;
  /** Concrete reasons the draft cannot be saved yet. */
  problems?: string[];
  /** Secondary action shown under the status (e.g. "reset to server defaults"). */
  extra?: React.ReactNode;
}) {
  const t = useTranslations("adminSettingsCommon");
  const locale = useLocale();
  const invalid = !valid || problems.length > 0;
  return (
    <div className={cn(
      "sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-card border px-4 py-3 shadow-card-lg backdrop-blur-md transition-colors",
      dirty ? "border-warn/40 bg-warn-soft/95" : "border-line bg-card/95",
    )}>
      <div className="min-w-0 space-y-1">
        {dirty ? (
          <span className="flex items-center gap-2 text-[13px] font-medium text-warn" role="status">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-warn" aria-hidden />
            {invalid ? t("unsavedInvalid") : t("unsaved")}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <CheckCircle2 size={14} className="shrink-0 text-good" />
            {updatedAt === undefined ? t("allSavedNoTime") : updatedAt ? t("allSaved", { at: formatDateTime(updatedAt, locale) }) : t("neverUpdated")}
          </span>
        )}
        {dirty && problems.map((p) => <p key={p} className="text-[12px] text-bad">{p}</p>)}
        {!dirty && extra && <div className="text-[12px]">{extra}</div>}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={onReset}>{t("reset")}</Button>
        <Button size="sm" disabled={!dirty || invalid || saving} onClick={onSave} className="min-w-[120px]">
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
