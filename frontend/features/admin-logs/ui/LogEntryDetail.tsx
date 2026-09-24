"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { AdminLogEntry, AlertRef } from "@/lib/types";
import { ChevronDown, Copy, ExternalLink } from "@/components/Icons";
import { actorText, describeMetadata } from "../model";

const KIND: Record<string, string> = {
  order: "Đơn", dispute: "Khiếu nại", account: "Tài khoản", provider: "Nguồn hàng", product: "Sản phẩm",
  variant: "Biến thể", resource: "Tài nguyên", deposit: "Lệnh nạp", withdrawal: "Lệnh rút",
};

export function RefChip({ r, compact }: { r: AlertRef; compact?: boolean }) {
  const role = r.role && r.role !== "đối tượng" ? r.role : KIND[r.kind] ?? r.kind;
  const content = (
    <>
      <span className="inline-block text-faint first-letter:uppercase">{role}</span>
      <span className="max-w-[200px] truncate font-medium text-fg">{r.label}</span>
      {!compact && r.detail && <span className="hidden max-w-[200px] truncate text-faint md:inline">· {r.detail}</span>}
    </>
  );
  const cls = "inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-line bg-surface px-1.5 text-[11.5px]";
  return r.href
    ? <Link href={r.href} onClick={(e) => e.stopPropagation()} className={cn(cls, "hover:border-iris/40 hover:bg-iris-soft/60")} title={r.detail ?? r.label}>{content}</Link>
    : <span className={cls}>{content}</span>;
}

function Related({ log, describe }: { log: AdminLogEntry; describe: (l: AdminLogEntry) => string }) {
  const q = useQuery({ queryKey: ["admin", "logs", "related", log.id], queryFn: () => api.adminRelatedLogs(log.id), staleTime: 30_000 });
  if (q.isLoading) return <p className="text-[12px] text-faint">Đang tìm sự kiện liên quan…</p>;
  if (q.isError) return <p className="text-[12px] text-bad">Không tải được sự kiện liên quan.</p>;
  const rows = q.data ?? [];
  if (!rows.length) return <p className="text-[12px] text-faint">Không có sự kiện nào khác cùng thao tác, đơn hay khiếu nại.</p>;
  const all = [...rows, log].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  return (
    <ol className="relative space-y-1.5 border-l border-line pl-3">
      {all.map((r) => (
        <li key={r.id} className={cn("relative text-[12px]", r.id === log.id && "font-semibold")}>
          <span aria-hidden className={cn("absolute -left-[16.5px] top-1.5 h-2 w-2 rounded-full ring-2 ring-surface",
            r.id === log.id ? "bg-iris" : r.level === "info" ? "bg-line-2" : "bg-warn")} />
          <span className="font-mono text-[11px] text-faint">{new Date(r.created_at).toLocaleString("vi-VN")}</span>{" "}
          <span className="text-fg">{describe(r)}</span>
          {r.actor && <span className="text-faint"> · {r.actor.label}</span>}
          {r.id === log.id && <span className="ml-1 text-[11px] font-normal text-iris-hi">(sự kiện đang xem)</span>}
        </li>
      ))}
    </ol>
  );
}

export function LogEntryDetail({ log, describe, onTrace }: {
  log: AdminLogEntry;
  describe: (l: AdminLogEntry) => string;
  onTrace: (t: { request_id?: string; job_id?: string }) => void;
}) {
  const [tech, setTech] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const { fields, changes } = describeMetadata(log.metadata);
  const md = log.metadata ?? {};
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ ...log, actor: undefined, refs: undefined }, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — nothing to do */ }
  };
  return (
    <div className="grid gap-4 border-t border-line bg-raised/40 px-4 py-3 animate-rise md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:pl-[76px]">
      <div className="min-w-0 space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Ai thực hiện</p>
          <p className="mt-0.5 text-[12.5px] text-fg">
            {log.actor?.href
              ? <Link href={log.actor.href} className="font-medium text-iris-hi hover:underline">{log.actor.label}</Link>
              : <span className="font-medium">{actorText(log)}</span>}
            {log.actor?.detail && <span className="text-faint"> · {log.actor.detail}</span>}
          </p>
        </div>
        {log.refs.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Liên quan tới</p>
            <ul className="mt-1 space-y-1">
              {log.refs.map((r) => (
                <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0">
                    <span className="inline-block text-faint first-letter:uppercase">{r.role && r.role !== "đối tượng" ? r.role : KIND[r.kind] ?? r.kind}</span>
                    <span className="text-faint">: </span>
                    <span className="font-medium text-fg">{r.label}</span>
                    {r.detail && <span className="block truncate text-[11.5px] text-faint">{r.detail}</span>}
                  </span>
                  {r.href && <Link href={r.href} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-iris-hi hover:underline">Mở <ExternalLink size={12} /></Link>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {changes.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Thay đổi</p>
            <table className="mt-1 w-full text-[12.5px]">
              <tbody>
                {changes.map((c) => (
                  <tr key={c.key}>
                    <td className="py-0.5 pr-3 text-muted">{c.label}</td>
                    <td className="py-0.5 pr-2 text-bad line-through decoration-bad/40">{c.before}</td>
                    <td className="py-0.5 text-faint">→</td>
                    <td className="py-0.5 pl-2 font-medium text-good">{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {fields.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Chi tiết</p>
            <dl className="mt-1 grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
              {fields.map((f) => (
                <React.Fragment key={f.key}>
                  <dt className="text-muted">{f.label}</dt>
                  <dd className={cn("min-w-0 break-words", f.tone === "bad" ? "text-bad" : f.tone === "good" ? "text-good" : "text-fg")}>{f.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Diễn biến liên quan</p>
          <p className="mb-1.5 text-[11px] text-faint">Cùng thao tác, cùng job, hoặc cùng đơn / khiếu nại / lệnh rút.</p>
          <Related log={log} describe={describe} />
        </div>
        <div className="flex flex-wrap gap-2">
          {log.request_id && (
            <button type="button" onClick={() => onTrace({ request_id: log.request_id! })}
              className="inline-flex h-7 items-center rounded-md border border-line bg-surface px-2.5 text-[12px] text-muted hover:text-fg">
              Lọc theo thao tác này
            </button>
          )}
          {log.job_id && (
            <button type="button" onClick={() => onTrace({ job_id: log.job_id! })}
              className="inline-flex h-7 items-center rounded-md border border-line bg-surface px-2.5 text-[12px] text-muted hover:text-fg">
              Lọc theo job này
            </button>
          )}
          <button type="button" onClick={() => setTech((v) => !v)} aria-expanded={tech}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-faint hover:text-fg">
            Kỹ thuật <ChevronDown size={12} className={cn("transition-transform", tech && "rotate-180")} />
          </button>
        </div>
        {tech && (
          <div className="rounded-lg border border-line bg-surface p-2.5 text-[11.5px]">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-faint">Thông điệp gốc</dt><dd className="break-words font-mono text-muted">{log.message}</dd>
              <dt className="text-faint">Sự kiện</dt><dd className="font-mono text-muted">{String(md.event ?? "—")}</dd>
              {log.request_id && <><dt className="text-faint">Request</dt><dd className="break-all font-mono text-muted">{log.request_id}</dd></>}
              {log.job_id && <><dt className="text-faint">Job</dt><dd className="break-all font-mono text-muted">{log.job_id}</dd></>}
              {typeof md.ip === "string" && <><dt className="text-faint">IP</dt><dd className="font-mono text-muted">{md.ip}</dd></>}
              <dt className="text-faint">Mã sự kiện</dt><dd className="font-mono text-muted">#{log.id}</dd>
            </dl>
            <button type="button" onClick={copyJson} className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-iris-hi hover:underline">
              <Copy size={12} /> {copied ? "Đã chép" : "Chép JSON gốc"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
