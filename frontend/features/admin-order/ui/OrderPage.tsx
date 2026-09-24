"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AdminCaseParty, AdminOrderActionKey, AdminOrderCase } from "@/lib/types";
import { Banner, Button, Card, Tag } from "@/components/ui";
import {
  AlertCircle, AlertTriangle, Check, ChevronLeft, Copy, ExternalLink, Eye, EyeOff, Info,
} from "@/components/Icons";
import { LogEntryDetail, RefChip, actorText, describeLog } from "@/features/admin-logs";
import {
  ACTIONS, ESCROW_LABEL, LEDGER_DIRECTION, RESOURCE_STATUS, STATUS_LABEL, TASK_STATUS,
  attention, formatVnd, fullDate, lifecycle, shortDate,
} from "../model";

// Written by the orders list when it opens an order (see admin/orders/page.tsx).
const LIST_MARK = "admin-orders:opened-from-list";

function Section({ title, aside, children, id }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <Card className="p-4 sm:p-5" id={id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13.5px] font-semibold text-fg">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

function statusTone(st: string): "good" | "bad" | "warn" | "iris" | "neutral" {
  return st === "completed" ? "good" : st === "refunded" || st === "cancelled" ? "bad" : st === "delivered" ? "iris" : "warn";
}

function CopyText({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button type="button" title="Chép" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* blocked */ }
    }} className="inline-flex items-center gap-1 text-faint hover:text-fg">
      {label && <span className="font-mono">{label}</span>}
      {done ? <Check size={12} className="text-good" /> : <Copy size={12} />}
    </button>
  );
}

function Stepper({ c }: { c: AdminOrderCase }) {
  const steps = lifecycle(c);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.key} className={cn(
          "relative rounded-lg border px-3 py-2",
          s.state === "done" && "border-good/30 bg-good-soft/40",
          s.state === "current" && "border-iris/40 bg-iris-soft/50",
          s.state === "failed" && "border-bad/30 bg-bad-soft/40",
          s.state === "todo" && "border-line bg-card",
        )}>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
            <span className={cn("grid h-4 w-4 place-items-center rounded-full text-[10px] text-white",
              s.state === "done" ? "bg-good" : s.state === "current" ? "bg-iris" : s.state === "failed" ? "bg-bad" : "bg-line-2")}>
              {s.state === "done" ? "✓" : s.state === "failed" ? "×" : i + 1}
            </span>
            Bước {i + 1}
          </p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-fg">{s.label}</p>
          <p className="text-[11px] text-faint">{s.at ? shortDate(s.at) : s.state === "current" ? "đang ở bước này" : "—"}</p>
        </li>
      ))}
    </ol>
  );
}

function ActionPanel({ c }: { c: AdminOrderCase }) {
  const qc = useQueryClient();
  const apiError = useApiErrorMessage();
  const [open, setOpen] = React.useState<AdminOrderActionKey | null>(null);
  const [note, setNote] = React.useState("");
  const [buyerMessage, setBuyerMessage] = React.useState("");
  const [days, setDays] = React.useState(3);
  const [confirming, setConfirming] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const state = new Map(c.actions.map((a) => [a.key, a]));

  React.useEffect(() => { setConfirming(false); setNote(""); setBuyerMessage(""); }, [open]);

  const run = useMutation({
    mutationFn: async (key: AdminOrderActionKey) => {
      const text = note.trim();
      switch (key) {
        case "release": return api.adminReleaseOrder(c.id, text);
        case "refund": return api.adminRefundOrder(c.id, text, buyerMessage.trim());
        case "extend_escrow": return api.adminExtendEscrow(c.id, days, text);
        case "retry_provision": return api.adminRetryProvision(c.id, text);
        case "revoke_gateway_key": return api.adminRevokeGatewayKey(c.id);
        default: return undefined;
      }
    },
    onSuccess: (_, key) => {
      setDone(ACTIONS.find((a) => a.key === key)?.label ?? "Đã thực hiện");
      setOpen(null);
      void qc.invalidateQueries({ queryKey: ["admin", "order-case", c.id] });
      void qc.invalidateQueries({ queryKey: ["admin", "orders"] });
      void qc.invalidateQueries({ queryKey: ["admin", "action-items"] });
      setTimeout(() => setDone(null), 4000);
    },
  });

  return (
    <Section title="Thao tác" aside={<span className="text-[11.5px] text-faint">{ESCROW_LABEL[c.money.escrow_state] ?? c.money.escrow_state}</span>}>
      {done && <Banner tone="good" className="mb-3">Đã thực hiện: {done}</Banner>}
      <ul className="space-y-1.5">
        {ACTIONS.map((a) => {
          const s = state.get(a.key);
          const enabled = !!s?.enabled;
          const expanded = open === a.key;
          return (
            <li key={a.key} className={cn("rounded-lg border", expanded ? "border-iris/50 bg-iris-soft/30" : "border-line")}>
              <button type="button" disabled={!enabled} onClick={() => setOpen(expanded ? null : a.key)} aria-expanded={expanded}
                className={cn("flex w-full items-start justify-between gap-2 px-3 py-2 text-left", !enabled && "cursor-not-allowed opacity-55")}>
                <span className="min-w-0">
                  <span className={cn("block text-[12.5px] font-semibold", a.tone === "danger" && enabled ? "text-bad" : "text-fg")}>{a.label}</span>
                  <span className="block text-[11.5px] leading-snug text-muted">{enabled ? a.hint : s?.reason}</span>
                </span>
              </button>
              {expanded && (
                <div className="space-y-2 border-t border-line px-3 py-3">
                  {a.key === "refund" && (
                    <label className="block text-[12px] text-muted">
                      Lý do hiển thị cho người mua (không bắt buộc)
                      <input value={buyerMessage} onChange={(e) => setBuyerMessage(e.target.value)} maxLength={500}
                        placeholder="Mặc định: Đơn đã được sàn huỷ và hoàn toàn bộ số tiền về ví của bạn."
                        className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[12.5px] focus:border-iris focus:outline-none" />
                    </label>
                  )}
                  {a.key === "extend_escrow" && (
                    <div className="flex flex-wrap gap-1">
                      {[1, 3, 7, 14].map((d) => (
                        <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
                          className={cn("rounded-md border px-2.5 py-1 text-[12px]", days === d ? "border-iris/50 bg-iris-soft text-iris-hi" : "border-line text-muted hover:bg-raised")}>
                          +{d} ngày
                        </button>
                      ))}
                    </div>
                  )}
                  {a.key !== "revoke_gateway_key" && (
                    <label className="block text-[12px] text-muted">
                      Lý do (ghi vào nhật ký){a.confirm && <span className="text-bad"> *</span>}
                      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000}
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[12.5px] focus:border-iris focus:outline-none" />
                    </label>
                  )}
                  {run.isError && <Banner tone="bad">{apiError(run.error)}</Banner>}
                  {a.confirm && confirming ? (
                    <div className="rounded-lg border border-bad/30 bg-bad-soft/40 p-2.5">
                      <p className="text-[12px] text-fg">{a.preview?.(c, { days })}</p>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant={a.tone === "danger" ? "danger" : "primary"} loading={run.isPending} onClick={() => run.mutate(a.key)}>Xác nhận</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Quay lại</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" block loading={!a.confirm && run.isPending}
                      disabled={a.confirm && a.key !== "revoke_gateway_key" && note.trim().length < 3}
                      onClick={() => (a.confirm ? setConfirming(true) : run.mutate(a.key))}>
                      {a.confirm ? "Tiếp tục" : a.label}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Notes({ c }: { c: AdminOrderCase }) {
  const qc = useQueryClient();
  const apiError = useApiErrorMessage();
  const [text, setText] = React.useState("");
  const add = useMutation({
    mutationFn: () => api.adminOrderNote(c.id, text.trim()),
    onSuccess: () => { setText(""); void qc.invalidateQueries({ queryKey: ["admin", "order-case", c.id] }); },
  });
  return (
    <Section title="Ghi chú nội bộ" aside={<span className="text-[11.5px] text-faint">Chỉ admin thấy</span>}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) add.mutate(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Ví dụ: đã gọi người bán, hẹn giao lại trước 18h"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] focus:border-iris focus:outline-none" />
        <Button size="sm" type="submit" loading={add.isPending} disabled={text.trim().length < 3}>Lưu</Button>
      </form>
      {add.isError && <Banner tone="bad" className="mt-2">{apiError(add.error)}</Banner>}
      <ul className="mt-3 space-y-2">
        {c.notes.length === 0 && <li className="text-[12px] text-faint">Chưa có ghi chú.</li>}
        {[...c.notes].reverse().map((n) => (
          <li key={n.id} className="rounded-lg bg-raised/60 px-3 py-2">
            <p className="whitespace-pre-wrap text-[12.5px] text-fg">{String((n.metadata ?? {}).note ?? "")}</p>
            <p className="mt-0.5 text-[11px] text-faint">{n.actor?.label ?? "admin"} · {fullDate(n.created_at)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Party({ role, p, stats }: { role: string; p: AdminCaseParty | null; stats: [string, string, boolean?][] }) {
  if (!p) return null;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{role}</p>
          <Link href={p.href} className="block truncate text-[13.5px] font-semibold text-fg hover:text-iris-hi">{p.name}</Link>
          <p className="flex items-center gap-1 truncate text-[11.5px] text-faint">{p.email} <CopyText value={p.email} /></p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {p.is_internal && <Tag tone="iris">Nội bộ</Tag>}
          {!p.is_active && <Tag tone="bad">Đã khoá</Tag>}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12px]">
        {stats.map(([k, v, flag]) => (
          <React.Fragment key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className={cn("text-right font-mono tabular-nums", flag ? "font-semibold text-warn" : "text-fg")}>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="mt-2 flex gap-3 text-[12px]">
        <Link href={p.href} className="font-medium text-iris-hi hover:underline">Hồ sơ</Link>
        <Link href={`/admin/logs?account=${p.id}`} className="font-medium text-iris-hi hover:underline">Nhật ký</Link>
      </div>
    </div>
  );
}

function Events({ c }: { c: AdminOrderCase }) {
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [all, setAll] = React.useState(false);
  const rows = [...c.events].reverse();
  const shown = all ? rows : rows.slice(0, 12);
  if (!rows.length) return <p className="text-[12px] text-faint">Chưa có sự kiện hệ thống.</p>;
  return (
    <div>
      <ul className="-mx-4 divide-y divide-line/70 sm:-mx-5">
        {shown.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => setOpenId(openId === e.id ? null : e.id)} aria-expanded={openId === e.id}
              className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-raised/50 sm:px-5">
              <span className="w-24 shrink-0 font-mono text-[11px] text-faint">{shortDate(e.created_at)}</span>
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.level === "info" ? "bg-line-2" : e.level === "warning" ? "bg-warn" : "bg-bad")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-fg">{describeLog(e)}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                  {(e.actor || e.job_id) && <span>bởi {actorText(e)}</span>}
                  {e.refs.filter((r) => !(r.kind === "order" && r.id === c.id)).slice(0, 2).map((r) => <RefChip key={`${r.kind}-${r.id}`} r={r} compact />)}
                </span>
              </span>
            </button>
            {openId === e.id && <LogEntryDetail log={e} describe={describeLog} onTrace={() => {}} />}
          </li>
        ))}
      </ul>
      {rows.length > 12 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[12px] font-medium text-iris-hi hover:underline">
          {all ? "Thu gọn" : `Xem tất cả ${rows.length} sự kiện`}
        </button>
      )}
    </div>
  );
}

export function OrderPage({ id }: { id: number }) {
  const router = useRouter();
  const [reveal, setReveal] = React.useState(false);
  const q = useQuery({ queryKey: ["admin", "order-case", id], queryFn: () => api.adminOrderCase(id), refetchInterval: 60_000 });
  const c = q.data;

  React.useEffect(() => { window.scrollTo({ top: 0 }); }, [id]);

  // Opened from the list → real history back (the list restores its filters,
  // page and scroll from the URL). Opened from an alert, log or bookmark →
  // the last list view, or the plain list.
  const back = () => {
    let mark: { id?: number; url?: string } = {};
    try { mark = JSON.parse(sessionStorage.getItem(LIST_MARK) ?? "{}"); } catch { /* ignore */ }
    if (mark.id === id && window.history.length > 1) router.back();
    else if (mark.url) window.location.assign(mark.url);
    else router.push("/admin/orders");
  };

  if (q.isLoading) {
    return <div className="space-y-4" aria-busy="true">{[90, 110, 260, 320].map((h, i) => <div key={i} className="animate-pulse rounded-card border border-line bg-card" style={{ height: h }} />)}</div>;
  }
  if (q.isError || !c) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[14px] font-semibold text-fg">Không tải được đơn hàng</p>
        <div className="mt-3 flex justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => q.refetch()}>Thử lại</Button>
          <Link href="/admin/orders" className="inline-flex h-8 items-center px-3 text-[13px] text-iris-hi hover:underline">Về danh sách</Link>
        </div>
      </Card>
    );
  }

  const notices = attention(c);
  const br = c.buyer_record;
  const sr = c.seller_record;
  const inflow = c.ledger.filter((r) => LEDGER_DIRECTION[r.type] === "in").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={back} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
            <ChevronLeft size={14} /> Danh sách đơn hàng
          </button>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-[20px] font-semibold text-fg">
            <span className="font-mono">{c.order_code}</span>
            <CopyText value={c.order_code} />
            <Tag tone={statusTone(c.order_status)}>{STATUS_LABEL[c.order_status] ?? c.order_status}</Tag>
            {c.disputes.some((d) => d.status === "open") && <Tag tone="warn">Khiếu nại mở</Tag>}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {c.product_href ? <Link href={c.product_href} className="hover:text-iris-hi hover:underline">{c.product_title}</Link> : c.product_title}
            {c.variant_name ? ` · ${c.variant_name}` : ""} · {c.quantity} × · <span className="font-semibold text-fg">{formatVnd(c.total_amount)}</span> · đặt {fullDate(c.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.disputes.map((d) => (
            <Link key={d.id} href={d.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] text-fg hover:bg-raised">
              Hồ sơ khiếu nại <ExternalLink size={12} />
            </Link>
          ))}
        </div>
      </div>

      <Stepper c={c} />

      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.map((n) => {
            const Icon = n.tone === "bad" ? AlertCircle : n.tone === "warn" ? AlertTriangle : Info;
            return (
              <div key={n.text} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px]",
                n.tone === "bad" ? "border-bad/30 bg-bad-soft/50 text-bad" : n.tone === "warn" ? "border-warn/30 bg-warn-soft/50 text-warn" : "border-iris/25 bg-iris-soft/40 text-iris-hi")}>
                <Icon size={15} className="mt-0.5 shrink-0" />
                <span className="flex-1 text-fg">{n.text}</span>
                {n.href && <Link href={n.href} className="shrink-0 font-medium underline">{n.cta}</Link>}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Section title="Tiền & sổ cái" aside={<span className="text-[11.5px] text-faint">{ESCROW_LABEL[c.money.escrow_state] ?? c.money.escrow_state}</span>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Người mua trả", formatVnd(inflow || c.money.total)],
                ["Đã hoàn", formatVnd(c.money.refunded)],
                ["Người bán nhận", c.money.projected_seller_payout !== null ? `${formatVnd(c.money.projected_seller_payout)} (dự kiến)` : formatVnd(c.money.released_to_seller)],
                ["Phí sàn", c.money.projected_platform_fee !== null ? `${formatVnd(c.money.projected_platform_fee)} (${c.money.fee_percent}%)` : formatVnd(c.money.platform_fee)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-raised/60 px-3 py-2">
                  <p className="text-[11px] text-faint">{k}</p>
                  <p className="mt-0.5 font-mono text-[13.5px] font-semibold text-fg">{v}</p>
                </div>
              ))}
            </div>
            {c.money.escrow_state === "held" && c.money.escrow_expires_at && (
              <p className={cn("mt-2 text-[12px]", c.money.escrow_overdue ? "text-bad" : "text-muted")}>
                Tự động giải ngân lúc {fullDate(c.money.escrow_expires_at)} nếu không có khiếu nại.
              </p>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] text-faint">
                    <th className="py-1.5 pr-2 font-medium">Thời điểm</th>
                    <th className="py-1.5 pr-2 font-medium">Bút toán</th>
                    <th className="py-1.5 pr-2 font-medium">Ví</th>
                    <th className="py-1.5 text-right font-medium">Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {c.ledger.length === 0 && <tr><td colSpan={4} className="py-2 text-faint">Chưa có bút toán.</td></tr>}
                  {c.ledger.map((r) => {
                    const dir = LEDGER_DIRECTION[r.type] ?? "neutral";
                    return (
                      <tr key={r.id} className="border-b border-line/70 last:border-0">
                        <td className="py-1.5 pr-2 font-mono text-[11.5px] text-faint">{shortDate(r.created_at)}</td>
                        <td className="py-1.5 pr-2 text-fg">{r.label}</td>
                        <td className="py-1.5 pr-2 text-muted">
                          {r.account_id === 1 ? "Ví sàn" : <Link href={`/admin/accounts?account=${r.account_id}`} className="hover:text-iris-hi hover:underline">{r.account_label}</Link>}
                          <span className="text-faint"> · {r.role}</span>
                        </td>
                        <td className={cn("py-1.5 text-right font-mono tabular-nums", dir === "in" ? "text-good" : dir === "out" ? "text-fg" : "text-muted")}>
                          {dir === "in" ? "+" : "−"}{formatVnd(r.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-faint">+ tiền vào ký quỹ · − tiền rời ký quỹ (tới người bán, sàn, người mua hoặc affiliate).</p>
            </div>
          </Section>

          <Section title="Hàng đã giao" aside={<span className="text-[11.5px] text-faint">{c.lines.length} dòng · {c.delivery_mode === "manual" ? "giao thủ công" : "giao tự động"}</span>}>
            {c.lines.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11.5px] text-faint">
                      <th className="py-1.5 pr-2 font-medium">Dòng</th>
                      <th className="py-1.5 pr-2 font-medium">Trạng thái</th>
                      <th className="py-1.5 pr-2 font-medium">Hết hạn</th>
                      <th className="py-1.5 font-medium">Khiếu nại</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.lines.map((l) => (
                      <tr key={l.id} className="border-b border-line/70 last:border-0">
                        <td className="py-1.5 pr-2 font-mono font-semibold text-fg">{l.line}</td>
                        <td className="py-1.5 pr-2 text-muted">{RESOURCE_STATUS[l.status] ?? l.status}</td>
                        <td className="py-1.5 pr-2 text-muted">{l.expires_at ? shortDate(l.expires_at) : "—"}</td>
                        <td className="py-1.5">{l.claimed ? <Tag tone="warn">Bị khiếu nại</Tag> : <span className="text-faint">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12.5px] text-faint">{c.order_status === "pending" || c.order_status === "processing" ? "Chưa giao hàng." : "Đơn không giao theo dòng kho (dịch vụ/API)."}</p>
            )}
            {c.delivered_data && (
              <div className="mt-3">
                <button type="button" onClick={() => setReveal((v) => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-iris-hi hover:underline">
                  {reveal ? <EyeOff size={13} /> : <Eye size={13} />} {reveal ? "Ẩn dữ liệu đã giao" : "Xem dữ liệu đã giao"}
                </button>
                {reveal && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-raised/50 p-3 font-mono text-[11.5px] text-fg">{c.delivered_data}</pre>}
              </div>
            )}
            {c.tasks.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Tác vụ giao hàng</p>
                <ul className="mt-1 space-y-1 text-[12.5px]">
                  {c.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2">
                      <span className="text-fg">#{t.id} · {t.platform}{t.assignee ? ` · ${t.assignee}` : ""}</span>
                      <span className="text-muted">{TASK_STATUS[t.status] ?? t.status} · {shortDate(t.updated_at ?? t.created_at)}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/admin/tasks" className="mt-1 inline-block text-[12px] text-iris-hi hover:underline">Mở hàng đợi tác vụ</Link>
              </div>
            )}
            {c.usage && (
              <div className="mt-3 border-t border-line pt-3 text-[12.5px]">
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Gói request API</p>
                <div className="mt-1 flex items-center gap-3">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                    <span className="block h-full rounded-full bg-iris" style={{ width: `${c.usage.units_total ? (c.usage.units_used / c.usage.units_total) * 100 : 0}%` }} />
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-fg">
                    {c.usage.units_used.toLocaleString("vi-VN")} / {c.usage.units_total.toLocaleString("vi-VN")} đã dùng
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-faint">
                  Còn {c.usage.units_remaining.toLocaleString("vi-VN")} lượt{c.usage.expires_at ? ` · hết hạn ${shortDate(c.usage.expires_at)}` : ""}
                  {c.usage.gateway_calls?.length ? ` · ${c.usage.gateway_calls.length} lần gọi gần đây` : ""}
                </p>
              </div>
            )}
          </Section>

          {c.disputes.length > 0 && (
            <Section title="Khiếu nại">
              <ul className="space-y-2">
                {c.disputes.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-[12.5px] text-fg">{d.reason}</span>
                      <span className="text-[11.5px] text-faint">Mở {shortDate(d.created_at)}{d.resolved_at ? ` · đóng ${shortDate(d.resolved_at)}` : ""}</span>
                    </span>
                    <Link href={d.href} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-iris-hi hover:underline">
                      {d.status === "open" ? "Xử lý" : "Xem"} <ExternalLink size={12} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Diễn biến hệ thống" aside={<span className="text-[11.5px] text-faint">Bấm một dòng để xem chi tiết</span>}>
            <Events c={c} />
          </Section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <ActionPanel c={c} />
          <Section title="Hai bên">
            <div className="space-y-3">
              <Party role="Người mua" p={c.buyer} stats={[
                ["Đơn đã mua", br.paid_orders.toLocaleString("vi-VN")],
                ["Khiếu nại", `${br.other_disputes} (90 ngày: ${br.disputes_90d})`, br.disputes_90d >= 3],
                ["Được hoàn / bị từ chối", `${br.won} / ${br.rejected}`],
              ]} />
              <Party role="Người bán" p={c.seller} stats={[
                ["Hạng", c.seller?.tier ?? "—"],
                ["Đơn 90 ngày", sr.paid_orders_90d.toLocaleString("vi-VN")],
                ["Khiếu nại 90 ngày", `${sr.disputes_90d} · ${(sr.dispute_rate_90d * 100).toFixed(1)}%`, sr.paid_orders_90d >= 10 && sr.dispute_rate_90d >= 0.05],
                ["Quá hạn phản hồi", String(sr.timeouts_90d), sr.timeouts_90d >= 2],
              ]} />
            </div>
          </Section>
          <Notes c={c} />
          <Section title="Thông tin kỹ thuật">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-faint">Mã nội bộ</dt><dd className="font-mono text-muted">#{c.id}</dd>
              <dt className="text-faint">Nguồn hàng</dt>
              <dd>{c.provider ? <Link href={c.provider.href} className="text-iris-hi hover:underline">{c.provider.name}</Link> : <span className="text-muted">Kho người bán</span>}</dd>
              <dt className="text-faint">Chiến lược giá</dt><dd className="text-muted">{c.pricing_strategy ?? "—"}</dd>
              <dt className="text-faint">Loại dịch vụ</dt><dd className="text-muted">{c.service_type ?? "—"}</dd>
              <dt className="text-faint">SLA giao</dt><dd className="text-muted">{c.sla_hours ? `${c.sla_hours} giờ` : "—"}</dd>
              <dt className="text-faint">Tỷ giá lúc mua</dt><dd className="text-muted">{c.display_fx_rate_snapshot ? `${c.display_fx_rate_snapshot.toLocaleString("vi-VN")} ₫/USD` : "—"}</dd>
              <dt className="text-faint">Cập nhật</dt><dd className="text-muted">{fullDate(c.updated_at)}</dd>
              {c.cancel_reason && <><dt className="text-faint">Lý do huỷ</dt><dd className="text-muted">{c.cancel_reason}</dd></>}
            </dl>
            {c.user_config && Object.keys(c.user_config).length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] text-iris-hi">Tuỳ chọn người mua đã chọn</summary>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-muted">{JSON.stringify(c.user_config, null, 2)}</pre>
              </details>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
