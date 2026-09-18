"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { ContentFilterConfig, ContentFilterTestResult } from "@/lib/types";
import { Button, Input, Tag, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { SettingsFooter, SettingsLoadError, SettingsLoading, SettingsRow } from "./SettingsRow";

const MAX_KEYWORDS = 200;

type Form = {
  enabled: boolean;
  action: "block" | "mask";
  keywordsText: string;
  blockPhones: boolean;
  blockLinks: boolean;
  maskChar: string;
};

function toForm(cfg: ContentFilterConfig): Form {
  return {
    enabled: cfg.enabled,
    action: cfg.action,
    keywordsText: cfg.keywords.join("\n"),
    blockPhones: cfg.block_phone_numbers,
    blockLinks: cfg.block_links,
    maskChar: cfg.mask_char,
  };
}

function parseKeywords(text: string): string[] {
  return Array.from(new Set(
    text.split(/[\n,]/).map((k) => k.trim().toLowerCase()).filter(Boolean),
  ));
}

/** Admin › Settings › Content filter: what buyer/seller text is not allowed to contain, and what happens to it. */
export function ContentFilterPanel() {
  const t = useTranslations("adminContentFilter");
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.adminContentFilter(), queryFn: api.adminContentFilter });
  const [form, setForm] = useState<Form | null>(null);
  const toast = useToast();
  const [sample, setSample] = useState("");
  const [sampleResult, setSampleResult] = useState<ContentFilterTestResult | null>(null);

  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.updateAdminContentFilter>[0]) => api.updateAdminContentFilter(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminContentFilter(), data);
      setForm(toForm(data));
      setSampleResult(null);
      toast.success(t("saved"));
    },
    onError: (err) => toast.error(apiErrorMessage(err, t("saveFailed"))),
  });
  const test = useMutation({
    mutationFn: (text: string) => api.testAdminContentFilter(text),
    onSuccess: setSampleResult,
    onError: (err) => toast.error(apiErrorMessage(err, t("testFailed"))),
  });

  if (query.isPending || !form) return <SettingsLoading />;
  if (query.isError) return <SettingsLoadError message={apiErrorMessage(query.error, t("loadFailed"))} onRetry={() => void query.refetch()} />;

  const keywords = parseKeywords(form.keywordsText);
  const keywordsOk = keywords.length <= MAX_KEYWORDS && keywords.every((k) => k.length <= 64);
  const maskOk = form.maskChar.length === 1 && form.maskChar.trim() !== "";
  const valid = keywordsOk && maskOk;
  const dirty = JSON.stringify({ ...form, keywordsText: keywords }) !== JSON.stringify({ ...toForm(query.data), keywordsText: query.data.keywords });
  const update = (patch: Partial<Form>) => { setForm((f) => (f ? { ...f, ...patch } : f)); };
  const checkbox = "h-3.5 w-3.5 rounded border-line-2 text-iris";

  return (
    <div className="max-w-[960px] space-y-4">
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <SettingsRow title={t("enabledTitle")} hint={t("enabledHint")}>
        <span className="mt-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
          <input type="checkbox" checked={form.enabled} onChange={(e) => update({ enabled: e.target.checked })} className={checkbox} />
          {t("enabledLabel")}
        </span>
      </SettingsRow>
      <SettingsRow title={t("actionTitle")} hint={t("actionHint")}>
        <div className="mt-1 space-y-1.5 text-[12.5px] text-fg">
          <span className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="cf-action" checked={form.action === "block"} onChange={() => update({ action: "block" })} className={checkbox} />
            {t("actionBlock")}
          </span>
          <span className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="cf-action" checked={form.action === "mask"} onChange={() => update({ action: "mask" })} className={checkbox} />
            {t("actionMask")}
          </span>
          {form.action === "mask" && (
            <span className="flex items-center gap-2 pl-5 text-[12px] text-muted">
              {t("maskCharLabel")}
              <Input value={form.maskChar} onChange={(e) => update({ maskChar: e.target.value.slice(-1) })} aria-invalid={!maskOk} maxLength={1} className="h-8 w-12 text-center font-mono" />
            </span>
          )}
        </div>
      </SettingsRow>
      <SettingsRow title={t("keywordsTitle")} hint={t("keywordsHint")} label={t("keywordsLabel", { count: keywords.length, max: MAX_KEYWORDS })}>
        <Textarea
          value={form.keywordsText}
          onChange={(e) => update({ keywordsText: e.target.value })}
          rows={8}
          aria-invalid={!keywordsOk}
          className="mt-1 w-full font-mono text-[12.5px]"
          placeholder={"zalo\ntelegram\nwhatsapp"}
        />
      </SettingsRow>
      <SettingsRow title={t("patternsTitle")} hint={t("patternsHint")}>
        <div className="mt-1 space-y-1.5 text-[12.5px] text-fg">
          <span className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={form.blockPhones} onChange={(e) => update({ blockPhones: e.target.checked })} className={checkbox} />
            {t("blockPhones")}
          </span>
          <span className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={form.blockLinks} onChange={(e) => update({ blockLinks: e.target.checked })} className={checkbox} />
            {t("blockLinks")}
          </span>
        </div>
      </SettingsRow>
      <SettingsRow title={t("testTitle")} hint={t("testHint")}>
        <div className="mt-1 space-y-2">
          <Textarea value={sample} onChange={(e) => { setSample(e.target.value); setSampleResult(null); }} rows={3} className="w-full text-[12.5px]" placeholder={t("testPlaceholder")} />
          <Button size="sm" variant="secondary" disabled={!sample.trim() || test.isPending} onClick={() => test.mutate(sample)}>
            {test.isPending ? t("testing") : t("testRun")}
          </Button>
          {sampleResult && (
            <div className="rounded-md border border-line bg-raised/40 p-2.5 text-[12px]" role="status">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {sampleResult.blocked
                  ? <Tag tone="bad">{t("resultBlocked")}</Tag>
                  : sampleResult.matches.length
                    ? <Tag tone="warn">{t("resultMasked")}</Tag>
                    : <Tag tone="good">{t("resultClean")}</Tag>}
                {sampleResult.matches.map((m) => <Tag key={m} tone="neutral">{m}</Tag>)}
              </div>
              {!sampleResult.blocked && sampleResult.matches.length > 0 && (
                <p className="font-mono text-fg break-words">{sampleResult.text}</p>
              )}
              <p className="mt-1 text-[11px] text-faint">{t("testNote")}</p>
            </div>
          )}
        </div>
      </SettingsRow>
      </section>
      <SettingsFooter
        updatedAt={query.data.updated_at}
        dirty={dirty}
        valid={valid}
        saving={save.isPending}
        onReset={() => { setForm(toForm(query.data)); }}
        onSave={() => save.mutate({
          enabled: form.enabled,
          action: form.action,
          keywords,
          block_phone_numbers: form.blockPhones,
          block_links: form.blockLinks,
          mask_char: form.maskChar,
        })}
      />
    </div>
  );
}
