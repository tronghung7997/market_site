"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import { isValidClarityId } from "@/lib/clarity";
import { Button, InlineNotice, Input, Spinner, Tag } from "@/components/ui";
import { AlertCircle, CheckCircle2 } from "@/components/Icons";

/** Admin › Settings › Analytics: third-party tags the storefront renders. */
export function AnalyticsSettingsPanel() {
  const t = useTranslations("adminAnalytics");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.adminAnalyticsConfig(), queryFn: api.adminAnalyticsConfig });
  const [clarityId, setClarityId] = useState("");
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (query.data) setClarityId(query.data.clarity_project_id ?? "");
  }, [query.data]);

  const save = useMutation({
    mutationFn: (id: string | null) => api.updateAdminAnalyticsConfig({ clarity_project_id: id }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminAnalyticsConfig(), data);
      setNotice({ tone: "good", text: t("saved") });
    },
    onError: (err) => setNotice({ tone: "bad", text: apiErrorMessage(err, t("saveFail")) }),
  });

  const trimmed = clarityId.trim().toLowerCase();
  const idOk = trimmed === "" || isValidClarityId(trimmed);
  const saved = query.data?.clarity_project_id ?? "";
  const dirty = query.data ? trimmed !== saved : false;
  const discard = () => { setClarityId(saved); setNotice(null); };

  if (query.isPending) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (query.isError) {
    return (
      <div className="rounded-card border border-bad/25 bg-bad-soft px-4 py-3 text-[13px] text-bad" role="alert">
        <p>{apiErrorMessage(query.error, t("loadFail"))}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void query.refetch()}>{t("retry")}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={saved ? "good" : "neutral"}>{saved ? t("statusOn") : t("statusOff")}</Tag>
          {dirty && <Tag tone="warn">{t("unsaved")}</Tag>}
        </div>
        <p className="mt-2 text-[12px] text-muted">{t("hint")}</p>
      </section>

      <section className="rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("title")}</h2>
        </div>

        <div className="grid gap-3 px-4 py-4 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-6">
          <div>
            <h3 className="text-[13px] font-semibold text-fg">{t("clarityTitle")}</h3>
            <p className="mt-1 text-[12px] leading-snug text-muted">{t("clarityHint")}</p>
          </div>
          <div>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">{t("projectIdLabel")}</span>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  value={clarityId}
                  onChange={(e) => { setClarityId(e.target.value); setNotice(null); }}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!idOk}
                  className="h-9 w-full max-w-xs font-mono text-[13px]"
                />
                {clarityId && (
                  <Button size="sm" variant="ghost" onClick={() => { setClarityId(""); setNotice(null); }} disabled={save.isPending}>
                    {t("clearId")}
                  </Button>
                )}
              </div>
            </label>
            <p className={idOk ? "mt-1 text-[11px] text-faint" : "mt-1 text-[11px] text-bad"}>
              {idOk ? t("projectIdHelp") : t("projectIdInvalid")}
            </p>
            <p className="mt-3 text-[12px] leading-snug text-muted">{t("privacyNote")}</p>
            {saved && (
              <a
                href="https://clarity.microsoft.com/projects"
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-block text-[12px] font-medium text-iris hover:underline"
              >
                {t("openClarity")} ↗
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            {notice ? (
              <InlineNotice
                tone={notice.tone}
                icon={notice.tone === "good" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              >
                {notice.text}
              </InlineNotice>
            ) : (
              <span className="text-[11.5px] text-faint">
                {query.data.updated_at ? t("updatedAt", { at: formatDateTime(query.data.updated_at, locale) }) : t("neverUpdated")}
              </span>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {dirty && (
              <Button size="sm" variant="ghost" onClick={discard} disabled={save.isPending}>{t("discard")}</Button>
            )}
            <Button size="sm" disabled={!dirty || !idOk || save.isPending} onClick={() => save.mutate(trimmed || null)}>
              {save.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
