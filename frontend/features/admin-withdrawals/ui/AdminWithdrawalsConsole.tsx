"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { WithdrawRequest } from "@/lib/types";
import { Button, CopyButton, Input, Spinner, Tag, Textarea } from "@/components/ui";
import { ConfirmModal } from "@/components/admin";
import { StepProgress } from "@/components/patterns/StepProgress";
import { useToast } from "@/components/toast";
import { ImageUploader, type UploaderImage } from "@/components/media/ImageUploader";
import { ImageStrip } from "@/components/media/ImageStrip";
import { privateImageBase, privateImageSource } from "@/lib/media";
import { Clock, RefreshCw, Search, X } from "@/components/Icons";

type StatusKey = "pending" | "approved" | "paid" | "rejected" | "all";

const TABS: { key: StatusKey; label: string; hint: string }[] = [
  { key: "pending", label: "1 · Chờ duyệt", hint: "Kiểm tra người bán và thông tin ngân hàng rồi duyệt hoặc từ chối. Tiền đang khoá trong ví người bán" },
  { key: "approved", label: "2 · Chờ chuyển khoản", hint: "Đã duyệt: chuyển khoản trên app ngân hàng rồi bấm “Xác nhận đã chuyển”. Tiền vẫn khoá tới lúc đó; sai thông tin thì vẫn từ chối được" },
  { key: "paid", label: "3 · Đã chuyển", hint: "Đã chuyển khoản và ghi sổ: tiền đã rời sàn" },
  { key: "rejected", label: "Từ chối", hint: "Tiền đã trả lại số dư khả dụng của người bán" },
  { key: "all", label: "Tất cả", hint: "" },
];

const STATUS_META: Record<string, { label: string; tone: "warn" | "iris" | "good" | "bad" | "neutral" }> = {
  pending: { label: "Chờ duyệt", tone: "warn" },
  approved: { label: "Chờ chuyển khoản", tone: "iris" },
  paid: { label: "Đã chuyển", tone: "good" },
  rejected: { label: "Từ chối", tone: "bad" },
};

const FLOW_STEPS = ["Gửi yêu cầu", "Duyệt", "Chuyển khoản"];
const FLOW_INDEX: Record<string, number> = { pending: 0, approved: 1, paid: 2, rejected: 1 };

/** Pending work older than this is flagged — sellers wait on it. */
const SLOW_MS = 24 * 3_600_000;

const QUERY_KEY = ["admin", "withdrawals"] as const;

const netOf = (r: WithdrawRequest) => r.net_amount ?? r.amount - (r.fee_amount ?? 0);
const isOpen = (r: WithdrawRequest) => r.status === "pending" || r.status === "approved";

function waitLabel(iso: string): string {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ`;
  const d = Math.floor(h / 24);
  return `${d} ngày${h % 24 ? ` ${h % 24} giờ` : ""}`;
}

function parseStatus(v: string | null): StatusKey {
  return TABS.some((t) => t.key === v) ? (v as StatusKey) : "pending";
}

function useWithdrawalsUrl() {
  const searchParams = useSearchParams();
  const status = parseStatus(searchParams.get("status"));
  const q = searchParams.get("q") ?? "";
  const set = React.useCallback((patch: { status?: StatusKey; q?: string }) => {
    const next = new URLSearchParams(window.location.search);
    if (patch.status !== undefined) {
      if (patch.status === "pending") next.delete("status"); else next.set("status", patch.status);
    }
    if (patch.q !== undefined) {
      if (patch.q.trim()) next.set("q", patch.q.trim()); else next.delete("q");
    }
    const qs = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);
  return { status, q, set };
}

function matches(r: WithdrawRequest, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase().replace(/^#/, "");
  return [
    String(r.id), String(r.account_id), r.account_email, r.bank_name,
    r.bank_account_number, r.bank_account_holder, r.payout_reference,
  ].some((v) => v != null && v.toLowerCase().includes(needle));
}

export function AdminWithdrawalsConsole() {
  const apiErrorMessage = useApiErrorMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { status, q, set } = useWithdrawalsUrl();
  const [searchDraft, setSearchDraft] = React.useState(q);

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => api.adminWithdrawals() });
  const requests = React.useMemo(() => query.data ?? [], [query.data]);

  const [approveTarget, setApproveTarget] = React.useState<WithdrawRequest | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<WithdrawRequest | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [paidTarget, setPaidTarget] = React.useState<WithdrawRequest | null>(null);
  const [payoutRef, setPayoutRef] = React.useState("");
  const [receipts, setReceipts] = React.useState<UploaderImage[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const id = window.setTimeout(() => { if (searchDraft.trim() !== q) set({ q: searchDraft }); }, 250);
    return () => window.clearTimeout(id);
  }, [searchDraft, q, set]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const counts = React.useMemo(() => {
    const c: Record<StatusKey, number> = { pending: 0, approved: 0, paid: 0, rejected: 0, all: requests.length };
    for (const r of requests) if (r.status in c) c[r.status as StatusKey] += 1;
    return c;
  }, [requests]);

  const summary = React.useMemo(() => {
    const pending = requests.filter((r) => r.status === "pending");
    const approved = requests.filter((r) => r.status === "approved");
    const oldest = requests.filter(isOpen).reduce<string | null>(
      (min, r) => (min === null || r.created_at < min ? r.created_at : min), null,
    );
    return {
      pendingAmount: pending.reduce((s, r) => s + r.amount, 0),
      toPayAmount: approved.reduce((s, r) => s + netOf(r), 0),
      oldest,
    };
  }, [requests]);

  const rows = React.useMemo(() => {
    const list = requests.filter((r) => (status === "all" || r.status === status) && matches(r, q));
    // Open work is a queue: oldest first. History reads newest first.
    const fifo = status === "pending" || status === "approved";
    return [...list].sort((a, b) => (fifo ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  }, [requests, status, q]);

  const handleApprove = async () => {
    if (!approveTarget) return;
    setBusy(true);
    try {
      await api.approveWithdrawal(approveTarget.id);
      toast.success(`Đã duyệt yêu cầu #${approveTarget.id}. Chuyển khoản rồi bấm “Xác nhận đã chuyển”.`);
      setApproveTarget(null);
      void refresh();
    } catch (err) {
      toast.error({ title: "Duyệt thất bại", description: apiErrorMessage(err, "Lỗi không xác định") });
    } finally {
      setBusy(false);
    }
  };

  const closePaid = () => { setPaidTarget(null); setPayoutRef(""); setReceipts([]); };
  const handleMarkPaid = async () => {
    // Mã tham chiếu = số bút toán trên app bank sau khi admin chuyển tay —
    // bắt buộc để đối soát sao kê về sau; ảnh biên lai để seller tự đối chiếu.
    if (!paidTarget || !payoutRef.trim()) return;
    setBusy(true);
    try {
      await api.markWithdrawalPaid(paidTarget.id, payoutRef.trim(), receipts.map((image) => image.id));
      toast.success(`Đã ghi nhận chuyển khoản cho yêu cầu #${paidTarget.id}. Tiền đã rời sàn.`);
      closePaid();
      void refresh();
    } catch (err) {
      toast.error({ title: "Xác nhận chuyển khoản thất bại", description: apiErrorMessage(err, "Lỗi không xác định") });
    } finally {
      setBusy(false);
    }
  };

  const closeReject = () => { setRejectTarget(null); setRejectReason(""); };
  const handleReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await api.rejectWithdrawal(rejectTarget.id, reason);
      toast.success(`Đã từ chối yêu cầu #${rejectTarget.id}.`);
      closeReject();
      void refresh();
    } catch (err) {
      toast.error({ title: "Từ chối thất bại", description: apiErrorMessage(err, "Lỗi không xác định") });
    } finally {
      setBusy(false);
    }
  };

  const actions = (r: WithdrawRequest) =>
    r.status === "pending" ? (
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRejectTarget(r)}>Từ chối</Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => setApproveTarget(r)}>Duyệt</Button>
      </div>
    ) : r.status === "approved" ? (
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRejectTarget(r)}>Từ chối</Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => setPaidTarget(r)}>Xác nhận đã chuyển…</Button>
      </div>
    ) : null;

  const activeTab = TABS.find((t) => t.key === status);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi
          label="Chờ duyệt"
          value={`${counts.pending.toLocaleString("vi-VN")} yêu cầu`}
          sub={vnd(summary.pendingAmount)}
          tone={counts.pending > 0 ? "warn" : "neutral"}
        />
        <Kpi
          label="Cần chuyển khoản"
          value={`${counts.approved.toLocaleString("vi-VN")} yêu cầu`}
          sub={`${vnd(summary.toPayAmount)} thực chi`}
          tone={counts.approved > 0 ? "iris" : "neutral"}
        />
        <Kpi
          label="Chờ lâu nhất"
          value={summary.oldest ? waitLabel(summary.oldest) : "—"}
          sub={summary.oldest ? `từ ${formatDateTime(summary.oldest, "vi")}` : "Không có yêu cầu đang mở"}
          tone={summary.oldest && Date.now() - new Date(summary.oldest).getTime() > SLOW_MS ? "bad" : "neutral"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Trạng thái yêu cầu">
          {TABS.map((t) => {
            const on = status === t.key;
            const n = counts[t.key];
            const urgent = (t.key === "pending" || t.key === "approved") && n > 0;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => set({ status: t.key })}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
                  on ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-card text-muted hover:text-fg",
                )}
              >
                {t.label}
                <span className={cn(
                  "rounded px-1 font-mono text-[11px] tabular-nums",
                  urgent && !on ? "bg-warn-soft text-warn" : "",
                )}>
                  {n.toLocaleString("vi-VN")}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Email, #id, số tài khoản, mã tham chiếu"
            aria-label="Tìm yêu cầu rút tiền"
            className="h-9 w-full rounded-lg border border-line bg-card pl-9 pr-8 text-[13px] text-fg placeholder:text-faint focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/30"
          />
          {searchDraft && (
            <button
              type="button"
              aria-label="Xoá tìm kiếm"
              onClick={() => setSearchDraft("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-fg"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={query.isFetching} aria-label="Tải lại">
          <RefreshCw size={14} className={cn(query.isFetching && "animate-spin")} />
          <span className="hidden sm:inline">Tải lại</span>
        </Button>
      </div>

      <FlowGuide active={status} />
      {activeTab?.hint && (
        <p className="text-[12.5px] text-muted">
          {activeTab.hint}.{(status === "pending" || status === "approved") && " Hàng đợi xếp theo yêu cầu cũ nhất trước."}
        </p>
      )}

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        {query.isPending ? (
          <Spinner label="Đang tải yêu cầu rút tiền…" />
        ) : query.isError ? (
          <div className="px-5 py-12 text-center text-[13px] text-bad">
            Không tải được danh sách yêu cầu rút tiền: {apiErrorMessage(query.error, "Lỗi không xác định")}
            <Button size="sm" variant="secondary" className="ml-2" onClick={() => void query.refetch()}>Thử lại</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-fg">
              {q ? "Không có yêu cầu nào khớp tìm kiếm." : status === "pending" || status === "approved" ? "Không còn việc tồn — đã xử lý hết." : "Chưa có yêu cầu nào ở mục này."}
            </p>
            {q && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSearchDraft("")}>Xoá tìm kiếm</Button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Requester r={r} />
                      <RequestMeta r={r} />
                    </div>
                    <StatusTag status={r.status} />
                  </div>
                  <StepProgress steps={FLOW_STEPS} current={FLOW_INDEX[r.status] ?? 0} stopped={r.status === "rejected"} stoppedLabel="Từ chối" />
                  <Amount r={r} align="left" />
                  <BankBlock r={r} />
                  <Outcome r={r} />
                  {actions(r) && <div className="flex justify-end">{actions(r)}</div>}
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead className="bg-raised/40 text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Người yêu cầu</th>
                    <th className="px-4 py-2.5 font-medium">Nhận tiền tại</th>
                    <th className="px-4 py-2.5 text-right font-medium">Số tiền</th>
                    <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-4 py-2.5 text-right font-medium">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top transition-colors hover:bg-raised/40">
                      <td className="max-w-[260px] px-4 py-3">
                        <Requester r={r} />
                        <RequestMeta r={r} />
                      </td>
                      <td className="px-4 py-3"><BankBlock r={r} /></td>
                      <td className="px-4 py-3"><Amount r={r} align="right" /></td>
                      <td className="max-w-[300px] px-4 py-3">
                        <StepProgress steps={FLOW_STEPS} current={FLOW_INDEX[r.status] ?? 0} stopped={r.status === "rejected"} stoppedLabel="Từ chối" />
                        <Outcome r={r} className="mt-1.5" />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{actions(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={approveTarget !== null}
        onClose={() => setApproveTarget(null)}
        onConfirm={handleApprove}
        title="Duyệt yêu cầu rút tiền"
        description="Duyệt là đồng ý chi. Tiền vẫn khoá trong ví người bán và chưa rời sàn cho tới khi bạn chuyển khoản rồi bấm “Xác nhận đã chuyển”. Nếu phát hiện sai thông tin ngân hàng, vẫn từ chối được ở bước sau."
        confirmText="Duyệt"
        variant="primary"
        isLoading={busy}
      >
        {approveTarget && <RequestSummary r={approveTarget} />}
      </ConfirmModal>

      <ConfirmModal
        isOpen={paidTarget !== null}
        onClose={closePaid}
        onConfirm={handleMarkPaid}
        title="Xác nhận đã chuyển khoản"
        description="Chỉ bấm sau khi tiền đã chuyển thật. Lúc này tiền rời sàn và được ghi sổ (số thực chuyển + phí rút về ví sàn); bước này không hoàn tác được. Nhập mã giao dịch trên app ngân hàng để đối soát sao kê."
        confirmText="Xác nhận đã chuyển"
        variant="primary"
        isLoading={busy}
        confirmDisabled={!payoutRef.trim()}
      >
        <div className="space-y-3">
          {paidTarget && <RequestSummary r={paidTarget} />}
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-fg">Mã tham chiếu giao dịch <span className="text-bad">*</span></span>
            <Input value={payoutRef} onChange={(e) => setPayoutRef(e.target.value)} placeholder="VD: FT24270123456" maxLength={100} />
          </label>
          <ImageUploader purpose="payout_receipt" value={receipts} onChange={setReceipts} max={3} label="Ảnh biên lai chuyển khoản" />
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={rejectTarget !== null}
        onClose={closeReject}
        onConfirm={handleReject}
        title="Từ chối yêu cầu rút tiền"
        description="Toàn bộ số tiền đang khoá (kể cả phí rút) trả về số dư khả dụng của người bán. Hãy nêu lý do để họ biết phải sửa gì."
        confirmText="Từ chối"
        variant="danger"
        isLoading={busy}
        confirmDisabled={!rejectReason.trim()}
      >
        <div className="space-y-3">
          {rejectTarget && <RequestSummary r={rejectTarget} />}
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-fg">Lý do từ chối <span className="text-bad">*</span></span>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="VD: Tên chủ tài khoản không khớp với hồ sơ người bán"
              rows={3}
            />
          </label>
        </div>
      </ConfirmModal>
    </div>
  );
}

const KPI_TONES = {
  neutral: "text-fg",
  warn: "text-warn",
  iris: "text-iris-hi",
  bad: "text-bad",
} as const;

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: keyof typeof KPI_TONES }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3 shadow-card">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn("mt-1 text-[18px] font-semibold tabular-nums", KPI_TONES[tone])}>{value}</div>
      <div className="mt-0.5 truncate font-mono text-[12px] tabular-nums text-muted">{sub}</div>
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "neutral" as const };
  return <Tag tone={meta.tone}>{meta.label}</Tag>;
}

function Requester({ r }: { r: WithdrawRequest }) {
  return (
    <Link
      href={`/admin/accounts/${r.account_id}`}
      className="block truncate font-medium text-fg hover:text-iris-hi hover:underline"
      title={r.account_email ?? undefined}
    >
      {r.account_email ?? `Tài khoản #${r.account_id}`}
    </Link>
  );
}

function RequestMeta({ r }: { r: WithdrawRequest }) {
  const slow = isOpen(r) && Date.now() - new Date(r.created_at).getTime() > SLOW_MS;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint">
      <span className="font-mono">#{r.id}</span>
      <span>{formatDateTime(r.created_at, "vi")}</span>
      {isOpen(r) && (
        <span className={cn("inline-flex items-center gap-1", slow ? "font-medium text-bad" : "text-muted")}>
          <Clock size={11} />chờ {waitLabel(r.created_at)}
        </span>
      )}
    </div>
  );
}

function BankBlock({ r }: { r: WithdrawRequest }) {
  if (!r.bank_account_number) return <span className="text-[12px] text-faint">Chưa có thông tin ngân hàng</span>;
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-[12px] text-muted">{r.bank_name ?? "—"}</div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] tabular-nums text-fg">{r.bank_account_number}</span>
        <CopyButton text={r.bank_account_number} />
      </div>
      {r.bank_account_holder && <div className="text-[12px] font-medium uppercase text-fg">{r.bank_account_holder}</div>}
    </div>
  );
}

function Amount({ r, align }: { r: WithdrawRequest; align: "left" | "right" }) {
  const fee = r.fee_amount ?? 0;
  return (
    <div className={cn("font-mono tabular-nums", align === "right" ? "text-right" : "text-left")}>
      <div className="text-[14px] font-semibold text-fg">{vnd(r.amount)}</div>
      {fee > 0 && (
        <>
          <div className="text-[11.5px] text-faint">phí −{vnd(fee)}</div>
          <div className="text-[12px] text-muted">thực chi <span className="font-semibold text-fg">{vnd(netOf(r))}</span></div>
        </>
      )}
    </div>
  );
}

function Outcome({ r, className }: { r: WithdrawRequest; className?: string }) {
  const hasReceipts = !!r.receipt_images && r.receipt_images.length > 0;
  if (!r.payout_reference && !r.reject_reason && !hasReceipts && !r.paid_at) return null;
  return (
    <div className={cn("space-y-1 text-[11.5px] text-muted", className)}>
      {r.paid_at && <div>Chi lúc {formatDateTime(r.paid_at, "vi")}</div>}
      {r.payout_reference && (
        <div className="flex items-center gap-2">
          <span className="truncate font-mono">Ref: {r.payout_reference}</span>
          <CopyButton text={r.payout_reference} />
        </div>
      )}
      {hasReceipts && (
        <ImageStrip
          size="sm"
          title={`Biên lai chi trả #${r.id}`}
          images={r.receipt_images!.map((image) => ({ ...privateImageSource(image, privateImageBase.adminWithdrawalReceipt(r.id)), id: image.id }))}
        />
      )}
      {r.reject_reason && <div className="whitespace-pre-line break-words text-bad">Lý do: {r.reject_reason}</div>}
    </div>
  );
}

/** Who / how much / where — shown inside each confirm dialog so the admin acts on the right row. */
function RequestSummary({ r }: { r: WithdrawRequest }) {
  const fee = r.fee_amount ?? 0;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-line bg-raised/40 px-3 py-2.5 text-[12.5px]">
      <dt className="text-muted">Yêu cầu</dt>
      <dd className="font-mono text-fg">#{r.id}</dd>
      <dt className="text-muted">Người yêu cầu</dt>
      <dd className="truncate text-fg">{r.account_email ?? `Tài khoản #${r.account_id}`}</dd>
      <dt className="text-muted">Số tiền</dt>
      <dd className="font-mono tabular-nums text-fg">{vnd(r.amount)}</dd>
      {fee > 0 && (
        <>
          <dt className="text-muted">Thực chi</dt>
          <dd className="font-mono font-semibold tabular-nums text-fg">{vnd(netOf(r))}</dd>
        </>
      )}
      {r.bank_account_number && (
        <>
          <dt className="text-muted">Ngân hàng</dt>
          <dd className="min-w-0 text-fg">
            <div>{r.bank_name ?? "—"}</div>
            <div className="flex items-center gap-2">
              <span className="font-mono tabular-nums">{r.bank_account_number}</span>
              <CopyButton text={r.bank_account_number} />
            </div>
            {r.bank_account_holder && <div className="uppercase">{r.bank_account_holder}</div>}
          </dd>
        </>
      )}
    </dl>
  );
}


/** Ba bước của một lệnh rút và tiền nằm ở đâu ở mỗi bước. */
function FlowGuide({ active }: { active: StatusKey }) {
  const steps: { key: StatusKey; title: string; money: string }[] = [
    { key: "pending", title: "1 · Người bán gửi yêu cầu", money: "Tiền chuyển từ khả dụng sang khoá" },
    { key: "approved", title: "2 · Admin duyệt", money: "Tiền vẫn khoá, chưa rời sàn" },
    { key: "paid", title: "3 · Admin chuyển khoản và xác nhận", money: "Tiền rời sàn, ghi sổ; phí rút về ví sàn" },
  ];
  return (
    <ol aria-label="Luồng rút tiền" className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
      {steps.map((st) => (
        <li key={st.key} className={cn("bg-card px-3 py-2", active === st.key && "bg-iris-soft")}>
          <div className={cn("text-[12.5px] font-semibold", active === st.key ? "text-iris-hi" : "text-fg")}>{st.title}</div>
          <div className="text-[11.5px] text-muted">{st.money}</div>
        </li>
      ))}
    </ol>
  );
}
