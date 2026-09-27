"use client";

/** Buyer questions on the seller's products: answer (which makes them public),
 *  edit an answer, or hide a question from the storefront. */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { QuestionStatus, SellerQuestion } from "@/lib/types";
import { Button, Card, Pagination, Skeleton, Tag, Textarea } from "@/components/ui";
import { ExternalLink, Eye, EyeOff, MessageSquare } from "@/components/Icons";

const FILTERS = ["pending", "answered", "hidden", "all"] as const;
type Filter = (typeof FILTERS)[number];
const ANSWER_MAX = 1000;

export function SellerQuestionsConsole() {
  const t = useTranslations("seller.questions");
  const [filter, setFilter] = useState<Filter>("pending");
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: queryKeys.sellerQuestions(filter, page),
    queryFn: () => api.sellerQuestions(filter, page),
    placeholderData: (previous) => previous,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-[24px] font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-0.5 text-[12.5px] text-muted">{t("subtitle")}</p>
      </div>

      <div role="group" aria-label={t("filterLabel")} className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => { setFilter(f); setPage(1); }}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium",
              filter === f ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:text-fg",
            )}
          >
            {t(`filters.${f}`)}
            {f === "pending" && data && data.pending > 0 && <span className="font-mono text-[11px]">{data.pending}</span>}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="space-y-3 p-5" aria-hidden><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        ) : list.isError ? (
          <div className="flex items-center justify-between gap-3 p-5 text-[13px]">
            <span className="text-bad">{t("loadFailed")}</span>
            <Button size="sm" variant="secondary" onClick={() => list.refetch()}>{t("retry")}</Button>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <MessageSquare size={22} className="mx-auto text-faint" />
            <p className="mt-2 text-[13px] text-muted">{t(filter === "pending" ? "emptyPending" : "empty")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((q) => <QuestionRow key={q.id} question={q} />)}
          </ul>
        )}
      </Card>
      {data && pages > 1 && (
        <div className="flex justify-end"><Pagination page={page} totalPages={pages} onChange={setPage} /></div>
      )}
    </div>
  );
}

const STATUS_TONE: Record<QuestionStatus, "warn" | "good" | "neutral"> = { pending: "warn", answered: "good", hidden: "neutral" };

function QuestionRow({ question }: { question: SellerQuestion }) {
  const t = useTranslations("seller.questions");
  const locale = useLocale();
  const client = useQueryClient();
  const apiErrorMessage = useApiErrorMessage();
  const [draft, setDraft] = useState(question.answer ?? "");
  const [editing, setEditing] = useState(question.answer == null);
  useEffect(() => { setDraft(question.answer ?? ""); }, [question.answer]);
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["seller-questions"] });
    client.invalidateQueries({ queryKey: queryKeys.actionItems() });
  };
  const save = useMutation({
    mutationFn: () => api.answerQuestion(question.id, draft.trim()),
    onSuccess: () => { setEditing(false); refresh(); },
  });
  const visibility = useMutation({
    mutationFn: (hidden: boolean) => api.setSellerQuestionVisibility(question.id, hidden),
    onSuccess: refresh,
  });
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const lockedByAdmin = question.hidden_by === "admin";
  const error = save.error ?? visibility.error;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <Link href={question.product_path} className="inline-flex min-w-0 items-center gap-1 font-medium text-fg hover:underline">
          <span className="truncate">{question.product_title}</span> <ExternalLink size={11} />
        </Link>
        <span>· {question.asker_label}</span>
        <time dateTime={question.created_at}>· {date.format(new Date(question.created_at))}</time>
        <Tag tone={STATUS_TONE[question.status]} className="ml-auto">{t(`status.${question.status}`)}</Tag>
      </div>
      <p className="mt-1.5 whitespace-pre-line text-[14px] font-medium leading-relaxed">{question.question}</p>

      {editing ? (
        <div className="mt-2.5">
          <Textarea rows={3} maxLength={ANSWER_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("answerPlaceholder")} aria-label={t("answerLabel")} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11.5px] text-faint">{question.status === "hidden" ? t("answerHiddenHint") : t("answerHint")}</p>
            <div className="flex gap-2">
              {question.answer != null && <Button size="sm" variant="ghost" onClick={() => { setDraft(question.answer ?? ""); setEditing(false); }}>{t("cancel")}</Button>}
              <Button size="sm" loading={save.isPending} disabled={!draft.trim()} onClick={() => save.mutate()}>{question.answer == null ? t("answer") : t("saveAnswer")}</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-line bg-raised/40 px-3 py-2">
          <p className="whitespace-pre-line text-[13px] leading-relaxed">{question.answer}</p>
          <button type="button" onClick={() => setEditing(true)} className="mt-1 text-[12px] font-medium text-iris-hi hover:underline">{t("editAnswer")}</button>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        {error ? <p role="alert" className="text-[12px] text-bad">{apiErrorMessage(error, t("saveFailed"))}</p> : <span />}
        {lockedByAdmin ? (
          <span className="text-[12px] text-faint">{t("hiddenByAdmin")}</span>
        ) : (
          <Button size="sm" variant="ghost" loading={visibility.isPending} onClick={() => visibility.mutate(question.status !== "hidden")}>
            {question.status === "hidden" ? <><Eye size={13} /> {t("unhide")}</> : <><EyeOff size={13} /> {t("hide")}</>}
          </Button>
        )}
      </div>
    </li>
  );
}
