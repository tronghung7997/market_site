"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { ChangelogRelease } from "@/lib/types";
import { Banner, Button, Spinner, Tag } from "@/components/ui";
import { ChevronDown, Plus } from "@/components/Icons";
import { ConfirmModal } from "@/components/admin";

import {
  AUDIENCE_LABEL, CHANGELOG_KEY, KINDS, KIND_META, countSummary, formatDay, formatStamp,
} from "../model";
import { ReleaseDialog } from "./ReleaseDialog";

export function ChangelogConsole() {
  const queryClient = useQueryClient();
  const apiErrorMessage = useApiErrorMessage();
  const query = useQuery({ queryKey: [...CHANGELOG_KEY, "all"], queryFn: () => api.adminChangelog() });
  const releases = React.useMemo(() => query.data?.items ?? [], [query.data]);

  const [editing, setEditing] = React.useState<ChangelogRelease | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ChangelogRelease | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());

  const refresh = () => queryClient.invalidateQueries({ queryKey: CHANGELOG_KEY });

  // Opening the page counts as reading what's new.
  const unread = query.data?.unread_count ?? 0;
  React.useEffect(() => {
    if (unread > 0) void api.adminChangelogSeen().then(refresh);
  }, [unread]);

  const newestPublished = releases.find((r) => r.status === "published");
  const latestVersion = releases[0]?.version;

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (r: ChangelogRelease) => { setEditing(r); setDialogOpen(true); };
  const toggle = (id: number) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.adminDeleteRelease(deleting.id);
      await refresh();
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  return (
    <div className="animate-rise mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-[14px] text-muted">Mỗi lần cập nhật hệ thống có gì mới, ảnh hưởng tới ai.</p>
        <Button onClick={openNew}><Plus size={16} /> Thêm phiên bản</Button>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[12px] text-muted">
        {KINDS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <Tag tone={KIND_META[k].tone}>{KIND_META[k].label}</Tag>{KIND_META[k].hint}
          </span>
        ))}
      </div>

      {query.isLoading && <div className="grid h-40 place-items-center"><Spinner label="Đang tải" /></div>}
      {query.isError && <Banner tone="bad">{apiErrorMessage(query.error, "Không tải được nhật ký thay đổi.")}</Banner>}
      {query.isSuccess && releases.length === 0 && (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line-2 p-10 text-center text-[13px] text-muted">
          Chưa có phiên bản nào. Thêm phiên bản đầu tiên sau lần deploy tới.
          <Button variant="secondary" size="sm" onClick={openNew}><Plus size={14} /> Thêm phiên bản</Button>
        </div>
      )}

      {releases.map((r, idx) => {
        const live = r.id === newestPublished?.id;
        // Drafts sit on top; the newest published release stays open too.
        const pinnedOpen = idx === 0 || live;
        const open = pinnedOpen || expanded.has(r.id);
        return (
          <article key={r.id} className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex flex-col gap-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                <span className={cn(
                  "rounded-md px-2 py-0.5 font-mono text-[12.5px] font-medium",
                  open ? "bg-fg text-surface" : "border border-line text-fg",
                )}>
                  {r.version}
                </span>
                <span>{r.published_at ? formatStamp(r.published_at) : formatDay(r.released_on)}</span>
                {r.author && <span>Đăng bởi {r.author}</span>}
                {r.status === "draft" && <Tag tone="warn">Nháp</Tag>}
                {live && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-good">
                    <span className="h-2 w-2 rounded-full bg-good" />Bản mới nhất
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Sửa</Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(r)}>Xoá</Button>
                  {!pinnedOpen && (
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      aria-expanded={open}
                      aria-label={open ? `Thu gọn ${r.version}` : `Mở rộng ${r.version}`}
                      className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:text-fg"
                    >
                      <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
                    </button>
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className={cn("font-semibold text-fg", open ? "text-[17px]" : "text-[15px]")}>{r.title}</h2>
                {!open && <span className="text-[12px] text-muted">{countSummary(r.items)}</span>}
              </div>
            </div>

            {open && r.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-[14px]">
                  <thead>
                    <tr className="bg-raised/60 text-left text-[12px] text-muted">
                      <th className="w-24 px-5 py-2 font-medium">Loại</th>
                      <th className="py-2 font-medium">Thay đổi</th>
                      <th className="w-32 px-5 py-2 font-medium">Ảnh hưởng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((item, i) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="px-5 py-3"><Tag tone={KIND_META[item.kind].tone}>{KIND_META[item.kind].label}</Tag></td>
                        <td className="py-3 leading-relaxed text-fg">{item.text}</td>
                        <td className="px-5 py-3 text-[13px] text-muted">
                          {item.audience.map((a) => AUDIENCE_LABEL[a]).join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {open && r.dev_notes.trim() && (
              <details className="border-t border-line bg-raised/40">
                <summary className="cursor-pointer px-5 py-3 text-[13px] font-medium text-fg">Chi tiết cho dev</summary>
                <pre className="whitespace-pre-wrap break-words px-5 pb-4 font-mono text-[12px] leading-relaxed text-fg/80">{r.dev_notes}</pre>
              </details>
            )}
          </article>
        );
      })}

      <ReleaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        release={editing}
        latestVersion={latestVersion}
        onSaved={refresh}
      />
      <ConfirmModal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Xoá ${deleting?.version ?? ""}?`}
        description="Phiên bản này sẽ biến mất khỏi nhật ký và khỏi nút Có gì mới."
        confirmText="Xoá"
        variant="danger"
        isLoading={busy}
      />
    </div>
  );
}
