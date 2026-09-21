"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import { Button, Field, InlineNotice, Input, Select, Spinner, Switch, Tag, Textarea } from "@/components/ui";
import { AlertCircle, CheckCircle2 } from "@/components/Icons";
import type { TrustSeedDraft, TrustSeedGenerateResponse } from "@/lib/types";

/** Editable copy of a generated draft. `problems` is recomputed by the server
 *  on apply, so local edits never bypass the content policy. */
type EditableDraft = TrustSeedDraft & { id: string };

const DEFAULT_WEIGHTS: Record<number, number> = { 5: 62, 4: 22, 3: 10, 2: 4, 1: 2 };

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Map a backend violation code onto translated, human copy. */
function problemLabel(code: string, t: (k: string) => string): string {
  const bare = code.replace(/^reply_/, "");
  if (bare.startsWith("contact:")) return t("problemContact");
  if (bare === "link") return t("problemLink");
  if (bare === "phone") return t("problemPhone");
  if (bare === "email") return t("problemEmail");
  if (bare === "handle") return t("problemHandle");
  if (bare.includes("too_long") || bare.includes("too_short")) return t("problemLength");
  return t("problemOther");
}

/** Admin › Product › Seeded reviews. Two-step: generate drafts, edit, apply. */
export function TrustSeedPanel({ productId }: { productId: number }) {
  const t = useTranslations("trustSeed");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();

  const [count, setCount] = useState(10);
  const [contentLocale, setContentLocale] = useState("vi");
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(60));
  const [dateTo, setDateTo] = useState(isoDaysAgo(0));
  const [weights, setWeights] = useState<Record<number, number>>(DEFAULT_WEIGHTS);
  const [promptMode, setPromptMode] = useState<"template" | "custom">("template");
  const [extra, setExtra] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [bumpSold, setBumpSold] = useState(true);

  const [generated, setGenerated] = useState<TrustSeedGenerateResponse | null>(null);
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [showContext, setShowContext] = useState(false);
  // Which row is being individually regenerated, so only its button spins.
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: queryKeys.trustSeedSummary(productId),
    queryFn: () => api.trustSeedSummary(productId),
  });
  const batches = useQuery({
    queryKey: queryKeys.trustSeedBatches(productId),
    queryFn: () => api.trustSeedBatches(productId),
  });

  const generate = useMutation({
    mutationFn: () => api.trustSeedGenerate({
      product_id: productId,
      count,
      distribution: weights,
      locale: contentLocale,
      user_override: promptMode === "custom" && customPrompt.trim() ? customPrompt.trim() : null,
      extra_instructions: promptMode === "template" ? extra.trim() : "",
    }),
    onSuccess: (data) => {
      setGenerated(data);
      setDrafts(data.drafts.map((d, i) => ({ ...d, id: `${Date.now()}-${i}` })));
      setNotice(null);
    },
    onError: (err) => setNotice({ tone: "bad", text: apiErrorMessage(err, t("generateFail")) }),
  });

  // Reroll one row in place, keeping its star rating. Cheaper and far less
  // disruptive than regenerating the whole set because an admin disliked one
  // line; the other rows keep any manual edits already made to them.
  const regenerateRow = useMutation({
    mutationFn: (row: EditableDraft) => api.trustSeedGenerate({
      product_id: productId,
      count: 1,
      distribution: { [row.rating]: 1 },
      locale: contentLocale,
      user_override: promptMode === "custom" && customPrompt.trim() ? customPrompt.trim() : null,
      extra_instructions: promptMode === "template" ? extra.trim() : "",
    }),
    onMutate: (row) => setRegeneratingId(row.id),
    onSettled: () => setRegeneratingId(null),
    onSuccess: (data, row) => {
      const fresh = data.drafts[0];
      if (!fresh) return;
      setDrafts((prev) => prev.map((d) => (d.id === row.id
        ? { ...d, rating: fresh.rating, comment: fresh.comment, seller_reply: fresh.seller_reply, problems: fresh.problems }
        : d)));
      setNotice(null);
    },
    onError: (err) => setNotice({ tone: "bad", text: apiErrorMessage(err, t("generateFail")) }),
  });

  const apply = useMutation({
    mutationFn: () => api.trustSeedApply({
      product_id: productId,
      items: drafts.map((d) => ({
        rating: d.rating,
        comment: d.comment?.trim() || null,
        seller_reply: d.seller_reply?.trim() || null,
      })),
      // Whole-day window: start of `from`, end of `to`.
      date_from: new Date(`${dateFrom}T00:00:00Z`).toISOString(),
      date_to: new Date(`${dateTo}T23:59:59Z`).toISOString(),
      source: promptMode === "custom" ? "ai" : "ai",
      model: generated?.model ?? null,
      locale: contentLocale,
      prompt_snapshot: promptMode === "custom" ? customPrompt.trim() : extra.trim() || null,
      options_snapshot: { count, weights, promptMode },
      bump_sold_count: bumpSold,
    }),
    onSuccess: (result) => {
      setGenerated(null);
      setDrafts([]);
      setNotice({
        tone: "good",
        text: t("applied", {
          count: result.review_count,
          avg: result.rating_avg ? result.rating_avg.toFixed(2) : "—",
        }),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trustSeedSummary(productId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trustSeedBatches(productId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminReviews({ productId }) });
    },
    onError: (err) => setNotice({ tone: "bad", text: apiErrorMessage(err, t("applyFail")) }),
  });

  const purge = useMutation({
    mutationFn: (batchId: number) => api.trustSeedPurge(batchId),
    onSuccess: (result) => {
      setNotice({ tone: "good", text: t("purged", { count: result.removed_reviews }) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trustSeedSummary(productId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trustSeedBatches(productId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminReviews({ productId }) });
    },
    onError: (err) => setNotice({ tone: "bad", text: apiErrorMessage(err, t("purgeFail")) }),
  });

  const blocked = useMemo(
    () => drafts.some((d) => d.problems.length > 0) || drafts.length === 0,
    [drafts],
  );

  const updateDraft = (id: string, patch: Partial<EditableDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id
      // Clearing problems locally is safe: apply re-validates server-side and
      // rejects the batch if the edit did not actually fix the violation.
      ? { ...d, ...patch, problems: patch.comment !== undefined || patch.seller_reply !== undefined ? [] : d.problems }
      : d)));
  };

  return (
    <section className="rounded-card border border-line bg-card shadow-card">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("title")}</h2>
        <p className="mt-1 text-[12px] text-muted">{t("hint")}</p>
        <InlineNotice tone="warn" className="mt-2" icon={<AlertCircle className="h-3.5 w-3.5" />}>
          {t("warning")}
        </InlineNotice>
      </div>

      {summary.data && (
        <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
          {([
            [t("summarySeeded"), summary.data.seeded_reviews],
            [t("summaryReal"), summary.data.real_reviews],
            [t("summaryPool"), summary.data.seed_pool_size],
          ] as const).map(([label, value]) => (
            <div key={label} className="px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div>
              <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-fg">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="space-y-4 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("countLabel")}>
            <Input
              type="number" min={1} max={50} value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
          </Field>
          <Field label={t("localeLabel")}>
            <Select value={contentLocale} onChange={(e) => setContentLocale(e.target.value)}>
              <option value="vi">{t("localeVi")}</option>
              <option value="en">{t("localeEn")}</option>
            </Select>
          </Field>
          <Field label={t("dateFromLabel")}>
            <Input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label={t("dateToLabel")} hint={t("dateHelp")}>
            <Input type="date" value={dateTo} min={dateFrom} max={isoDaysAgo(0)} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="text-[13px] font-medium text-muted">{t("distributionLabel")}</div>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {[5, 4, 3, 2, 1].map((star) => (
              <label key={star} className="flex flex-col gap-1">
                <span className="text-[11px] text-faint">{t("starsLabel", { count: star })}</span>
                <Input
                  type="number" min={0} max={100}
                  value={weights[star] ?? 0}
                  onChange={(e) => setWeights((p) => ({ ...p, [star]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="tabular-nums"
                />
              </label>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-faint">{t("distributionHelp")}</p>
        </div>

        <Field label={t("promptModeLabel")}>
          <Select value={promptMode} onChange={(e) => setPromptMode(e.target.value as "template" | "custom")}>
            <option value="template">{t("promptModeTemplate")}</option>
            <option value="custom">{t("promptModeCustom")}</option>
          </Select>
        </Field>

        {promptMode === "template" ? (
          <Field label={t("extraLabel")}>
            <Textarea
              rows={2} value={extra} placeholder={t("extraPlaceholder")}
              onChange={(e) => setExtra(e.target.value)} className="text-[12.5px]"
            />
          </Field>
        ) : (
          <Field label={t("customPromptLabel")} hint={t("customPromptHelp")}>
            <Textarea
              rows={5} value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)} className="font-mono text-[12.5px]"
            />
          </Field>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-fg">{t("bumpSoldLabel")}</div>
            <p className="mt-0.5 text-[12px] text-faint">{t("bumpSoldHelp")}</p>
          </div>
          <Switch checked={bumpSold} onChange={setBumpSold} label={t("bumpSoldLabel")} />
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={generate.isPending || (promptMode === "custom" && !customPrompt.trim())}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? t("generating") : generated ? t("regenerate") : t("generate")}
          </Button>
          {generate.isPending && <Spinner />}
        </div>

        {notice && (
          <InlineNotice
            tone={notice.tone}
            icon={notice.tone === "good"
              ? <CheckCircle2 className="h-3.5 w-3.5" />
              : <AlertCircle className="h-3.5 w-3.5" />}
          >
            {notice.text}
          </InlineNotice>
        )}
      </div>

      {/* ── Drafts ────────────────────────────────────────────────────────── */}
      {generated && (
        <div className="border-t border-line px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-fg">{t("draftsTitle", { count: drafts.length })}</h3>
            <Tag tone="neutral">{t("modelUsed", { model: generated.model })}</Tag>
            {generated.used_fallback && <Tag tone="warn">{t("usedFallback")}</Tag>}
          </div>
          <p className="mt-1 text-[12px] text-muted">{t("draftsHint")}</p>

          <button
            type="button"
            className="mt-2 text-[12px] font-medium text-iris hover:underline"
            onClick={() => setShowContext((v) => !v)}
          >
            {t("contextTitle")} {showContext ? "−" : "+"}
          </button>
          {showContext && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-card border border-line bg-bg px-3 py-2 text-[11.5px] leading-relaxed text-muted whitespace-pre-wrap">
              {generated.product_context}
            </pre>
          )}

          <div className="mt-3 space-y-3">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className={draft.problems.length
                  ? "rounded-card border border-bad/40 bg-bad-soft p-3"
                  : "rounded-card border border-line p-3"}
              >
                <div className="flex items-start gap-3">
                  <label className="shrink-0">
                    <span className="block text-[11px] text-faint">{t("ratingLabel")}</span>
                    <Select
                      value={String(draft.rating)}
                      onChange={(e) => updateDraft(draft.id, { rating: Number(e.target.value) })}
                      className="mt-1 w-20"
                    >
                      {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{s} ★</option>)}
                    </Select>
                  </label>

                  <div className="min-w-0 flex-1 space-y-2">
                    <label className="block">
                      <span className="block text-[11px] text-faint">{t("commentLabel")}</span>
                      <Textarea
                        rows={2}
                        value={draft.comment ?? ""}
                        onChange={(e) => updateDraft(draft.id, { comment: e.target.value })}
                        className="mt-1 text-[12.5px]"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[11px] text-faint">{t("replyLabel")}</span>
                      <Input
                        value={draft.seller_reply ?? ""}
                        placeholder={t("replyPlaceholder")}
                        onChange={(e) => updateDraft(draft.id, { seller_reply: e.target.value })}
                        className="mt-1 text-[12.5px]"
                      />
                    </label>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      size="sm" variant="secondary"
                      disabled={regenerateRow.isPending}
                      onClick={() => regenerateRow.mutate(draft)}
                    >
                      {regeneratingId === draft.id ? t("regeneratingRow") : t("regenerateRow")}
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => setDrafts((prev) => prev.filter((d) => d.id !== draft.id))}
                    >
                      {t("removeRow")}
                    </Button>
                  </div>
                </div>

                {draft.problems.length > 0 && (
                  <p className="mt-2 text-[12px] text-bad">
                    {t("problemsLabel")}{" "}
                    {[...new Set(draft.problems.map((p) => problemLabel(p, t)))].join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            {blocked && drafts.length > 0
              ? <InlineNotice tone="bad">{t("blockedHint")}</InlineNotice>
              : <span />}
            <Button size="sm" disabled={blocked || apply.isPending} onClick={() => apply.mutate()}>
              {apply.isPending ? t("applying") : t("apply", { count: drafts.length })}
            </Button>
          </div>
        </div>
      )}

      {/* ── Batches ───────────────────────────────────────────────────────── */}
      <div className="border-t border-line px-4 py-4">
        <h3 className="text-[13px] font-semibold text-fg">{t("batchesTitle")}</h3>
        {batches.isPending ? (
          <div className="py-4"><Spinner /></div>
        ) : !batches.data?.length ? (
          <p className="mt-2 text-[12px] text-faint">{t("batchesEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {batches.data.map((batch) => (
              <li key={batch.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-fg">{t("batchReviews", { count: batch.review_count })}</span>
                    {batch.status === "purged" && <Tag tone="neutral">{t("batchPurged")}</Tag>}
                    {batch.model && <Tag tone="neutral">{batch.model}</Tag>}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-faint">
                    {batch.created_at ? formatDateTime(batch.created_at, locale) : ""}
                  </div>
                </div>
                {batch.status === "applied" && (
                  <Button
                    size="sm" variant="ghost"
                    disabled={purge.isPending}
                    onClick={() => {
                      if (window.confirm(t("purgeConfirm", { count: batch.review_count }))) {
                        purge.mutate(batch.id);
                      }
                    }}
                  >
                    {purge.isPending ? t("purging") : t("purge")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
