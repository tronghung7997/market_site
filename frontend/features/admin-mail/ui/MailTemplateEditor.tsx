"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { MailTemplatePreview, MailTemplateRow } from "@/lib/types";
import { Button, Input, Select, Tag, Textarea } from "@/components/ui";

export function MailTemplateEditor() {
  const t = useTranslations("adminMail");
  const apiErrorMessage = useApiErrorMessage();
  const [items, setItems] = useState<MailTemplateRow[]>([]);
  const [template, setTemplate] = useState("password_reset");
  const [locale, setLocale] = useState<"vi" | "en">("vi");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<MailTemplatePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const current = useMemo(
    () => items.find((row) => row.template === template && row.locale === locale) ?? null,
    [items, template, locale],
  );

  const names = useMemo(
    () => Array.from(new Set(items.map((row) => row.template))),
    [items],
  );

  const applyRow = (row: MailTemplateRow | null) => {
    setSubject(row?.subject ?? "");
    setBody(row?.body ?? "");
    setPreview(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await api.adminMailTemplates();
      setItems(data.items);
    } catch (e) {
      setErr(apiErrorMessage(e, t("tplLoadFail")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    applyRow(current);
  }, [current]);

  const dirty = Boolean(current) && (subject !== current?.subject || body !== current?.body);

  const save = async () => {
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const next = await api.adminUpdateMailTemplate({ template, locale, subject, body });
      setItems((rows) => rows.map((row) => (
        row.template === next.template && row.locale === next.locale ? next : row
      )));
      setMsg(t("tplSaved"));
    } catch (e) {
      setErr(apiErrorMessage(e, t("tplSaveFail")));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm(t("tplResetConfirm"))) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const next = await api.adminResetMailTemplate(template, locale);
      setItems((rows) => rows.map((row) => (
        row.template === next.template && row.locale === next.locale ? next : row
      )));
      setMsg(t("tplResetDone"));
    } catch (e) {
      setErr(apiErrorMessage(e, t("tplResetFail")));
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setErr("");
    try {
      const next = await api.adminPreviewMailTemplate({ template, locale, subject, body });
      setPreview(next);
    } catch (e) {
      setErr(apiErrorMessage(e, t("tplPreviewFail")));
    }
  };

  if (loading && items.length === 0) {
    return null;
  }

  return (
    <section className="rounded-card border border-line bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("tplTitle")}</h2>
          <p className="mt-0.5 max-w-2xl text-[12px] leading-snug text-muted">{t("tplHint")}</p>
        </div>
        {current?.customized && <Tag tone="iris">{t("tplCustom")}</Tag>}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-[12px] text-muted">
          {t("tplSelect")}
          <Select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="mt-1 h-9"
          >
            {names.map((name) => (
              <option key={name} value={name}>{t(`tplNames.${name}`)}</option>
            ))}
          </Select>
        </label>
        <div className="flex gap-1" role="group" aria-label={t("tplLocale")}>
          {(["vi", "en"] as const).map((code) => (
            <Button
              key={code}
              type="button"
              size="sm"
              variant={locale === code ? "primary" : "ghost"}
              aria-pressed={locale === code}
              onClick={() => setLocale(code)}
            >
              {code.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {current && (
        <p className="mt-2 text-[11px] text-muted">
          {t("tplPlaceholders")}: {current.placeholders.map((key) => `{${key}}`).join(" ")}
        </p>
      )}

      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-muted">
        {t("tplSubject")}
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 h-9" />
      </label>
      <label className="mt-2.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">
        {t("tplBody")}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 min-h-[10rem] font-mono text-[13px]" />
      </label>

      {(msg || err) && (
        <div className="mt-2 space-y-1">
          {msg && (
            <p className="rounded-md border border-good/25 bg-good-soft px-2.5 py-1.5 text-[12px] text-good" role="status">
              {msg}
            </p>
          )}
          {err && (
            <p className="rounded-md border border-bad/25 bg-bad-soft px-2.5 py-1.5 text-[12px] text-bad" role="alert">
              {err}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => void runPreview()} disabled={!subject.trim() || !body.trim()}>
          {t("tplPreview")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void reset()} disabled={saving || !current}>
          {t("tplReset")}
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? t("saving") : t("tplSave")}
        </Button>
      </div>

      {preview && (
        <div className="mt-3 rounded-md border border-line bg-surface px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t("tplPreviewTitle")}</p>
          <p className="mt-1 text-[13px] font-medium text-fg">{preview.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-fg">{preview.body}</pre>
        </div>
      )}
    </section>
  );
}
