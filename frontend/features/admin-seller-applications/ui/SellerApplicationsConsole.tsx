"use client";

/** Admin › Đơn đăng ký nhà bán: a review queue on the left and the selected
 *  application's case file on the right. Decisions are held ~8 s behind an
 *  undo bar (see useDeferredDecisions); J/K/A/I/R drive the queue. */

import * as React from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AdminSellerApplicationRow, Category } from "@/lib/types";
import { Button, Input, Spinner, Tag } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Clock, Inbox, RotateCcw, Search } from "@/components/Icons";
import { applicationKeys, useApplicationDetail, useApplicationQueue, useDeferredDecisions, type Decision, type PendingDecision } from "../data";
import {
  EXPERIENCE_LABEL, formatWait, isTypingTarget, neighbourAfterRemoval, OVERDUE_HOURS, parseQueueUrl, QUEUE_TABS, queueUrlSearch,
  SELLER_TYPE_LABEL, shortcutAction, stepId, UNDO_MS, waitHours, type QueueUrlState,
} from "../model";
import { CaseFile } from "./CaseFile";
import { ApproveDialog, RejectDialog, RequestInfoDialog } from "./DecisionDialogs";

const DECISION_VERB: Record<Decision["kind"], string> = { approve: "Đã duyệt", reject: "Đã từ chối", info: "Đã yêu cầu bổ sung" };

function categoryNames(tree: Category[]): Map<number, string> {
  const names = new Map<number, string>();
  const walk = (list: Category[]) => list.forEach((c) => { names.set(c.id, c.name); walk(c.children ?? []); });
  walk(tree);
  return names;
}

function useQueueUrl() {
  const searchParams = useSearchParams();
  const state = React.useMemo(() => parseQueueUrl(new URLSearchParams(searchParams.toString())), [searchParams]);
  const write = React.useCallback((patch: Partial<QueueUrlState>, mode: "push" | "replace" = "replace") => {
    const current = new URLSearchParams(window.location.search);
    const qs = queueUrlSearch({ ...parseQueueUrl(current), ...patch }, current);
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);
  return { state, write };
}

export function SellerApplicationsConsole() {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const { state, write } = useQueueUrl();
  const [searchDraft, setSearchDraft] = React.useState(state.q);
  React.useEffect(() => { setSearchDraft(state.q); }, [state.q]);
  React.useEffect(() => {
    if (searchDraft === state.q) return;
    const t = setTimeout(() => write({ q: searchDraft, app: null }), 300);
    return () => clearTimeout(t);
  }, [searchDraft, state.q, write]);

  const { query, items, total, counts, avgReviewHours } = useApplicationQueue(state.status, state.q);
  const [hidden, setHidden] = React.useState<Set<number>>(new Set());
  const visible = React.useMemo(() => items.filter((r) => !hidden.has(r.id)), [items, hidden]);
  const ids = React.useMemo(() => visible.map((r) => r.id), [visible]);

  const selectedId = state.app;
  const selectedRow = visible.find((r) => r.id === selectedId) ?? null;
  const detail = useApplicationDetail(selectedId);
  // A deep link to an application outside the loaded page still opens its file.
  const row: AdminSellerApplicationRow | null = selectedRow ?? (detail.data && detail.data.id === selectedId && !hidden.has(selectedId) ? detail.data : null);

  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: () => api.categories(), staleTime: 5 * 60_000 });
  const names = React.useMemo(() => categoryNames(categoriesQ.data ?? []), [categoriesQ.data]);
  const categoryName = React.useCallback((id: number) => names.get(id) ?? `#${id}`, [names]);

  const select = React.useCallback((id: number | null, mode: "push" | "replace" = "push") => write({ app: id }, mode), [write]);

  const decisions = useDeferredDecisions({
    // A sent decision stays hidden: the refetched queue no longer lists it.
    onSent: () => {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.all });
    },
    onFailed: (p, e) => {
      setHidden((cur) => { const next = new Set(cur); next.delete(p.appId); return next; });
      toast.error(apiErrorMessage(e, `Không xử lý được đơn “${p.name}”`));
      void queryClient.invalidateQueries({ queryKey: applicationKeys.all });
    },
  });

  const decide = (target: AdminSellerApplicationRow, decision: Decision) => {
    const nextId = neighbourAfterRemoval(ids, target.id);
    setHidden((cur) => new Set(cur).add(target.id));
    decisions.schedule({ appId: target.id, name: target.business_name, decision });
    select(nextId === target.id ? null : nextId, "replace");
  };

  const undo = () => {
    const held = decisions.undo();
    if (!held) return;
    setHidden((cur) => { const next = new Set(cur); next.delete(held.appId); return next; });
    select(held.appId, "replace");
  };

  // Open the head of the queue on arrival so the reviewer lands on work, not a blank pane.
  React.useEffect(() => {
    if (selectedId === null && ids.length > 0 && !decisions.pending) select(ids[0], "replace");
  }, [selectedId, ids, decisions.pending, select]);

  const [dialog, setDialog] = React.useState<"approve" | "reject" | "info" | null>(null);
  const canApprove = row?.status === "pending";
  const canInfo = row?.status === "pending";
  const canReject = row?.status === "pending" || row?.status === "needs_info";

  // Keyboard: J/K move, A/I/R decide. Letters stay letters while typing or with a dialog open.
  const keyState = React.useRef({ ids, selectedId, row, canApprove, canInfo, canReject, dialog, decide });
  React.useEffect(() => { keyState.current = { ids, selectedId, row, canApprove, canInfo, canReject, dialog, decide }; });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      const k = keyState.current;
      if (k.dialog || document.querySelector("[role='dialog']")) return;
      const action = shortcutAction(e.key);
      if (!action) return;
      if (action === "next" || action === "prev") {
        const id = stepId(k.ids, k.selectedId, action === "next" ? 1 : -1);
        if (id !== null) { e.preventDefault(); select(id, "replace"); }
        return;
      }
      if (!k.row) return;
      if (action === "approve" && k.canApprove) { e.preventDefault(); setDialog("approve"); }
      if (action === "info" && k.canInfo) { e.preventDefault(); setDialog("info"); }
      if (action === "reject" && k.canReject) { e.preventDefault(); setDialog("reject"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  const idx = selectedId === null ? -1 : ids.indexOf(selectedId);

  return (
    <div className="space-y-4">
      <div className="-mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[13px] text-muted">
          {counts ? `${counts.pending} đơn cần xử lý` : "Đang tải hàng đợi…"}
          {avgReviewHours !== null && ` · thời gian duyệt trung bình ${formatWait(avgReviewHours)}`}
        </p>
        <p className="hidden text-[11.5px] text-faint md:block">
          Phím tắt: <kbd className="font-mono">J</kbd>/<kbd className="font-mono">K</kbd> chuyển đơn · <kbd className="font-mono">A</kbd> duyệt · <kbd className="font-mono">I</kbd> yêu cầu bổ sung · <kbd className="font-mono">R</kbd> từ chối
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* ------------------------------------------------ queue */}
        <aside className={cn("min-w-0 space-y-3", row && "hidden lg:block")} aria-label="Hàng đợi đơn">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Tên shop, email, SĐT" aria-label="Tìm đơn" className="h-9 pl-9 text-[12.5px]" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Trạng thái đơn">
            {QUEUE_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={state.status === t.key}
                onClick={() => { setHidden(new Set()); write({ status: t.key, app: null }); }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
                  state.status === t.key ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-card text-muted hover:text-fg",
                )}
              >
                {t.label}
                {counts && <span className="font-mono text-[11px] tabular-nums">{counts[t.key] ?? 0}</span>}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-faint">{state.status === "pending" ? "Chờ lâu nhất trước" : "Xử lý gần đây trước"}{query.isFetching && query.data ? " · đang tải…" : ""}</p>

          <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
            {query.isPending ? (
              <div className="grid place-items-center py-16"><Spinner /></div>
            ) : query.isError && !query.data ? (
              <div className="px-4 py-10 text-center text-[13px] text-bad">
                Không tải được hàng đợi.
                <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Thử lại</Button></div>
              </div>
            ) : visible.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Inbox size={20} className="mx-auto text-faint" />
                <p className="mt-2 text-[13px] font-medium text-fg">{state.q ? "Không có đơn nào khớp." : state.status === "pending" ? "Hết đơn cần xử lý." : "Chưa có đơn nào."}</p>
              </div>
            ) : (
              <ul className="max-h-[calc(100vh-280px)] divide-y divide-line overflow-y-auto">
                {visible.map((r) => <QueueItem key={r.id} row={r} active={r.id === selectedId} onSelect={() => select(r.id)} />)}
              </ul>
            )}
            {query.hasNextPage && (
              <div className="border-t border-line p-2">
                <Button size="sm" variant="ghost" block loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  Tải thêm ({Math.max(0, total - items.length)} còn lại)
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* ------------------------------------------------ case file */}
        <section className={cn("min-w-0", !row && "hidden lg:block")} aria-label="Hồ sơ đơn">
          {row ? (
            <div className="space-y-4">
              <CaseFile
                row={row}
                detail={detail}
                categoryName={categoryName}
                hasPrev={idx > 0}
                hasNext={idx !== -1 && idx < ids.length - 1}
                onPrev={() => { const id = stepId(ids, selectedId, -1); if (id !== null) select(id, "replace"); }}
                onNext={() => { const id = stepId(ids, selectedId, 1); if (id !== null) select(id, "replace"); }}
                onBack={() => select(null, "replace")}
              />
              {(canApprove || canReject) && (
                <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-card border border-line bg-card/95 p-3 shadow-card backdrop-blur">
                  {canReject && <Button variant="danger" onClick={() => setDialog("reject")}>Từ chối <Kbd>R</Kbd></Button>}
                  {canInfo && <Button variant="secondary" onClick={() => setDialog("info")}>Yêu cầu bổ sung <Kbd>I</Kbd></Button>}
                  {canApprove && <Button onClick={() => setDialog("approve")}>Duyệt & mở gian hàng <Kbd>A</Kbd></Button>}
                </div>
              )}
            </div>
          ) : selectedId !== null && detail.isPending ? (
            <div className="grid place-items-center rounded-card border border-line bg-card py-24"><Spinner /></div>
          ) : selectedId !== null && detail.isError ? (
            <div className="rounded-card border border-line bg-card px-4 py-16 text-center text-[13px] text-bad">
              Không mở được đơn #{selectedId}. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void detail.refetch()}>Thử lại</Button>
            </div>
          ) : (
            <div className="grid place-items-center rounded-card border border-dashed border-line bg-card py-24 text-center">
              <div>
                <p className="text-[13.5px] font-medium text-fg">{ids.length === 0 ? "Không có đơn nào ở đây" : "Chọn một đơn trong hàng đợi"}</p>
                {ids.length > 0 && <p className="mt-1 text-[12.5px] text-muted">hoặc nhấn <Kbd>J</Kbd> để mở đơn đầu tiên.</p>}
              </div>
            </div>
          )}
        </section>
      </div>

      <ApproveDialog
        app={row}
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        onConfirm={() => { if (row) decide(row, { kind: "approve" }); setDialog(null); }}
      />
      <RejectDialog
        app={row}
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        onConfirm={(reason, days) => { if (row) decide(row, { kind: "reject", reason, resubmitAfterDays: days }); setDialog(null); }}
      />
      <RequestInfoDialog
        app={row}
        open={dialog === "info"}
        onClose={() => setDialog(null)}
        onConfirm={(note, fields) => { if (row) decide(row, { kind: "info", note, fields }); setDialog(null); }}
      />

      {/* Portaled: an animated ancestor would otherwise anchor `fixed` to itself. */}
      {decisions.pending && typeof document !== "undefined" && createPortal(<UndoBar pending={decisions.pending} onUndo={undo} onSendNow={decisions.flush} />, document.body)}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-mono text-[10.5px] opacity-70 sm:inline">{children}</kbd>;
}

function QueueItem({ row, active, onSelect }: { row: AdminSellerApplicationRow; active: boolean; onSelect: () => void }) {
  const since = row.status === "pending" ? row.info_responded_at ?? row.created_at : row.reviewed_at ?? row.created_at;
  const hours = waitHours(since);
  const overdue = row.status === "pending" && hours > OVERDUE_HOURS;
  const meta = [row.seller_type && SELLER_TYPE_LABEL[row.seller_type], row.experience && EXPERIENCE_LABEL[row.experience]].filter(Boolean).join(" · ");
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active || undefined}
        className={cn(
          "block w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris/40",
          active ? "bg-iris-soft/50" : "hover:bg-raised/40",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-[13px] font-medium text-fg">{row.business_name}</span>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]", overdue ? "bg-bad-soft text-bad" : "text-faint")}>
            <Clock size={11} />{formatWait(hours)}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-muted">{row.applicant.email}</div>
        {meta && <div className="mt-0.5 truncate text-[11.5px] text-faint">{meta}</div>}
        {(row.risk_count > 0 || row.resubmitted || row.prior_rejections > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {row.risk_count > 0 && <Tag tone="bad">{row.risk_count} rủi ro</Tag>}
            {row.resubmitted && <Tag tone="iris">Đã bổ sung</Tag>}
            {row.prior_rejections > 0 && <Tag tone="warn">Nộp lần {row.prior_rejections + 1}</Tag>}
          </div>
        )}
      </button>
    </li>
  );
}

function UndoBar({ pending, onUndo, onSendNow }: { pending: PendingDecision; onUndo: () => void; onSendNow: () => void }) {
  const [left, setLeft] = React.useState(() => Math.max(0, pending.dueAt - Date.now()));
  React.useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, pending.dueAt - Date.now())), 250);
    return () => clearInterval(t);
  }, [pending.dueAt]);
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg items-center gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-card sm:inset-x-auto sm:right-6">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-fg">{DECISION_VERB[pending.decision.kind]} “{pending.name}”</p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full bg-iris transition-[width] duration-200" style={{ width: `${(left / UNDO_MS) * 100}%` }} />
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={onSendNow}>Gửi ngay</Button>
      <Button size="sm" variant="secondary" onClick={onUndo}><RotateCcw size={13} />Hoàn tác</Button>
    </div>
  );
}
