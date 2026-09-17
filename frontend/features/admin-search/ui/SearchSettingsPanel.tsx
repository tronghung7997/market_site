"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SearchQueryStat, SearchSynonymGroup } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button, Field, InlineNotice, Input, Spinner, Tag } from "@/components/ui";
import { AlertCircle, CheckCircle2 } from "@/components/Icons";

const DAY_OPTIONS = [7, 30, 90] as const;

function splitTerms(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const term = part.trim().toLowerCase();
    if (term && !out.includes(term)) out.push(term);
  }
  return out;
}

export function SearchSettingsPanel() {
  const t = useTranslations("adminSearch");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();

  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(30);
  const [zeroOnly, setZeroOnly] = useState(false);
  const [queries, setQueries] = useState<SearchQueryStat[] | null>(null);
  const [queriesErr, setQueriesErr] = useState("");

  const [groups, setGroups] = useState<SearchSynonymGroup[] | null>(null);
  const [groupsErr, setGroupsErr] = useState("");
  const [groupKey, setGroupKey] = useState("");
  const [termsInput, setTermsInput] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const loadQueries = useCallback(async () => {
    setQueriesErr("");
    try {
      const data = await api.adminSearchQueries({ days, limit: 100, zero_only: zeroOnly });
      setQueries(data.items);
    } catch (e) {
      setQueriesErr(apiErrorMessage(e, t("queries.loadFail")));
      setQueries([]);
    }
  }, [apiErrorMessage, days, t, zeroOnly]);

  const loadGroups = useCallback(async () => {
    setGroupsErr("");
    try {
      setGroups((await api.adminSearchSynonyms()).items);
    } catch (e) {
      setGroupsErr(apiErrorMessage(e, t("synonyms.loadFail")));
      setGroups([]);
    }
  }, [apiErrorMessage, t]);

  useEffect(() => { void loadQueries(); }, [loadQueries]);
  useEffect(() => { void loadGroups(); }, [loadGroups]);

  const terms = useMemo(() => splitTerms(termsInput), [termsInput]);
  const canSave = groupKey.trim().length > 0 && terms.length > 0 && !saving;

  const startEdit = (group: SearchSynonymGroup) => {
    setEditing(group.group_key);
    setGroupKey(group.group_key);
    setTermsInput(group.terms.join(", "));
    setNotice(null);
  };

  const startFromQuery = (query: string) => {
    setEditing(null);
    setGroupKey("");
    setTermsInput(query.toLowerCase());
    setNotice(null);
    document.getElementById("synonym-group-key")?.focus();
  };

  const resetForm = () => {
    setEditing(null);
    setGroupKey("");
    setTermsInput("");
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setNotice(null);
    try {
      const saved = await api.adminUpsertSearchSynonyms({ group_key: groupKey.trim(), terms });
      if (editing && editing !== saved.group_key) {
        await api.adminDeleteSearchSynonyms(editing).catch(() => undefined);
      }
      await loadGroups();
      resetForm();
      setNotice({ tone: "good", text: t("synonyms.saved", { group: saved.group_key }) });
    } catch (e) {
      setNotice({ tone: "bad", text: apiErrorMessage(e, t("synonyms.saveFail")) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (key: string) => {
    if (!window.confirm(t("synonyms.deleteConfirm", { group: key }))) return;
    setSaving(true);
    setNotice(null);
    try {
      await api.adminDeleteSearchSynonyms(key);
      await loadGroups();
      if (editing === key) resetForm();
      setNotice({ tone: "good", text: t("synonyms.deleted", { group: key }) });
    } catch (e) {
      setNotice({ tone: "bad", text: apiErrorMessage(e, t("synonyms.deleteFail")) });
    } finally {
      setSaving(false);
    }
  };

  if (queries === null || groups === null) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }

  const zeroCount = queries.filter((q) => q.zero_results === q.searches).length;
  const timeFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-card shadow-card">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("queries.title")}</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {zeroOnly
                ? t("queries.summaryZero", { count: queries.length, days })
                : t("queries.summary", { count: queries.length, zero: zeroCount, days })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("queries.range")} className="inline-flex overflow-hidden rounded-lg border border-line">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days === d}
                  onClick={() => setDays(d)}
                  className={cn(
                    "h-8 px-3 text-[12px] font-medium transition-colors",
                    days === d ? "bg-iris text-white" : "bg-surface text-muted hover:bg-raised hover:text-fg",
                  )}
                >
                  {t("queries.days", { days: d })}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[12px] text-fg">
              <input
                type="checkbox"
                checked={zeroOnly}
                onChange={(e) => setZeroOnly(e.target.checked)}
                className="h-4 w-4 accent-iris"
              />
              {t("queries.zeroOnly")}
            </label>
          </div>
        </div>

        {queriesErr && (
          <div className="px-4 py-3">
            <InlineNotice tone="bad" icon={<AlertCircle className="h-3.5 w-3.5" />}>{queriesErr}</InlineNotice>
          </div>
        )}

        {queries.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted">{t("queries.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th className="px-4 py-2">{t("queries.colQuery")}</th>
                  <th className="px-3 py-2 text-right">{t("queries.colSearches")}</th>
                  <th className="px-3 py-2 text-right">{t("queries.colZero")}</th>
                  <th className="px-3 py-2">{t("queries.colLast")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {queries.map((row) => {
                  const allZero = row.zero_results === row.searches;
                  return (
                    <tr key={row.query} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium text-fg">
                        {row.query}
                        {allZero && <Tag tone="warn" className="ml-2">{t("queries.noResults")}</Tag>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{row.searches}</td>
                      <td className={cn("px-3 py-2 text-right font-mono tabular-nums", row.zero_results > 0 ? "text-warn" : "text-muted")}>
                        {row.zero_results}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums text-muted">
                        {timeFormatter.format(new Date(row.last_searched_at))}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => startFromQuery(row.query)}>
                          {t("queries.addSynonym")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("synonyms.title")}</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-muted">{t("synonyms.hint")}</p>
        </div>

        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="min-w-0 md:border-r md:border-line">
            {groupsErr && (
              <div className="px-4 py-3">
                <InlineNotice tone="bad" icon={<AlertCircle className="h-3.5 w-3.5" />}>{groupsErr}</InlineNotice>
              </div>
            )}
            {groups.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted">{t("synonyms.empty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {groups.map((group) => (
                  <li
                    key={group.group_key}
                    className={cn("flex items-start justify-between gap-3 px-4 py-2.5", editing === group.group_key && "bg-iris-soft")}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-fg">{group.group_key}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {group.terms.map((term) => (
                          <span key={term} className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-fg">
                            {term}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(group)} disabled={saving}>
                        {t("synonyms.edit")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(group.group_key)} disabled={saving}>
                        {t("synonyms.delete")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            className="space-y-3 p-4"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
          >
            <h3 className="text-[13px] font-semibold text-fg">
              {editing ? t("synonyms.editing", { group: editing }) : t("synonyms.newGroup")}
            </h3>
            <Field label={t("synonyms.groupKey")} hint={t("synonyms.groupKeyHint")}>
              <Input
                id="synonym-group-key"
                value={groupKey}
                onChange={(e) => setGroupKey(e.target.value)}
                placeholder="facebook"
                className="h-9"
              />
            </Field>
            <Field label={t("synonyms.terms")} hint={t("synonyms.termsHint")}>
              <Input
                id="synonym-terms"
                value={termsInput}
                onChange={(e) => setTermsInput(e.target.value)}
                placeholder="facebook, fb, face"
                className="h-9"
              />
            </Field>
            {terms.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {terms.map((term) => (
                  <span key={term} className="rounded-md border border-iris/25 bg-iris-soft px-1.5 py-0.5 font-mono text-[11.5px] text-iris-hi">
                    {term}
                  </span>
                ))}
              </div>
            )}
            {notice && (
              <InlineNotice
                tone={notice.tone}
                icon={notice.tone === "good" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              >
                {notice.text}
              </InlineNotice>
            )}
            <div className="flex justify-end gap-2">
              {(editing || groupKey || termsInput) && (
                <Button type="button" size="sm" variant="ghost" onClick={resetForm} disabled={saving}>
                  {t("synonyms.cancel")}
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!canSave}>
                {saving ? t("synonyms.saving") : editing ? t("synonyms.save") : t("synonyms.add")}
              </Button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
