"use client";

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Sparkles } from "@/components/Icons";

import { CHANGELOG_KEY, KIND_META, formatDay } from "../model";

const POLL_MS = 5 * 60_000;

/** Header button next to the bell: unread count + popover of the newest releases. */
export function WhatsNewButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: [...CHANGELOG_KEY, "latest"],
    queryFn: () => api.adminChangelogLatest(),
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

  const [first, ...rest] = releases;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="whats-new-panel"
        aria-label={unread > 0 ? `Có gì mới, ${unread} bản chưa đọc` : "Có gì mới"}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
          unread > 0
            ? "border-iris/30 bg-iris-soft text-iris-hi hover:border-iris/50"
            : "border-line bg-surface text-muted hover:text-fg hover:border-line-2",
        )}
      >
        <Sparkles size={16} />
        <span className="hidden sm:inline">Có gì mới</span>
        {unread > 0 && (
          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-iris px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id="whats-new-panel"
          className="absolute right-0 z-50 mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-card-lg"
        >
          <div className="flex items-center justify-between border-b border-line bg-raised/50 px-4 py-3">
            <span className="text-[13px] font-semibold text-fg">Có gì mới</span>
            {unread > 0 && (
              <button type="button" onClick={markSeen} className="text-[12px] text-muted hover:text-fg">
                Đánh dấu đã đọc
              </button>
            )}
          </div>

          {!first ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted">Chưa có phiên bản nào được đăng.</p>
          ) : (
            <>
              <article className={cn("flex flex-col gap-2 px-4 py-3.5", first.unread && "bg-iris-soft/40")}>
                <div className="flex items-center gap-2 text-[12px] text-muted">
                  <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-fg">
                    {first.version}
                  </span>
                  {formatDay(first.released_on)}
                  {first.unread && <span className="ml-auto h-2 w-2 rounded-full bg-iris" aria-label="Chưa đọc" />}
                </div>
                <p className="text-[14px] font-semibold leading-snug text-fg">{first.title}</p>
                {first.items.length > 0 && (
                  <ul className="flex flex-col gap-1.5 text-[13px] text-fg/80">
                    {first.items.slice(0, 4).map((item, i) => (
                      <li key={i} className="flex items-baseline gap-2">
                        <span className={cn(
                          "w-14 shrink-0 text-[11px] font-medium",
                          item.kind === "new" ? "text-iris-hi" : item.kind === "improved" ? "text-good" : "text-warn",
                        )}>
                          {KIND_META[item.kind].label}
                        </span>
                        <span className="min-w-0">{item.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              {rest.map((r) => (
                <div key={r.id} className="flex items-center gap-2 border-t border-line px-4 py-3 text-[13px]">
                  <span className="font-mono text-[11.5px] font-medium text-muted">{r.version}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{r.title}</span>
                  {r.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-iris" aria-label="Chưa đọc" />}
                  <span className="shrink-0 text-[12px] text-faint">{formatDay(r.released_on).slice(0, 5)}</span>
                </div>
              ))}
            </>
          )}

          <Link
            href="/admin/changelog"
            prefetch={false}
            onClick={() => { setOpen(false); if (unread > 0) void markSeen(); }}
            className="block border-t border-line px-4 py-3 text-center text-[13px] font-medium text-iris hover:bg-raised/50"
          >
            Xem toàn bộ nhật ký thay đổi
          </Link>
        </div>
      )}
    </div>
  );
}
