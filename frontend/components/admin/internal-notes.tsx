"use client";

import * as React from "react";
import type { AdminNote } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { Button, Textarea } from "@/components/ui";

const NOTE_MAX = 2000;

/** Admin-only notes on a subject (account, application): newest first, plus an add box.
 *  The caller owns fetching and the add mutation. */
export function InternalNotes({ notes, loading, error, onRetry, onAdd, adding }: {
  notes: AdminNote[] | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onAdd: (body: string) => Promise<unknown>;
  adding?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await onAdd(body);
      setDraft("");
    } catch {
      // The caller reports the failure; keep the draft so nothing is lost.
    }
  };
  const list = [...(notes ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={NOTE_MAX}
          placeholder="Ghi chú nội bộ — chỉ admin thấy"
          aria-label="Ghi chú nội bộ mới"
          className="min-h-[64px] text-[12.5px]"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-faint">{draft.length}/{NOTE_MAX}</span>
          <Button size="sm" variant="secondary" loading={adding} disabled={!draft.trim()} onClick={() => void submit()}>Thêm ghi chú</Button>
        </div>
      </div>
      {loading ? (
        <p className="text-[12px] text-muted">Đang tải ghi chú…</p>
      ) : error ? (
        <p className="text-[12px] text-bad">
          Không tải được ghi chú.{onRetry && <button type="button" onClick={onRetry} className="ml-1.5 font-medium text-fg underline underline-offset-2">Thử lại</button>}
        </p>
      ) : list.length === 0 ? (
        <p className="text-[12px] text-faint">Chưa có ghi chú nào.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((n) => (
            <li key={n.id} className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="whitespace-pre-line break-words text-[12.5px] text-fg">{n.body}</p>
              <p className="mt-1 text-[11px] text-faint">{n.author_email ?? "Admin"} · {formatDateTime(n.created_at, "vi")}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
