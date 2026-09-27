"use client";

/** Buyer-asked questions on a product page. Answered questions are public;
 *  a viewer also sees their own questions that are still waiting. */

import { FormEvent, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Card, Skeleton, Tag, Textarea } from "@/components/ui";
import { MessageSquare, Store } from "@/components/Icons";
import { useAskQuestion, useMyQuestions, usePublicQuestions } from "../useProductQuestions";

const QUESTION_MAX = 500;

export function ProductQuestions({ productId }: { productId: number }) {
  const t = useTranslations("questions");
  const locale = useLocale();
  const pathname = usePathname();
  const { account } = useAuth();
  const apiErrorMessage = useApiErrorMessage();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const list = usePublicQuestions(productId, page);
  const mine = useMyQuestions(productId, !!account);
  const ask = useAskQuestion(productId);
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium" });
  const data = list.data;
  const waiting = (mine.data ?? []).filter((q) => q.status !== "answered");
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || ask.isPending) return;
    try {
      await ask.mutateAsync(question);
      setDraft("");
      setSent(true);
    } catch {
      // The error shows under the form; the draft stays.
    }
  };

  return (
    <Card id="qa" className="overflow-hidden scroll-mt-28">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="font-serif text-[16px] font-semibold tracking-tight">{t("title")}</h2>
        {data && data.total > 0 && <span className="font-mono text-[12px] text-faint">{data.total}</span>}
      </div>

      {list.isPending ? (
        <div className="space-y-2 p-5" aria-hidden><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4" /></div>
      ) : list.isError ? (
        <p className="px-5 py-5 text-[13px] text-bad">{t("loadFailed")}</p>
      ) : data && data.items.length > 0 ? (
        <ul className="divide-y divide-line">
          {data.items.map((q) => (
            <li key={q.id} className="px-5 py-4">
              <p className="flex gap-2 text-[13.5px] font-medium leading-relaxed">
                <MessageSquare size={14} className="mt-1 shrink-0 text-faint" />
                <span className="whitespace-pre-line">{q.question}</span>
              </p>
              <p className="mt-0.5 pl-[22px] text-[11.5px] text-faint">
                {q.asker_label} · <time dateTime={q.created_at}>{date.format(new Date(q.created_at))}</time>
              </p>
              <div className="mt-2 ml-[22px] rounded-lg border border-line bg-raised/40 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-iris-hi"><Store size={12} /> {t("shopAnswer")}</p>
                <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed">{q.answer}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-5 text-[13px] text-muted">{t("empty")}</p>
      )}

      {data && pages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[12.5px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="font-medium text-iris-hi disabled:text-faint">{t("newer")}</button>
          <span className="font-mono text-[11.5px] text-faint">{page}/{pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="font-medium text-iris-hi disabled:text-faint">{t("older")}</button>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="border-t border-line bg-raised/30 px-5 py-3.5">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("yours")}</h3>
          <ul className="mt-2 space-y-1.5">
            {waiting.map((q) => (
              <li key={q.id} className="flex items-start justify-between gap-3 text-[13px]">
                <span className="min-w-0 whitespace-pre-line">{q.question}</span>
                <Tag tone={q.status === "hidden" ? "neutral" : "warn"} className="shrink-0">{t(`status.${q.status}`)}</Tag>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-line px-5 py-4">
        {account ? (
          <form onSubmit={submit}>
            <label htmlFor="qa-question" className="text-[13px] font-medium">{t("askLabel")}</label>
            <Textarea
              id="qa-question"
              rows={3}
              maxLength={QUESTION_MAX}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setSent(false); }}
              placeholder={t("askPlaceholder")}
              className="mt-1.5"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className={cn("text-[12px]", ask.isError ? "text-bad" : sent ? "text-good" : "text-faint")} role={ask.isError ? "alert" : undefined}>
                {ask.isError ? apiErrorMessage(ask.error, t("askFailed")) : sent ? t("askSent") : t("askHint")}
              </p>
              <Button type="submit" size="sm" loading={ask.isPending} disabled={!draft.trim()}>{t("askSubmit")}</Button>
            </div>
          </form>
        ) : (
          <p className="text-[13px] text-muted">
            <Link href={`/login?next=${encodeURIComponent(`${pathname}#qa`)}`} className="font-medium text-iris-hi hover:underline">{t("signIn")}</Link>{" "}
            {t("signInToAsk")}
          </p>
        )}
      </div>
    </Card>
  );
}
