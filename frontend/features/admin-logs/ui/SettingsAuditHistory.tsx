"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { ArrowRight, Clock } from "@/components/Icons";
import { actorText } from "../model";
import { settingsChanges } from "../settings-audit";

const SHOWN_ROWS = 4;

/** Recent saves of one settings page, read from the audit log: who, when, what changed. */
export function SettingsAuditHistory({ events, limit = 5, title = "Lịch sử thay đổi" }: {
  events: string[];
  limit?: number;
  title?: string;
}) {
  const event = events.join(",");
  const query = useQuery({
    queryKey: ["admin", "logs", "settings-history", event, limit] as const,
    queryFn: () => api.adminLogsFor({ event, limit }),
    staleTime: 15_000,
  });
  const [open, setOpen] = React.useState<number | null>(null);

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raised/40 px-5 py-3">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-fg"><Clock size={15} className="text-faint" />{title}</h2>
        <Link href={`/admin/logs?event=${encodeURIComponent(event)}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">
          Xem tất cả trong Nhật ký <ArrowRight size={14} />
        </Link>
      </div>
      {query.isPending ? (
        <div className="p-5 text-center"><Spinner /></div>
      ) : query.isError ? (
        <p className="px-5 py-4 text-[12.5px] text-bad">
          Không tải được lịch sử. <button type="button" onClick={() => void query.refetch()} className="font-medium underline">Thử lại</button>
        </p>
      ) : query.data.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-muted">Chưa có lần lưu nào được ghi lại.</p>
      ) : (
        <ul className="divide-y divide-line">
          {query.data.map((log) => {
            const changes = settingsChanges(log.metadata);
            const expanded = open === log.id;
            const shown = expanded ? changes : changes.slice(0, SHOWN_ROWS);
            return (
              <li key={log.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div className="text-[12px]">
                  <time dateTime={log.created_at} className="block font-mono tabular-nums text-fg">
                    {new Date(log.created_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                  </time>
                  <span className="block truncate text-muted" title={log.actor?.detail ?? undefined}>{actorText(log)}</span>
                </div>
                {changes.length === 0 ? (
                  <p className="text-[12.5px] text-faint">Lưu nhưng không đổi giá trị nào.</p>
                ) : (
                  <div className="min-w-0">
                    <table className="w-auto max-w-full text-[12.5px]">
                      <tbody>
                        {shown.map((c) => (
                          <tr key={c.key} className="align-baseline">
                            <td className="py-0.5 pr-3 text-muted">{c.label}</td>
                            <td className="whitespace-nowrap py-0.5 text-right font-mono tabular-nums text-bad line-through decoration-bad/40">{c.before}</td>
                            <td className="px-2 py-0.5 text-faint">→</td>
                            <td className="whitespace-nowrap py-0.5 font-mono font-medium tabular-nums text-good">{c.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {changes.length > SHOWN_ROWS && (
                      <button type="button" onClick={() => setOpen(expanded ? null : log.id)} className="mt-1 text-[12px] font-medium text-iris-hi hover:underline">
                        {expanded ? "Thu gọn" : `+${changes.length - SHOWN_ROWS} thay đổi khác`}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
