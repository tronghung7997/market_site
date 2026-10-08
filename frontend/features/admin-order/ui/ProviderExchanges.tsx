"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { UpstreamExchange } from "@/lib/types";
import { Banner, Spinner, Tag } from "@/components/ui";
import { Check, ChevronDown, Copy } from "@/components/Icons";
import { shortDate } from "../model";

// Adapter operation names (provider_call_logs.operation) in admin words.
const OPERATION: Record<string, string> = {
  purchase_assignment: "Mua proxy",
  dispute_purchase: "Khiếu nại / hoàn",
  quote_plan: "Báo giá gói",
  list_assignments: "Đọc danh sách proxy",
  rotate: "Xoay IP",
  provision: "Giao hàng",
  get_xoay_proxy: "Lấy proxy xoay",
  purchase: "Mua hàng",
};

function pretty(text: string | null): string {
  if (!text) return "";
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button type="button" aria-label="Chép" title="Chép" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* blocked */ }
    }} className="inline-flex items-center text-faint hover:text-fg">
      {done ? <Check size={12} className="text-good" /> : <Copy size={12} />}
    </button>
  );
}

function Body({ label, text }: { label: string; text: string | null }) {
  const shown = pretty(text);
  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
        {label} {shown && <CopyButton value={shown} />}
      </p>
      {shown
        ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-raised/50 p-2.5 font-mono text-[11.5px] text-fg">{shown}</pre>
        : <p className="text-[12px] text-faint">Không có nội dung.</p>}
    </div>
  );
}

function Detail({ row }: { row: UpstreamExchange }) {
  const apiError = useApiErrorMessage();
  const q = useQuery({
    queryKey: ["admin", "upstream-exchange", row.id],
    queryFn: () => api.adminUpstreamExchange(row.id),
    staleTime: Infinity,
  });
  if (q.isLoading) return <div className="px-4 py-3 sm:px-5"><Spinner /></div>;
  if (q.isError || !q.data) return <div className="px-4 py-3 sm:px-5"><Banner tone="bad">{apiError(q.error)}</Banner></div>;
  const d = q.data;
  return (
    <div className="space-y-3 border-t border-line/70 bg-surface px-4 py-3 sm:px-5">
      <p className="break-all font-mono text-[11.5px] text-muted">
        {d.method} {d.host}{d.url_path ?? d.path}
      </p>
      {d.error && <Banner tone="bad">{d.error}</Banner>}
      <div className="grid gap-3 lg:grid-cols-2">
        <Body label="Mình gửi" text={d.request_body} />
        <Body label={`Họ trả về${d.status_code ? ` · HTTP ${d.status_code}` : ""}`} text={d.response_body} />
      </div>
      <p className="text-[11px] text-faint">
        {d.truncated ? "Nội dung dài hơn giới hạn lưu nên đã bị cắt. " : ""}
        Lần xem này đã được ghi vào nhật ký. Khoá API của mình không được lưu.
      </p>
    </div>
  );
}

/** Every HTTP call made to the order's supplier, with what was sent and received. */
export function ProviderExchanges({ orderId }: { orderId: number }) {
  const apiError = useApiErrorMessage();
  const [openId, setOpenId] = React.useState<number | null>(null);
  const q = useQuery({
    queryKey: ["admin", "upstream-exchanges", { order_id: orderId }],
    queryFn: () => api.adminUpstreamExchanges({ order_id: orderId, limit: 100 }),
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Banner tone="bad">{apiError(q.error)}</Banner>;
  const rows = q.data ?? [];
  if (!rows.length) {
    return <p className="text-[12px] text-faint">Chưa có lời gọi nào tới nhà cung cấp được lưu cho đơn này (chỉ lưu từ khi bật tính năng, giữ 90 ngày).</p>;
  }
  return (
    <ul className="-mx-4 divide-y divide-line/70 sm:-mx-5">
      {rows.map((r) => {
        const ok = r.outcome === "ok";
        const open = openId === r.id;
        return (
          <li key={r.id}>
            <button type="button" onClick={() => setOpenId(open ? null : r.id)} aria-expanded={open}
              className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-raised/50 sm:px-5">
              <span className="w-24 shrink-0 font-mono text-[11px] text-faint">{shortDate(r.created_at)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-fg">{(r.operation && OPERATION[r.operation]) || r.operation || r.integration}</span>
                <span className="block truncate font-mono text-[11px] text-faint">{r.method} {r.path} · {r.duration_ms} ms</span>
              </span>
              <Tag tone={ok ? "good" : "bad"}>{r.status_code ?? r.outcome}</Tag>
              <ChevronDown size={14} className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")} />
            </button>
            {open && <Detail row={r} />}
          </li>
        );
      })}
    </ul>
  );
}
