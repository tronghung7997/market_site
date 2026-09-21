"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import { Button, Field, InlineNotice, Input, Select, Spinner, Switch, Tag, Textarea } from "@/components/ui";
import { AlertCircle, CheckCircle2 } from "@/components/Icons";
import type { AiConnectionTestResult, AiPromptTemplate, AiProviderConfig } from "@/lib/types";

type Draft = {
  provider_kind: AiProviderConfig["provider_kind"];
  base_url: string;
  model: string;
  fallbackText: string;
  apiKey: string;
  temperature: string;
  timeout_seconds: string;
  max_retries: string;
  daily_token_budget: string;
  is_enabled: boolean;
};

function toDraft(config: AiProviderConfig): Draft {
  return {
    provider_kind: config.provider_kind,
    base_url: config.base_url,
    model: config.model,
    fallbackText: config.fallback_models.join("\n"),
    apiKey: "",
    temperature: String(config.temperature),
    timeout_seconds: String(config.timeout_seconds),
    max_retries: String(config.max_retries),
    daily_token_budget: String(config.daily_token_budget),
    is_enabled: config.is_enabled,
  };
}

/** Admin › Settings › AI: the single provider every AI feature routes through. */
export function AiSettingsPanel() {
  const t = useTranslations("adminAi");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: queryKeys.adminAiConfig(), queryFn: api.adminAiConfig });
  const prompts = useQuery({ queryKey: queryKeys.adminAiPrompts(), queryFn: api.adminAiPrompts });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);
  const [clearKey, setClearKey] = useState(false);

  useEffect(() => {
    if (query.data) setDraft(toDraft(query.data));
  }, [query.data]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setNotice(null);
  };

  const urlOk = useMemo(
    () => !draft || /^https?:\/\//.test(draft.base_url.trim()),
    [draft],
  );

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("no draft");
      return api.updateAdminAiConfig({
        provider_kind: draft.provider_kind,
        base_url: draft.base_url.trim(),
        model: draft.model.trim(),
        fallback_models: draft.fallbackText.split("\n").map((s) => s.trim()).filter(Boolean),
        temperature: Number(draft.temperature),
        timeout_seconds: Number(draft.timeout_seconds),
        max_retries: Number(draft.max_retries),
        daily_token_budget: Number(draft.daily_token_budget),
        is_enabled: draft.is_enabled,
        // Omitted entirely when untouched, so saving other fields never
        // disturbs the stored secret.
        ...(clearKey ? { api_key: "" } : draft.apiKey.trim() ? { api_key: draft.apiKey.trim() } : {}),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminAiConfig(), data);
      setDraft(toDraft(data));
      setClearKey(false);
      setNotice({ tone: "good", text: t("saved") });
    },
    onError: (err) => setNotice({ tone: "bad", text: apiErrorMessage(err, t("saveFail")) }),
  });

  const test = useMutation({
    mutationFn: api.testAdminAiConnection,
    onSuccess: (result) => { setTestResult(result); setNotice(null); },
    onError: (err) => setNotice({ tone: "bad", text: apiErrorMessage(err, t("testFail", { message: "" })) }),
  });

  if (query.isPending) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (query.isError) {
    return (
      <div className="rounded-card border border-bad/25 bg-bad-soft px-4 py-3 text-[13px] text-bad" role="alert">
        <p>{apiErrorMessage(query.error, t("saveFail"))}</p>
      </div>
    );
  }
  // The draft is hydrated from query.data in an effect, so the first paint
  // after load has data but no draft yet.
  if (!draft) return <div className="grid place-items-center py-16"><Spinner /></div>;

  const config = query.data;

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={config.is_enabled ? "good" : "neutral"}>
            {config.is_enabled ? t("statusOn") : t("statusOff")}
          </Tag>
          <Tag tone={config.api_key_configured ? "good" : "warn"}>
            {config.api_key_configured ? t("apiKeySet") : t("apiKeyMissing")}
          </Tag>
        </div>
        <p className="mt-2 text-[12px] text-muted">{t("hint")}</p>
      </section>

      <section className="rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("title")}</h2>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-fg">{t("enableLabel")}</div>
              <p className="mt-0.5 text-[12px] text-faint">{t("enableHelp")}</p>
            </div>
            <Switch
              checked={draft.is_enabled}
              onChange={(next) => set("is_enabled", next)}
              label={t("enableLabel")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("kindLabel")} hint={t("kindHelp")}>
              <Select
                value={draft.provider_kind}
                onChange={(e) => set("provider_kind", e.target.value as Draft["provider_kind"])}
              >
                <option value="gemini_native">{t("kindGemini")}</option>
                <option value="openai_compatible">{t("kindOpenai")}</option>
              </Select>
            </Field>

            <Field label={t("modelLabel")} hint={t("modelHelp")}>
              <Input
                value={draft.model}
                onChange={(e) => set("model", e.target.value)}
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            </Field>
          </div>

          <Field
            label={t("baseUrlLabel")}
            hint={urlOk ? t("baseUrlHelp") : undefined}
            error={urlOk ? undefined : t("baseUrlInvalid")}
          >
            <Input
              value={draft.base_url}
              onChange={(e) => set("base_url", e.target.value)}
              spellCheck={false}
              aria-invalid={!urlOk}
              className="font-mono text-[13px]"
            />
          </Field>

          <Field label={t("fallbackLabel")} hint={t("fallbackHelp")}>
            <Textarea
              value={draft.fallbackText}
              onChange={(e) => set("fallbackText", e.target.value)}
              spellCheck={false}
              rows={3}
              className="font-mono text-[12.5px]"
            />
          </Field>

          <Field label={t("apiKeyLabel")} hint={t("apiKeyHelp")}>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={draft.apiKey}
                onChange={(e) => { set("apiKey", e.target.value); setClearKey(false); }}
                autoComplete="off"
                spellCheck={false}
                placeholder={config.api_key_configured ? "••••••••••••" : ""}
                className="font-mono text-[13px]"
              />
              {config.api_key_configured && (
                <Button
                  size="sm"
                  variant={clearKey ? "secondary" : "ghost"}
                  onClick={() => { setClearKey((v) => !v); set("apiKey", ""); }}
                >
                  {t("apiKeyClear")}
                </Button>
              )}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("temperatureLabel")} hint={t("temperatureHelp")}>
              <Input
                type="number" min={0} max={2} step={0.05}
                value={draft.temperature}
                onChange={(e) => set("temperature", e.target.value)}
              />
            </Field>
            <Field label={t("timeoutLabel")}>
              <Input
                type="number" min={1} max={120}
                value={draft.timeout_seconds}
                onChange={(e) => set("timeout_seconds", e.target.value)}
              />
            </Field>
            <Field label={t("retriesLabel")}>
              <Input
                type="number" min={0} max={5}
                value={draft.max_retries}
                onChange={(e) => set("max_retries", e.target.value)}
              />
            </Field>
            <Field label={t("budgetLabel")} hint={t("budgetHelp")}>
              <Input
                type="number" min={0} step={1000}
                value={draft.daily_token_budget}
                onChange={(e) => set("daily_token_budget", e.target.value)}
              />
            </Field>
          </div>

          {testResult && (
            <InlineNotice
              tone={testResult.ok ? (testResult.used_fallback ? "warn" : "good") : "bad"}
              icon={testResult.ok
                ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <AlertCircle className="h-3.5 w-3.5" />}
            >
              {testResult.ok
                ? (testResult.used_fallback
                  ? t("testFallback", { model: testResult.model ?? "", ms: testResult.latency_ms ?? 0 })
                  : t("testOk", { model: testResult.model ?? "", ms: testResult.latency_ms ?? 0 }))
                : t("testFail", { message: testResult.message })}
            </InlineNotice>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            {notice ? (
              <InlineNotice
                tone={notice.tone}
                icon={notice.tone === "good"
                  ? <CheckCircle2 className="h-3.5 w-3.5" />
                  : <AlertCircle className="h-3.5 w-3.5" />}
              >
                {notice.text}
              </InlineNotice>
            ) : (
              <span className="text-[11.5px] text-faint">
                {config.updated_at ? formatDateTime(config.updated_at, locale) : ""}
              </span>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm" variant="secondary"
              disabled={test.isPending || !config.is_enabled}
              onClick={() => test.mutate()}
            >
              {test.isPending ? t("testing") : t("testButton")}
            </Button>
            <Button size="sm" disabled={!urlOk || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </section>

      <UsagePanel />

      <PromptCatalog prompts={prompts.data ?? []} isPending={prompts.isPending} />
    </div>
  );
}

/** Spend attribution per task, plus how much of today's token ceiling is left.
 *  Sourced from ai_usage_log, which records failures too — a task with many
 *  failures is the signal that a configured model is being throttled or has
 *  been retired upstream. */
function UsagePanel() {
  const t = useTranslations("adminAi");
  const locale = useLocale();
  const [days, setDays] = useState(7);
  const usage = useQuery({
    queryKey: queryKeys.adminAiUsage(days),
    queryFn: () => api.adminAiUsage(days),
  });

  const nf = useMemo(() => new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US"), [locale]);
  const items = usage.data?.items ?? [];
  const totals = items.reduce(
    (acc, row) => ({
      calls: acc.calls + row.calls,
      tokens: acc.tokens + row.tokens,
      failures: acc.failures + row.failures,
    }),
    { calls: 0, tokens: 0, failures: 0 },
  );

  const budget = usage.data?.daily_token_budget ?? 0;
  const usedToday = usage.data?.tokens_used_today ?? 0;
  const remaining = Math.max(0, budget - usedToday);
  const budgetPct = budget > 0 ? Math.min(100, Math.round((usedToday / budget) * 100)) : 0;

  return (
    <section className="rounded-card border border-line bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("usageTitle")}</h2>
          <p className="mt-1 text-[12px] text-muted">{t("usageHint", { days })}</p>
        </div>
        <Select
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-8 w-28 text-[12.5px]"
          aria-label={t("usageTitle")}
        >
          <option value="7">{t("usageDays7")}</option>
          <option value="30">{t("usageDays30")}</option>
          <option value="90">{t("usageDays90")}</option>
        </Select>
      </div>

      <div className="border-b border-line px-4 py-3">
        {budget > 0 ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-muted">
                {t("usageBudgetLeft", { left: nf.format(remaining), budget: nf.format(budget) })}
              </span>
              <span className="text-[12px] tabular-nums text-faint">{budgetPct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-2">
              <div
                className={budgetPct >= 90 ? "h-full bg-bad" : budgetPct >= 70 ? "h-full bg-warn" : "h-full bg-iris"}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          </>
        ) : (
          <span className="text-[12px] text-faint">{t("usageBudgetNone")}</span>
        )}
      </div>

      {usage.isPending ? (
        <div className="grid place-items-center py-8"><Spinner /></div>
      ) : !items.length ? (
        <p className="px-4 py-4 text-[12px] text-faint">{t("usageEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-medium">{t("usageTask")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("usageCalls")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("usageTokens")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("usageFailures")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((row) => (
                <tr key={row.task}>
                  <td className="px-4 py-2 text-fg">
                    {row.task === "trust_seed.reviews" ? t("taskTrustSeedReviews") : row.task}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{nf.format(row.calls)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{nf.format(row.tokens)}</td>
                  <td className={row.failures > 0
                    ? "px-4 py-2 text-right tabular-nums text-bad"
                    : "px-4 py-2 text-right tabular-nums text-faint"}>
                    {nf.format(row.failures)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-medium">
                <td className="px-4 py-2 text-fg">{t("usageTotal")}</td>
                <td className="px-4 py-2 text-right tabular-nums text-fg">{nf.format(totals.calls)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-fg">{nf.format(totals.tokens)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-fg">{nf.format(totals.failures)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/** Per-task instruction copy. Tasks come from the backend catalog; the console
 *  only edits their wording. */
function PromptCatalog({ prompts, isPending }: { prompts: AiPromptTemplate[]; isPending: boolean }) {
  const t = useTranslations("adminAi");
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { system: string; user: string }>>({});
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const save = useMutation({
    mutationFn: ({ task, locale, system, user }: { task: string; locale: string; system: string; user: string }) =>
      api.updateAdminAiPrompt(task, locale, { system_prompt: system, user_prompt: user }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminAiPrompts() });
      setNotice({ tone: "good", text: t("promptSaved") });
    },
    onError: (err) => setNotice({ tone: "bad", text: apiErrorMessage(err, t("promptSaveFail")) }),
  });

  if (isPending) return <></>;

  return (
    <section className="rounded-card border border-line bg-card shadow-card">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("promptsTitle")}</h2>
        <p className="mt-1 text-[12px] text-muted">{t("promptsHint")}</p>
      </div>

      <div className="divide-y divide-line">
        {prompts.map((prompt) => {
          const key = `${prompt.task}:${prompt.locale}`;
          const open = openKey === key;
          const edit = edits[key] ?? { system: prompt.system_prompt, user: prompt.user_prompt };
          const dirty = edit.system !== prompt.system_prompt || edit.user !== prompt.user_prompt;

          return (
            <div key={key} className="px-4 py-3">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() => setOpenKey(open ? null : key)}
              >
                <span className="min-w-0">
                  <span className="text-[13px] font-medium text-fg">
                    {prompt.task === "trust_seed.reviews" ? t("taskTrustSeedReviews") : prompt.task}
                  </span>
                  <span className="ml-2 text-[11.5px] uppercase text-faint">{prompt.locale}</span>
                </span>
                <span className="shrink-0 text-[12px] text-faint">{open ? "−" : "+"}</span>
              </button>

              {open && (
                <div className="mt-3 space-y-3">
                  <Field label={t("systemPromptLabel")}>
                    <Textarea
                      rows={6}
                      value={edit.system}
                      onChange={(e) => setEdits((p) => ({ ...p, [key]: { ...edit, system: e.target.value } }))}
                      className="text-[12.5px]"
                    />
                  </Field>
                  <Field label={t("userPromptLabel")}>
                    <Textarea
                      rows={4}
                      value={edit.user}
                      onChange={(e) => setEdits((p) => ({ ...p, [key]: { ...edit, user: e.target.value } }))}
                      className="font-mono text-[12.5px]"
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-3">
                    {notice ? (
                      <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>
                    ) : <span />}
                    <Button
                      size="sm"
                      disabled={!dirty || save.isPending}
                      onClick={() => save.mutate({
                        task: prompt.task, locale: prompt.locale,
                        system: edit.system, user: edit.user,
                      })}
                    >
                      {t("save")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
