"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { displayTimelineEvents } from "@/lib/dispute-case";
import { describeLog } from "@/features/admin-logs";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AdminCaseAction, AdminDisputeCase, AdminLogEntry } from "@/lib/types";
import { Banner, Button, Card, Tag } from "@/components/ui";
import {
  AlertCircle, AlertTriangle, ChevronLeft, CheckCircle2, Clock, ExternalLink, Info, MessageCircle, Sparkles,
} from "@/components/Icons";
import {
  ACTIONS, ACTOR_META, EVENT_LABEL, EVIDENCE_LABEL, LINE_STATE, RESOURCE_STATUS, STATUS_META,
  caseDeadlines, countdown, dateTime, formatVnd, pct, suggestedAction,
} from "../model";

const SIGNAL_ICON = { good: CheckCircle2, info: Info, warn: AlertTriangle, bad: AlertCircle } as const;
const SIGNAL_TONE = { good: "text-good", info: "text-iris-hi", warn: "text-warn", bad: "text-bad" } as const;

function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[13.5px] font-semibold text-fg">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

function Assessment({ c, onPick }: { c: AdminDisputeCase; onPick: (a: AdminCaseAction) => void }) {
  const suggested = suggestedAction(c);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-iris-soft/40 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-iris-hi"><Sparkles size={13} /> {c.status === "open" ? "Gợi ý xử lý" : "Tóm tắt hồ sơ"}</p>
          <p className="mt-1 text-[14px] font-semibold leading-snug text-fg">{c.recommendation.text}</p>
        </div>
        {suggested && c.status === "open" && (
          <Button size="sm" onClick={() => onPick(suggested)}>
            Áp dụng gợi ý{c.recommendation.amount ? ` · ${formatVnd(c.recommendation.amount)}` : ""}
          </Button>
        )}
      </div>
      <ul className="grid gap-x-6 gap-y-2 px-4 py-3 sm:px-5 md:grid-cols-2">
        {c.signals.map((s) => {
          const Icon = SIGNAL_ICON[s.tone];
          return (
            <li key={s.code} className="flex gap-2 text-[12.5px] leading-relaxed text-fg">
              <Icon size={15} className={cn("mt-0.5 shrink-0", SIGNAL_TONE[s.tone])} />
              {s.text}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[11px] text-faint sm:px-5">
        Gợi ý dựa trên quy tắc: hạn phản hồi, dòng đã được khắc phục, lịch sử khiếu nại của hai bên. Quyết định cuối cùng là của bạn.
      </p>
    </Card>
  );
}

function Lines({ c }: { c: AdminDisputeCase }) {
  if (c.lines.length === 0) return <p className="text-[12.5px] text-faint">Đơn này không giao tài nguyên theo dòng (dịch vụ/API).</p>;
  const byId = new Map(c.lines.map((l) => [l.id, l]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left text-[11.5px] text-faint">
            <th className="py-1.5 pr-2 font-medium">Dòng</th>
            <th className="py-1.5 pr-2 font-medium">Tình trạng khiếu nại</th>
            <th className="py-1.5 pr-2 font-medium">Trạng thái kho</th>
            <th className="py-1.5 pr-2 font-medium">Hết hạn</th>
            <th className="py-1.5 font-medium">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l) => {
            // Once the case is closed, "waiting" no longer applies to a claimed line.
            const st = l.state === "claimed" && c.status !== "open" ? { label: "Bị khiếu nại", tone: "neutral" as const } : LINE_STATE[l.state];
            const replacement = l.replacement_resource_id ? byId.get(l.replacement_resource_id) : undefined;
            return (
              <tr key={l.id} className={cn("border-b border-line/70 last:border-0", l.state === "claimed" && "bg-warn-soft/30")}>
                <td className="py-1.5 pr-2 font-mono font-semibold text-fg">{l.line}</td>
                <td className="py-1.5 pr-2"><Tag tone={st.tone}>{st.label}</Tag></td>
                <td className="py-1.5 pr-2 text-muted">{RESOURCE_STATUS[l.status] ?? l.status}</td>
                <td className="py-1.5 pr-2 text-muted">{l.expires_at ? dateTime(l.expires_at) : "—"}</td>
                <td className="py-1.5 text-muted">
                  {l.state === "replaced" && (replacement ? `→ đổi bằng ${replacement.line}` : `→ đổi bằng #${l.replacement_resource_id}`)}
                  {l.state === "refunded" && `Hoàn ${formatVnd(l.refund_amount)}`}
                  {l.warranty_claimable && l.state === "ok" && "còn bảo hành"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ c }: { c: AdminDisputeCase }) {
  const lineOf = new Map(c.lines.map((l) => [l.id, l.line]));
  const events = displayTimelineEvents(c.timeline ?? []);
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {events.map((e) => {
        const actor = ACTOR_META[e.actor_role] ?? ACTOR_META.system;
        return (
          <li key={e.id} className="relative">
            <span aria-hidden className={cn("absolute -left-[21.5px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-card", actor.dot)} />
            <p className="text-[12.5px]">
              <span className="font-semibold text-fg">{actor.label}</span>{" "}
              <span className="text-muted">{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
              <span className="ml-2 text-[11.5px] text-faint">{dateTime(e.created_at)}</span>
            </p>
            {e.body && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-raised/70 px-3 py-2 text-[12.5px] text-fg">{e.body}</p>}
            {(e.resource_ids.length > 0 || e.refund_amount) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {e.resource_ids.map((id, i) => (
                  <span key={id} className="rounded border border-line bg-surface px-1.5 font-mono text-[11px] text-muted">
                    {lineOf.get(id) ?? `#${id}`}
                    {e.replacement_resource_ids?.[i] ? ` → ${lineOf.get(e.replacement_resource_ids[i]!) ?? `#${e.replacement_resource_ids[i]}`}` : ""}
                  </span>
                ))}
                {!!e.refund_amount && <span className="text-[11.5px] font-medium text-bad">Hoàn {formatVnd(e.refund_amount)}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function PartyCard({ role, c }: { role: "buyer" | "seller"; c: AdminDisputeCase }) {
  const p = role === "buyer" ? c.buyer : c.seller;
  if (!p) return null;
  const br = c.buyer_record;
  const sr = c.seller_record;
  const stats: [string, string, boolean?][] = role === "buyer"
    ? [
        ["Đơn đã mua", br.paid_orders.toLocaleString("vi-VN")],
        ["Khiếu nại khác", `${br.other_disputes} (90 ngày: ${br.disputes_90d})`, br.disputes_90d >= 3],
        ["Tỷ lệ khiếu nại", pct(br.dispute_rate), br.paid_orders >= 3 && br.dispute_rate >= 0.3],
        ["Được hoàn / bị từ chối", `${br.won} / ${br.rejected}`],
      ]
    : [
        ["Đơn 90 ngày", sr.paid_orders_90d.toLocaleString("vi-VN")],
        ["Khiếu nại 90 ngày", `${sr.disputes_90d} · ${pct(sr.dispute_rate_90d)}`, sr.paid_orders_90d >= 10 && sr.dispute_rate_90d >= 0.05],
        ["Đang mở", String(sr.open_disputes)],
        ["Quá hạn phản hồi", String(sr.timeouts_90d), sr.timeouts_90d >= 2],
        ["Phản hồi TB", sr.avg_response_hours === null ? "—" : `${sr.avg_response_hours} giờ`],
      ];
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{role === "buyer" ? "Người mua" : "Người bán"}</p>
          <p className="truncate text-[13.5px] font-semibold text-fg">{p.name}</p>
          <p className="truncate text-[11.5px] text-faint">{p.email}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {p.is_internal && <Tag tone="iris">Nội bộ</Tag>}
          {!p.is_active && <Tag tone="bad">Đã khoá</Tag>}
          {role === "seller" && <Tag tone="neutral">{p.tier}</Tag>}
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
      {role === "buyer" && br.recent.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-[11px] text-faint">Khiếu nại gần đây</p>
          <ul className="mt-1 space-y-0.5">
            {br.recent.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-[12px]">
                <Link href={d.href} className="font-mono text-iris-hi hover:underline">{d.order_code}</Link>
                <span className="text-faint">{STATUS_META[d.status]?.label ?? d.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link href={p.href} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-iris-hi hover:underline">
        Mở hồ sơ tài khoản <ExternalLink size={12} />
      </Link>
    </div>
  );
}

function DecisionPanel({ c, picked, setPicked }: { c: AdminDisputeCase; picked: AdminCaseAction | null; setPicked: (a: AdminCaseAction | null) => void }) {
  const qc = useQueryClient();
  const apiError = useApiErrorMessage();
  const [note, setNote] = React.useState("");
  const [amount, setAmount] = React.useState<number>(c.recommendation.amount ?? c.money.unit_price);
  const [days, setDays] = React.useState(7);
  const [confirming, setConfirming] = React.useState(false);
  React.useEffect(() => {
    if (picked === "partial_refund" && c.recommendation.action === "partial_refund" && c.recommendation.amount) setAmount(c.recommendation.amount);
    setConfirming(false);
  }, [picked, c.recommendation]);

  const run = useMutation({
    mutationFn: async () => {
      const text = note.trim();
      switch (picked) {
        case "refund": return api.refundDispute(c.id, text);
        case "reject": return api.rejectDispute(c.id, text);
        case "partial_refund": return api.partialRefundDispute(c.id, text, amount);
        case "replace": return api.replaceDispute(c.id, text);
        case "extend_warranty": return api.extendWarrantyDispute(c.id, text, days);
        default: throw new Error("Chọn cách xử lý");
      }
    },
    onSuccess: () => {
      setPicked(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["admin", "dispute-case", c.id] });
      void qc.invalidateQueries({ queryKey: ["admin", "disputes"] });
      void qc.invalidateQueries({ queryKey: ["admin", "action-items"] });
    },
  });

  if (c.status !== "open") {
    return (
      <Section title="Kết quả">
        <p className="text-[12.5px] text-fg"><Tag tone={STATUS_META[c.status]?.tone ?? "neutral"}>{STATUS_META[c.status]?.label ?? c.status}</Tag> lúc {dateTime(c.resolved_at)}</p>
        {c.admin_note && <p className="mt-2 rounded-lg bg-raised px-3 py-2 text-[12.5px] text-fg">{c.admin_note}</p>}
      </Section>
    );
  }
  const partialInvalid = picked === "partial_refund" && (!(amount > 0) || amount >= c.money.remaining_refundable);
  const def = ACTIONS.find((a) => a.key === picked);
  const suggested = suggestedAction(c);
  return (
    <Section title="Quyết định của sàn" aside={<span className="text-[11.5px] text-faint">Còn giữ {formatVnd(c.money.remaining_refundable)}</span>}>
      <div role="radiogroup" aria-label="Cách xử lý" className="space-y-1.5">
        {ACTIONS.map((a) => (
          <label key={a.key} className={cn(
            "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
            picked === a.key ? "border-iris/50 bg-iris-soft/50" : "border-line hover:bg-raised/60",
          )}>
            <input type="radio" name="dispute-action" className="mt-1 accent-[var(--color-iris)]" checked={picked === a.key} onChange={() => setPicked(a.key)} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
                {a.label}
                {suggested === a.key && <Tag tone="iris">Gợi ý</Tag>}
              </span>
              {picked === a.key && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{a.describe(c, amount)}</span>}
            </span>
          </label>
        ))}
      </div>

      {picked === "partial_refund" && (
        <label className="mt-3 block text-[12px] text-muted">
          Số tiền hoàn cho người mua
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={1} max={c.money.remaining_refundable - 1} step={1000} value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="h-9 w-full rounded-lg border border-line bg-surface px-2.5 font-mono text-[13px] focus:border-iris focus:outline-none" />
            <span className="shrink-0 text-[12px] text-faint">₫</span>
          </div>
          <span className="mt-1 flex flex-wrap gap-1">
            {[1, 2, 3].filter((n) => n * c.money.unit_price < c.money.remaining_refundable).map((n) => (
              <button key={n} type="button" onClick={() => setAmount(n * c.money.unit_price)}
                className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:bg-raised">{n} dòng · {formatVnd(n * c.money.unit_price)}</button>
            ))}
          </span>
          {partialInvalid && <span className="mt-1 block text-[11.5px] text-bad">Số tiền phải lớn hơn 0 và nhỏ hơn {formatVnd(c.money.remaining_refundable)}.</span>}
        </label>
      )}
      {picked === "extend_warranty" && (
        <label className="mt-3 block text-[12px] text-muted">
          Gia hạn thêm (ngày)
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2.5 font-mono text-[13px] focus:border-iris focus:outline-none" />
        </label>
      )}

      {picked && (
        <label className="mt-3 block text-[12px] text-muted">
          Ghi chú gửi hai bên <span className="text-bad">*</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000}
            placeholder="Lý do quyết định — người mua và người bán đều thấy ghi chú này."
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[12.5px] focus:border-iris focus:outline-none" />
        </label>
      )}

      {run.isError && <Banner tone="bad" className="mt-3">{apiError(run.error)}</Banner>}

      {picked && (
        confirming ? (
          <div className="mt-3 rounded-lg border border-bad/30 bg-bad-soft/40 p-3">
            <p className="text-[12.5px] font-semibold text-fg">Xác nhận: {def?.label}</p>
            <p className="mt-0.5 text-[12px] text-muted">{def?.describe(c, amount)} Không hoàn tác được.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="danger" loading={run.isPending} onClick={() => run.mutate()}>Xác nhận</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Quay lại</Button>
            </div>
          </div>
        ) : (
          <Button className="mt-3" block disabled={!note.trim() || partialInvalid} onClick={() => setConfirming(true)}>
            Tiếp tục
          </Button>
        )
      )}
    </Section>
  );
}

function OrderLogs({ orderId }: { orderId: number }) {
  const q = useQuery({ queryKey: ["admin", "logs", "order", orderId], queryFn: () => api.adminLogsFor({ order_id: orderId, limit: 50 }) });
  const rows: AdminLogEntry[] = q.data ?? [];
  if (q.isLoading) return <p className="text-[12px] text-faint">Đang tải…</p>;
  if (!rows.length) return <p className="text-[12px] text-faint">Chưa có sự kiện hệ thống cho đơn này.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
          <span className="font-mono text-[11px] text-faint">{dateTime(r.created_at)}</span>
          <span className="text-fg">{describeLog(r)}</span>
          {r.actor && <Link href={r.actor.href ?? "#"} className="text-iris-hi hover:underline">{r.actor.label}</Link>}
        </li>
      ))}
    </ul>
  );
}

export function DisputeCase({ id }: { id: number }) {
  const [picked, setPicked] = React.useState<AdminCaseAction | null>(null);
  const decision = React.useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["admin", "dispute-case", id], queryFn: () => api.adminDisputeCase(id), refetchInterval: 60_000 });
  const c = q.data;

  if (q.isLoading) {
    return <div className="space-y-4" aria-busy="true">{[140, 180, 320].map((h) => <div key={h} className="animate-pulse rounded-card border border-line bg-card" style={{ height: h }} />)}</div>;
  }
  if (q.isError || !c) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[14px] font-semibold text-fg">Không tải được hồ sơ khiếu nại</p>
        <div className="mt-3 flex justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => q.refetch()}>Thử lại</Button>
          <Link href="/admin/disputes" className="inline-flex h-8 items-center px-3 text-[13px] text-iris-hi hover:underline">Về danh sách</Link>
        </div>
      </Card>
    );
  }

  const status = STATUS_META[c.status] ?? { label: c.status, tone: "neutral" as const };
  const deadlines = caseDeadlines(c);
  const pick = (a: AdminCaseAction) => { setPicked(a); decision.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/disputes" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ChevronLeft size={14} /> Danh sách khiếu nại</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-[20px] font-semibold text-fg">
            Khiếu nại <span className="font-mono">{c.order.order_code}</span>
            <Tag tone={status.tone}>{status.label}</Tag>
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {c.order.product_title}{c.order.variant_name ? ` · ${c.order.variant_name}` : ""} · {c.order.quantity} dòng · {formatVnd(c.order.total_amount)} · mở {dateTime(c.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={c.order.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] text-fg hover:bg-raised">Mở đơn <ExternalLink size={12} /></Link>
          <Link href={`/admin/logs?dispute=${c.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] text-fg hover:bg-raised">Nhật ký</Link>
          {c.conversations.map((cv) => (
            <Link key={cv.id} href={cv.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] text-fg hover:bg-raised">
              <MessageCircle size={13} /> Chat với {cv.requester === "buyer" ? "người mua" : "người bán"}
            </Link>
          ))}
        </div>
      </div>

      {deadlines.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {deadlines.map((d) => (
            <span key={d.key} title={dateTime(d.at)} className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px]",
              d.overdue ? "border-bad/30 bg-bad-soft/60 text-bad" : "border-line bg-card text-muted",
            )}>
              <Clock size={13} /> {d.label}: <span className="font-semibold">{countdown(d.at)}</span>
            </span>
          ))}
        </div>
      )}

      <Assessment c={c} onPick={pick} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Section title="Lý do & bằng chứng">
            <p className="whitespace-pre-wrap text-[13px] text-fg">{c.reason}</p>
            {c.evidence && Object.keys(c.evidence).length > 0 ? (
              <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[160px_1fr]">
                {Object.entries(c.evidence).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt className="text-faint">{EVIDENCE_LABEL[k] ?? k}</dt>
                    <dd className="break-words text-fg">
                      {/^https?:\/\//.test(v) ? <a href={v} target="_blank" rel="noopener noreferrer" className="text-iris-hi hover:underline">{v}</a> : v}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-[12px] text-warn">Người mua chưa gửi bằng chứng.</p>
            )}
            {c.seller_note && (
              <div className="mt-3 rounded-lg border border-warn/25 bg-warn-soft/40 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-warn">Người bán phản hồi</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-fg">{c.seller_note}</p>
              </div>
            )}
          </Section>

          <Section title="Các dòng hàng" aside={<span className="text-[11.5px] text-faint">{c.claimed_resource_ids?.length ?? 0}/{c.lines.length} bị khiếu nại</span>}>
            <Lines c={c} />
          </Section>

          <Section title="Diễn biến">
            <Timeline c={c} />
          </Section>

          <Section title="Nhật ký hệ thống của đơn">
            <OrderLogs orderId={c.order_id} />
          </Section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div ref={decision}><DecisionPanel c={c} picked={picked} setPicked={setPicked} /></div>
          <Section title="Tiền của đơn">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[12.5px]">
              <dt className="text-muted">Tổng đơn</dt><dd className="text-right font-mono">{formatVnd(c.money.order_total)}</dd>
              <dt className="text-muted">Đã hoàn</dt><dd className="text-right font-mono text-bad">{formatVnd(c.money.refunded)}</dd>
              {c.status === "open" && <><dt className="font-medium text-fg">Còn giữ trong ký quỹ</dt><dd className="text-right font-mono font-semibold">{formatVnd(c.money.remaining_refundable)}</dd></>}
              <dt className="text-muted">Đơn giá mỗi dòng</dt><dd className="text-right font-mono">{formatVnd(c.money.unit_price)}</dd>
              <dt className="text-muted">Phí sàn</dt><dd className="text-right font-mono">{c.money.fee_percent}%</dd>
            </dl>
          </Section>
          <Section title="Hai bên">
            <div className="space-y-3">
              <PartyCard role="buyer" c={c} />
              <PartyCard role="seller" c={c} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
