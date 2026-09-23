"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { MailTemplatePreview, MailTemplateRow } from "@/lib/types";
import { Button, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { AlertCircle, CheckCircle2 } from "@/components/Icons";
import { cn } from "@/lib/cn";

// Grouping is presentational only; ids must match KNOWN_TEMPLATES on the backend.
const TEMPLATE_GROUPS: ReadonlyArray<{ id: string; templates: readonly string[] }> = [
  { id: "account", templates: ["password_reset", "password_changed"] },
  { id: "seller", templates: ["seller_application_approved", "seller_application_rejected", "provider_approved", "provider_rejected"] },
  { id: "wallet", templates: ["withdrawal_approved", "withdrawal_rejected"] },
  { id: "dispute", templates: ["dispute_opened", "dispute_resolved"] },
  { id: "other", templates: ["ops_incident", "admin_test"] },
];

const LOCALES = ["vi", "en"] as const;
const BODY_ID = "mail-template-body";
type TplLocale = (typeof LOCALES)[number];

export function MailTemplateEditor() {
  const t = useTranslations("adminMail");
  const apiErrorMessage = useApiErrorMessage();
  const [items, setItems] = useState<MailTemplateRow[]>([]);
  const [template, setTemplate] = useState("password_reset");
  const [locale, setLocale] = useState<TplLocale>("vi");
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

  const known = useMemo(() => new Set(items.map((row) => row.template)), [items]);
  const customizedByTemplate = useMemo(() => {
    const map = new Map<string, TplLocale[]>();
    for (const row of items) {
      if (!row.customized) continue;
      const list = map.get(row.template) ?? [];
      list.push(row.locale as TplLocale);
      map.set(row.template, list);
    }
    return map;
  }, [items]);

  const groups = useMemo(() => {
    const listed = new Set<string>();
    const out = TEMPLATE_GROUPS.map((group) => ({
      id: group.id,
      templates: group.templates.filter((name) => {
        if (!known.has(name)) return false;
        listed.add(name);
        return true;
      }),
    })).filter((group) => group.templates.length > 0);
    const rest = Array.from(known).filter((name) => !listed.has(name));
    if (rest.length > 0) {
      const other = out.find((group) => group.id === "other");
      if (other) other.templates = [...other.templates, ...rest];
      else out.push({ id: "other", templates: rest });
    }
    return out;
  }, [known]);

  const applyRow = (row: MailTemplateRow | null) => {
    setSubject(row?.subject ?? "");
    setBody(row?.body ?? "");
    setPreview(null);
    setMsg("");
    setErr("");
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
  }, [apiErrorMessage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    applyRow(current);
  }, [current]);

  const dirty = Boolean(current) && (subject !== current?.subject || body !== current?.body);

  const replaceRow = (next: MailTemplateRow) => {
    setItems((rows) => rows.map((row) => (
      row.template === next.template && row.locale === next.locale ? next : row
    )));
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      replaceRow(await api.adminUpdateMailTemplate({ template, locale, subject, body }));
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
      replaceRow(await api.adminResetMailTemplate(template, locale));
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
      setPreview(await api.adminPreviewMailTemplate({ template, locale, subject, body }));
    } catch (e) {
      setErr(apiErrorMessage(e, t("tplPreviewFail")));
    }
  };

  const insertPlaceholder = (key: string) => {
    const token = `{${key}}`;
    const el = document.getElementById(BODY_ID) as HTMLTextAreaElement | null;
    if (!el) {
      setBody((value) => value + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const switchTemplate = (name: string) => {
    if (dirty && !window.confirm(t("tplDiscardConfirm"))) return;
    setTemplate(name);
  };

  const switchLocale = (code: TplLocale) => {
    if (code === locale) return;
    if (dirty && !window.confirm(t("tplDiscardConfirm"))) return;
    setLocale(code);
  };

  if (loading && items.length === 0) {
    return null;
  }

  const previewParagraphs = preview
    ? preview.body.split(/\n\s*\n/).filter((chunk) => chunk.trim())
    : [];
  const actionUrl = preview?.body.match(/https?:\/\/\S+/)?.[0] ?? "";

  return (
    <section className="rounded-card border border-line bg-card shadow-card">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("tplTitle")}</h2>
        <p className="mt-0.5 max-w-2xl text-[12px] leading-snug text-muted">{t("tplHint")}</p>
      </div>

      <div className="grid md:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={t("tplSelect")} className="hidden border-r border-line py-2 md:block">
          {groups.map((group) => (
            <div key={group.id} className="px-2 py-1.5">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {t(`tplGroups.${group.id}`)}
              </p>
              <ul>
                {group.templates.map((name) => {
                  const selected = name === template;
                  const custom = customizedByTemplate.get(name);
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => switchTemplate(name)}
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                          selected ? "bg-iris-soft font-medium text-iris-hi" : "text-fg hover:bg-raised",
                        )}
                      >
                        <span className="min-w-0 truncate">{t(`tplNames.${name}`)}</span>
                        {custom && (
                          <span className="shrink-0 font-mono text-[10px] uppercase text-muted" title={t("tplCustom")}>
                            {custom.join("·")}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 md:hidden">
              <Select
                id="mail-template"
                name="template"
                value={template}
                onChange={(e) => switchTemplate(e.target.value)}
                className="h-9"
                aria-label={t("tplSelect")}
              >
                {groups.map((group) => (
                  <optgroup key={group.id} label={t(`tplGroups.${group.id}`)}>
                    {group.templates.map((name) => (
                      <option key={name} value={name}>{t(`tplNames.${name}`)}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            <div className="hidden min-w-0 items-center gap-2 md:flex">
              <h3 className="truncate text-[15px] font-semibold text-fg">{t(`tplNames.${template}`)}</h3>
              {current?.customized && <Tag tone="iris">{t("tplCustom")}</Tag>}
            </div>
            <div
              role="group"
              aria-label={t("tplLocale")}
              className="inline-flex overflow-hidden rounded-lg border border-line"
            >
              {LOCALES.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={locale === code}
                  onClick={() => switchLocale(code)}
                  className={cn(
                    "h-8 px-3 text-[12px] font-medium transition-colors",
                    locale === code ? "bg-iris text-white" : "bg-surface text-muted hover:bg-raised hover:text-fg",
                  )}
                >
                  {t(`tplLocales.${code}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <Field label={t("tplSubject")}>
              <Input
                id="mail-template-subject"
                name="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-9"
              />
            </Field>
            <Field label={t("tplBody")} hint={t("tplBodyHint")}>
              <Textarea
                id={BODY_ID}
                name="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-[11rem] text-[13px] leading-relaxed"
              />
            </Field>
            {current && current.placeholders.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                <span>{t("tplPlaceholders")}</span>
                {current.placeholders.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => insertPlaceholder(key)}
                    title={t(`tplPlaceholderHelp.${key}`)}
                    className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-fg transition-colors hover:border-iris hover:text-iris-hi"
                  >
                    {`{${key}}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              {msg && (
                <p className="flex items-start gap-1.5 text-[12.5px] text-good" role="status">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{msg}</span>
                </p>
              )}
              {err && (
                <p className="flex items-start gap-1.5 text-[12.5px] text-bad" role="alert">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{err}</span>
                </p>
              )}
              {!msg && !err && current?.customized && (
                <button
                  type="button"
                  onClick={() => void reset()}
                  disabled={saving}
                  className="text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50"
                >
                  {t("tplReset")}
                </button>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => void runPreview()} disabled={!subject.trim() || !body.trim()}>
                {t("tplPreview")}
              </Button>
              {dirty && (
                <Button size="sm" variant="ghost" onClick={() => applyRow(current)} disabled={saving}>
                  {t("discard")}
                </Button>
              )}
              <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
                {saving ? t("saving") : t("tplSave")}
              </Button>
            </div>
          </div>

          {preview && (
            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              <div className="border-b border-line bg-raised px-3 py-2 text-[11px] text-muted">
                {t("tplPreviewTitle")}
              </div>
              <div className="bg-surface px-4 py-3">
                <p className="text-[14px] font-semibold text-fg">{preview.subject}</p>
                <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-fg">
                  {previewParagraphs.map((chunk, index) => {
                    const lines = chunk.split("\n");
                    const isAction = actionUrl && lines[lines.length - 1].trim() === actionUrl;
                    if (!isAction) {
                      return <p key={index} className="whitespace-pre-wrap">{chunk}</p>;
                    }
                    const rest = lines.slice(0, -1);
                    const labelLine = rest[rest.length - 1]?.trim();
                    const label = labelLine?.endsWith(":") ? labelLine.slice(0, -1).trim() : t("tplPreviewCta");
                    const before = labelLine?.endsWith(":") ? rest.slice(0, -1) : rest;
                    return (
                      <div key={index} className="space-y-2">
                        {before.some((line) => line.trim()) && (
                          <p className="whitespace-pre-wrap">{before.join("\n")}</p>
                        )}
                        <span className="inline-flex h-9 items-center rounded-lg bg-iris px-4 text-[13px] font-semibold text-white">
                          {label}
                        </span>
                        <p className="break-all font-mono text-[11px] text-muted">{actionUrl}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
