"use client";

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { History } from "lucide-react";

import { CHANGELOG_KEY, KIND_META, formatDay, groupByKind } from "../model";

const POLL_MS = 5 * 60_000;

/** "Change Log" button next to the bell: unread count + the newest releases in full. */
export function WhatsNewButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: [...CHANGELOG_KEY, "latest"],
    queryFn: () => api.adminChangelogLatest(5),
    refetchInterval: POLL_MS,
  });
  const releases = data?.items ?? [];
  const unread = data?.unread_count ?? 0;

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markSeen = async () => {
    await api.adminChangelogSeen();
    await queryClient.invalidateQueries({ queryKey: CHANGELOG_KEY });
  };

  const newestId = releases[0]?.id;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="changelog-panel"
        aria-label={unread > 0 ? `Change Log, ${unread} bản chưa đọc` : "Change Log"}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
          unread > 0
            ? "border-iris/30 bg-iris-soft text-iris-hi hover:border-iris/50"
            : "border-line bg-surface text-muted hover:text-fg hover:border-line-2",
        )}
      >
        <History size={16} />
        <span className="hidden sm:inline">Change Log</span>
        {unread > 0 && (
          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-iris px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id="changelog-panel"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-card-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[420px]"
        >
          <div className="flex items-center gap-2 border-b border-line bg-raised/50 px-4 py-3">
            <History size={16} className="text-muted" />
            <span className="text-[14px] font-semibold text-fg">Change Log</span>
            {unread > 0 && (
              <button type="button" onClick={markSeen} className="ml-auto text-[12px] text-muted hover:text-fg">
                Đánh dấu đã đọc
              </button>
            )}
          </div>

          {releases.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted">Chưa có phiên bản nào được đăng.</p>
          ) : (
            <div className="flex max-h-[min(560px,calc(100dvh-9rem))] flex-col gap-2 overflow-y-auto p-2">
              {releases.map((r) => (
                <article
                  key={r.id}
                  className={cn("rounded-lg border px-3.5 py-3", r.unread ? "border-iris/25 bg-iris-soft/30" : "border-line bg-raised/40")}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold text-fg">{r.version}</span>
                    {r.id === newestId && (
                      <span className="rounded-full border border-good/30 bg-good-soft px-2 py-0.5 text-[11px] font-semibold leading-none text-good">
                        Mới nhất
                      </span>
                    )}
                    <span className="ml-auto text-[12.5px] font-medium tabular-nums text-fg">{formatDay(r.released_on)}</span>
                  </div>
                  <p className="mt-2 text-[13.5px] font-semibold leading-snug text-fg">{r.title}</p>
                  {groupByKind(r.items).map(({ kind, items }) => (
                    <div key={kind} className="mt-2 text-[13px] leading-relaxed text-fg/85">
                      <p className="font-medium text-fg">- {KIND_META[kind].label}:</p>
                      <ul>
                        {items.map((item, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span aria-hidden>•</span>
                            <span className="min-w-0">{item.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </article>
              ))}
            </div>
          )}

          <Link
            href="/admin/changelog"
            prefetch={false}
            onClick={() => { setOpen(false); if (unread > 0) void markSeen(); }}
            className="block border-t border-line px-4 py-3 text-center text-[13px] font-medium text-iris hover:bg-raised/50"
          >
            Xem toàn bộ Change Log
          </Link>
        </div>
      )}
    </div>
  );
}
