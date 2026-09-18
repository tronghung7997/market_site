"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

/** One labelled knob: explanation on the left, control on the right. */
export function SettingsRow({ title, hint, label, children }: { title: string; hint: string; label?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 border-b border-line p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_260px] md:items-start">
      <div>
        <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</p>
      </div>
      <label className="block">
        {label && <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>}
        {children}
      </label>
    </div>
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

/** Footer with "updated at", status message and Reset / Save buttons. */
export function SettingsFooter({
  updatedAt, message, dirty, valid, saving, onReset, onSave,
}: {
  updatedAt: string | null;
  message: { tone: "good" | "bad"; text: string } | null;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  onReset: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("adminSettingsCommon");
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-raised/40 px-4 py-3">
      <span className="text-[11.5px] text-faint">
        {updatedAt ? t("updatedAt", { at: formatDateTime(updatedAt, locale) }) : t("neverUpdated")}
        {message && <span className={message.tone === "good" ? "ml-3 text-good" : "ml-3 text-bad"} role="status">{message.text}</span>}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={onReset}>{t("reset")}</Button>
        <Button size="sm" disabled={!dirty || !valid || saving} onClick={onSave}>{saving ? t("saving") : t("save")}</Button>
      </div>
    </div>
  );
}
