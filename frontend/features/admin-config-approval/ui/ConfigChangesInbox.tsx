"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import type { ConfigChangeRequest } from "@/lib/types";
import { Banner, Button, Input, Skeleton, Tag } from "@/components/ui";
import { ArrowRight, Info } from "@/components/Icons";
import { useToast } from "@/components/toast";
import { STATUS_TONE, personLabel, reasonOk } from "../model";
import { useRefreshConfigChanges } from "../use-config-approval";
import { ChangeRows } from "./ChangeRows";

type Tab = "pending" | "history";
const HISTORY_PAGE = 20;

/** Admin › Settings › Chờ duyệt: settings changes waiting for a second admin, and the decisions. */
export function ConfigChangesInbox() {
  const t = useTranslations("adminConfigApproval");
  const apiErrorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();
  const focusId = Number(searchParams.get("id")) || null;
  const [tab, setTab] = useState<Tab>("pending");

  const pending = useQuery({
    queryKey: queryKeys.adminConfigChanges({ state: "pending" }),
    queryFn: () => api.adminConfigChanges({ state: "pending", limit: 100 }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const history = useInfiniteQuery({
    queryKey: queryKeys.adminConfigChanges({ state: "history" }),
    queryFn: ({ pageParam }) => api.adminConfigChanges({ state: "history", limit: HISTORY_PAGE, before_id: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_before_id ?? undefined,
    enabled: tab === "history",
  });
  // A deep link to a request that is no longer pending (bell, log, old notice).
  const focusMissing = focusId != null && pending.isSuccess && !pending.data.items.some((r) => r.id === focusId);
  const focused = useQuery({
    queryKey: queryKeys.adminConfigChanges({ id: focusId }),
    queryFn: () => api.adminConfigChange(focusId as number),
    enabled: focusMissing,
  });

  const meta = pending.data;
  const historyItems = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="text-[18px] font-semibold text-fg">{t("pageTitle")}</h1>
        <p className="mt-0.5 max-w-3xl text-[13px] text-muted">{t("pageHint", { days: meta?.expiry_days ?? 7 })}</p>
      </div>
      {meta && !meta.approval_required && <Banner tone="iris" icon={<Info size={15} />}>{t("approvalOff")}</Banner>}

      <div role="tablist" aria-label={t("pageTitle")} className="flex gap-1 border-b border-line">
        {(["pending", "history"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px h-10 border-b-2 px-3 text-[13px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
              tab === id ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {id === "pending" ? t("tabPending") : t("tabHistory")}
            {id === "pending" && meta && meta.pending_count > 0 && (
              <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn">{meta.pending_count}</span>
            )}
          </button>
        ))}
      </div>

      {focusMissing && focused.data && tab === "pending" && <RequestCard request={focused.data} focused />}

      {tab === "pending" ? (
        pending.isPending ? <ListSkeleton /> : pending.isError ? (
          <LoadError message={apiErrorMessage(pending.error, t("loadFailed"))} onRetry={() => void pending.refetch()} />
        ) : pending.data.items.length === 0 ? (
          <p className="rounded-card border border-line bg-card px-5 py-6 text-center text-[13px] text-muted shadow-card">{t("empty")}</p>
        ) : (
          <div className="space-y-3">
            {pending.data.items.map((r) => <RequestCard key={r.id} request={r} focused={r.id === focusId} />)}
          </div>
        )
      ) : history.isPending ? <ListSkeleton /> : history.isError ? (
        <LoadError message={apiErrorMessage(history.error, t("loadFailed"))} onRetry={() => void history.refetch()} />
      ) : historyItems.length === 0 ? (
        <p className="rounded-card border border-line bg-card px-5 py-6 text-center text-[13px] text-muted shadow-card">{t("emptyHistory")}</p>
      ) : (
        <div className="space-y-3">
          {historyItems.map((r) => <RequestCard key={r.id} request={r} focused={r.id === focusId} />)}
          {history.hasNextPage && (
            <div className="text-center">
              <Button variant="secondary" size="sm" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                {t("loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1].map((i) => <Skeleton key={i} className="h-40 w-full rounded-card" />)}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations("adminConfigApproval");
  return (
    <Banner tone="bad" action={<Button size="sm" variant="secondary" onClick={onRetry}>{t("retry")}</Button>}>{message}</Banner>
  );
}

/** One request: who asked, why, what changes, and the decision controls. */
function RequestCard({ request, focused = false }: { request: ConfigChangeRequest; focused?: boolean }) {
  const t = useTranslations("adminConfigApproval");
  const locale = useLocale();
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const refresh = useRefreshConfigChanges();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  const decide = useMutation({
    mutationFn: (action: "approve" | "reject" | "cancel") => api.adminDecideConfigChange(request.id, action, note),
    onSuccess: (_, action) => {
      refresh(request.section);
      setNote("");
      toast.success(t(action === "approve" ? "approved" : action === "reject" ? "rejected" : "cancelled"));
    },
    onError: (err) => {
      // A stale or already-decided request changed state on the server: show it.
      refresh(request.section);
      toast.error(apiErrorMessage(err, t("actionFailed")));
    },
  });
  const reject = () => {
    if (!reasonOk(note)) { setNoteError(true); return; }
    decide.mutate("reject");
  };
  const pending = request.status === "pending";

  return (
    <article
      ref={ref}
      aria-labelledby={`change-${request.id}`}
      className={cn(
        "overflow-hidden rounded-card border bg-card shadow-card",
        focused ? "border-iris ring-2 ring-iris/30" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raised/40 px-5 py-3">
        <h2 id={`change-${request.id}`} className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-fg">
          {request.section_label}
          <Tag tone={STATUS_TONE[request.status]}>{t(`status.${request.status}`)}</Tag>
        </h2>
        {request.href && (
          <Link href={request.href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">
            {t("openSettings")} <ArrowRight size={14} />
          </Link>
        )}
      </header>
      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-x-10">
        <div className="space-y-1.5 text-[12.5px]">
          <p className="text-muted">{t("requestedBy", { who: personLabel(request.requested_by), at: formatDateTime(request.requested_at, locale) })}</p>
          {pending && <p className="text-faint">{t("expires", { at: formatDateTime(request.expires_at, locale) })}</p>}
          <p className="text-fg"><span className="text-muted">{t("reasonLabel")}: </span>{request.reason}</p>
          {!pending && request.decided_at && (
            <p className="text-muted">
              {t(`status.${request.status}`)} · {t("decidedBy", { who: request.decided_by ? personLabel(request.decided_by) : "—", at: formatDateTime(request.decided_at, locale) })}
            </p>
          )}
          {request.decision_note && <p className="text-fg"><span className="text-muted">{t("decisionNote")}: </span>{request.decision_note}</p>}
        </div>
        <div className="min-w-0"><ChangeRows request={request} /></div>
      </div>
      {pending && (request.can_approve || request.can_cancel) && (
        <footer className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-3">
          {request.can_approve ? (
            <>
              <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-[12px] font-medium text-muted">{t("noteLabel")}</span>
                <Input
                  value={note}
                  maxLength={1000}
                  onChange={(e) => { setNote(e.target.value); setNoteError(false); }}
                  placeholder={t("notePlaceholder")}
                  aria-invalid={noteError}
                  className="h-10 text-[13px]"
                />
                {noteError && <span role="alert" className="text-[12px] text-bad">{t("noteRequired")}</span>}
              </label>
              <div className="flex gap-2">
                <Button variant="danger" disabled={decide.isPending} loading={decide.isPending && decide.variables === "reject"} onClick={reject}>
                  {t("reject")}
                </Button>
                <Button disabled={decide.isPending} loading={decide.isPending && decide.variables === "approve"} onClick={() => decide.mutate("approve")}>
                  {t("approve")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="flex-1 text-[12.5px] text-muted">{t("mineHint")}</p>
              <Button variant="secondary" loading={decide.isPending} onClick={() => decide.mutate("cancel")}>{t("cancel")}</Button>
            </>
          )}
        </footer>
      )}
    </article>
  );
}
