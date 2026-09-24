"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { AdminAlert } from "@/lib/types";
import { Banner, Button, Card, Tag } from "@/components/ui";
import { ArrowRight, Check, ChevronDown, ExternalLink, RefreshCw, RotateCcw, Search, X } from "@/components/Icons";
import {
  REF_KIND_LABEL, RESOLUTION_PRESETS, SEVERITY_META, SEVERITY_ORDER,
  absoluteTime, matchesSearch, playbook, primaryActionLabel, relativeTime, sortAlerts,
  type InboxView,
} from "../model";

type Audience = "all" | "ops" | "user";

function useInboxUrl() {
  const params = useSearchParams();
  const pathname = usePathname();
  const state = {
    view: (params.get("view") === "resolved" ? "resolved" : "open") as InboxView,
    severity: params.get("severity") ?? "all",
    type: params.get("type"),
    audience: (["ops", "user"].includes(params.get("audience") ?? "") ? params.get("audience") : "all") as Audience,
    q: params.get("q") ?? "",
  };
  const set = React.useCallback((patch: Partial<typeof state>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "" || v === "all" || (k === "view" && v === "open")) next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [params, pathname]);
  return { ...state, set };
}

function ResolveControl({ count, busy, onResolve, align = "right" }: {
  count: number;
  busy: boolean;
  onResolve: (note: string) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const submit = (text: string) => { onResolve(text); setOpen(false); setNote(""); };
  return (
    <div ref={box} className="relative">
      <Button variant="secondary" size="sm" loading={busy} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Check size={14} /> {count > 1 ? `Đã xử lý (${count})` : "Đã xử lý"}
      </Button>
      {open && (
        <div className={cn("absolute top-[calc(100%+6px)] z-30 w-72 rounded-xl border border-line bg-surface p-3 shadow-card-lg animate-pop", align === "right" ? "right-0" : "left-0")}>
          <p className="text-[12px] font-semibold text-fg">Ghi chú xử lý</p>
          <p className="mt-0.5 text-[11.5px] text-faint">Hiện trong lịch sử để người trực sau biết đã làm gì.</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {RESOLUTION_PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => submit(p)}
                className="rounded-md border border-line px-2 py-1 text-[11.5px] text-muted transition-colors hover:border-iris/40 hover:bg-iris-soft hover:text-iris-hi">
                {p}
              </button>
            ))}
          </div>
          <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); submit(note); }}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              placeholder="Hoặc ghi chú riêng…"
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[12.5px] focus:border-iris focus:outline-none"
            />
            <Button size="sm" type="submit">Lưu</Button>
          </form>
        </div>
      )}
    </div>
  );
}

function RefChip({ r }: { r: AdminAlert["refs"][number] }) {
  const body = (
    <>
      <span className="inline-block text-faint first-letter:uppercase">{r.role ?? REF_KIND_LABEL[r.kind] ?? r.kind}</span>
      <span className="max-w-[220px] truncate font-medium text-fg">{r.label}</span>
      {r.detail && <span className="hidden max-w-[220px] truncate text-faint lg:inline">· {r.detail}</span>}
    </>
  );
  const cls = "inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-line bg-surface px-1.5 text-[11.5px]";
  return r.href ? (
    <Link href={r.href} className={cn(cls, "transition-colors hover:border-iris/40 hover:bg-iris-soft/60")} title={r.detail ?? r.label}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}

function AlertRow({ alert, view, selected, onSelect, busy, onResolve, onReopen }: {
  alert: AdminAlert;
  view: InboxView;
  selected: boolean;
  onSelect: (on: boolean) => void;
  busy: boolean;
  onResolve: (note: string) => void;
  onReopen: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const pb = playbook(alert);
  const sev = SEVERITY_META[alert.severity] ?? SEVERITY_META.info;
  const primary = alert.refs[0];
  return (
    <li className={cn("border-b border-line/80 last:border-0", selected && "bg-iris-soft/30")}>
      <div className="flex items-start gap-3 px-4 py-3">
        {view === "open" && (
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)}
            aria-label={`Chọn cảnh báo ${pb.title}`} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-iris)]" />
        )}
        <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", sev.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className="inline-flex items-center gap-1 text-left text-[13.5px] font-semibold text-fg hover:text-iris-hi">
              {pb.title}
              <ChevronDown size={14} className={cn("text-faint transition-transform duration-200", open && "rotate-180")} />
            </button>
            <span className={cn("text-[11px] font-medium", sev.text)}>{sev.label}</span>
            {alert.occurrence_count > 1 && <Tag tone="warn">×{alert.occurrence_count} lần</Tag>}
            {alert.audience === "user" && <Tag tone="neutral">Thông báo của {alert.target_type === "seller" ? "người bán" : "người mua"}</Tag>}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted">{alert.message}</p>
          {alert.refs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {alert.refs.map((r) => <RefChip key={`${r.kind}-${r.id}`} r={r} />)}
            </div>
          )}
          <p className="mt-1.5 text-[11.5px] text-faint" title={`Lần đầu ${absoluteTime(alert.first_seen_at)} · gần nhất ${absoluteTime(alert.last_seen_at)}`}>
            {alert.occurrence_count > 1
              ? `Lần đầu ${relativeTime(alert.first_seen_at)} · gần nhất ${relativeTime(alert.last_seen_at)}`
              : relativeTime(alert.last_seen_at ?? alert.created_at)}
            {view === "resolved" && alert.admin_resolved_at && (
              <> · xử lý {relativeTime(alert.admin_resolved_at)} bởi <span className="text-muted">{alert.admin_resolved_by ?? "hệ thống"}</span></>
            )}
          </p>
          {view === "resolved" && alert.admin_note && (
            <p className="mt-1 inline-flex max-w-full items-start gap-1.5 rounded-md bg-raised px-2 py-1 text-[12px] text-muted">
              <Check size={13} className="mt-0.5 shrink-0 text-good" /> {alert.admin_note}
            </p>
          )}

          {open && (
            <div className="mt-3 grid gap-3 rounded-lg border border-line bg-raised/40 p-3 animate-rise md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Ảnh hưởng</p>
                <p className="mt-1 text-[12.5px] text-fg">{pb.impact}</p>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">Việc cần làm</p>
                <ol className="mt-1 space-y-1">
                  {pb.steps.map((s, i) => (
                    <li key={s} className="flex gap-2 text-[12.5px] text-fg">
                      <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-iris-soft text-[10.5px] font-semibold text-iris-hi">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Liên quan</p>
                <ul className="mt-1 space-y-1">
                  {alert.refs.length === 0 && <li className="text-[12.5px] text-faint">Không gắn với đối tượng cụ thể.</li>}
                  {alert.refs.map((r) => (
                    <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="min-w-0">
                        <span className="text-faint">{r.role ? `${r.role[0].toUpperCase()}${r.role.slice(1)}` : REF_KIND_LABEL[r.kind] ?? r.kind}: </span>
                        <span className="font-medium text-fg">{r.label}</span>
                        {r.detail && <span className="block truncate text-[11.5px] text-faint">{r.detail}</span>}
                      </span>
                      {r.href && (
                        <Link href={r.href} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-iris-hi hover:underline">
                          Mở <ExternalLink size={12} />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
                  <dt className="text-faint">Lần đầu</dt><dd className="text-muted">{absoluteTime(alert.first_seen_at ?? alert.created_at)}</dd>
                  <dt className="text-faint">Gần nhất</dt><dd className="text-muted">{absoluteTime(alert.last_seen_at ?? alert.created_at)}</dd>
                  <dt className="text-faint">Mã cảnh báo</dt><dd className="font-mono text-muted">#{alert.id} · {alert.type}</dd>
                </dl>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-start">
          {primary?.href && (
            <Link href={primary.href}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-iris px-3 text-[12.5px] font-medium text-white transition hover:brightness-110">
              {primaryActionLabel(primary)} <ArrowRight size={13} />
            </Link>
          )}
          {view === "open"
            ? <ResolveControl count={1} busy={busy} onResolve={onResolve} />
            : <Button variant="ghost" size="sm" loading={busy} onClick={onReopen}><RotateCcw size={13} /> Mở lại</Button>}
        </div>
      </div>
    </li>
  );
}

export function AlertsInbox() {
  const url = useInboxUrl();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState(url.q);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [busy, setBusy] = React.useState<Set<number>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "alerts", url.view],
    queryFn: () => api.adminAlerts(url.view),
    staleTime: 30_000,
    refetchInterval: url.view === "open" ? 60_000 : false,
  });
  const alerts = React.useMemo(() => query.data ?? [], [query.data]);

  React.useEffect(() => { setSelected(new Set()); }, [url.view]);
  React.useEffect(() => {
    const t = setTimeout(() => url.set({ q: search }), 250);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoped = React.useMemo(() => alerts.filter((a) =>
    matchesSearch(a, url.q) && (url.audience === "all" || a.audience === url.audience),
  ), [alerts, url.q, url.audience]);
  const types = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const a of scoped) m.set(a.type, (m.get(a.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [scoped]);
  const byType = url.type ? scoped.filter((a) => a.type === url.type) : scoped;
  const sevCounts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, byType.filter((a) => a.severity === s).length]));
  const rows = sortAlerts(url.severity === "all" ? byType : byType.filter((a) => a.severity === url.severity), url.view);

  const mark = (ids: number[], on: boolean) => setBusy((prev) => {
    const next = new Set(prev);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    return next;
  });

  const resolve = useMutation({
    mutationFn: ({ ids, note }: { ids: number[]; note: string }) => api.resolveAlerts(ids, note),
    onMutate: ({ ids }) => { setError(null); mark(ids, true); },
    onSuccess: (_, { ids }) => {
      qc.setQueryData<AdminAlert[]>(["admin", "alerts", "open"], (old) => (old ?? []).filter((a) => !ids.includes(a.id)));
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      void qc.invalidateQueries({ queryKey: ["admin", "alerts"] });
      void qc.invalidateQueries({ queryKey: ["admin", "action-items"] });
    },
    onError: (e: Error) => setError(e.message || "Không lưu được — thử lại."),
    onSettled: (_, __, { ids }) => mark(ids, false),
  });
  const reopen = useMutation({
    mutationFn: (id: number) => api.reopenAlert(id),
    onMutate: (id) => { setError(null); mark([id], true); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin", "alerts"] }); void qc.invalidateQueries({ queryKey: ["admin", "action-items"] }); },
    onError: (e: Error) => setError(e.message || "Không mở lại được."),
    onSettled: (_, __, id) => mark([id], false),
  });

  const openCritical = alerts.filter((a) => a.severity === "critical").length;
  const userCount = alerts.filter((a) => a.audience === "user").length;
  const allVisibleSelected = rows.length > 0 && rows.every((a) => selected.has(a.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-line bg-card p-0.5" role="tablist" aria-label="Hộp cảnh báo">
          {([["open", "Cần xử lý"], ["resolved", "Đã xử lý"]] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={url.view === key} onClick={() => url.set({ view: key, severity: "all", type: null })}
              className={cn("h-8 rounded-md px-3 text-[13px] font-medium transition-colors", url.view === key ? "bg-iris-soft text-iris-hi" : "text-muted hover:text-fg")}>
              {label}{key === "open" && url.view === "open" && ` · ${alerts.length}`}
            </button>
          ))}
        </div>
        {url.view === "open" && (
          <p className="text-[12.5px] text-muted">
            <span className={cn("font-semibold", openCritical ? "text-bad" : "text-fg")}>{openCritical} nghiêm trọng</span>
            {" · "}{alerts.length - userCount} sự cố vận hành · {userCount} thông báo người bán/mua
          </p>
        )}
      </div>

      {error && <Banner tone="bad">{error}</Banner>}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã đơn, người bán, nguồn hàng, nội dung…"
              className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-8 text-[13px] focus:border-iris focus:outline-none" />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Xoá tìm kiếm" className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg"><X size={14} /></button>
            )}
          </label>
          <select value={url.type ?? ""} onChange={(e) => url.set({ type: e.target.value || null })}
            className="h-9 max-w-[260px] rounded-lg border border-line bg-surface px-2.5 text-[13px] focus:border-iris focus:outline-none" aria-label="Loại cảnh báo">
            <option value="">Mọi loại ({scoped.length})</option>
            {types.map(([t, n]) => <option key={t} value={t}>{playbook({ type: t, message: t }).title} ({n})</option>)}
          </select>
          <select value={url.audience} onChange={(e) => url.set({ audience: e.target.value as Audience })}
            className="h-9 rounded-lg border border-line bg-surface px-2.5 text-[13px] focus:border-iris focus:outline-none" aria-label="Nhóm">
            <option value="all">Mọi nhóm</option>
            <option value="ops">Sự cố vận hành</option>
            <option value="user">Thông báo người bán/mua</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => query.refetch()} loading={query.isFetching}><RefreshCw size={13} /> Làm mới</Button>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Mức độ">
          {(["all", ...SEVERITY_ORDER] as const).map((s) => {
            const active = url.severity === s;
            const n = s === "all" ? byType.length : sevCounts[s];
            return (
              <button key={s} type="button" role="tab" aria-selected={active} onClick={() => url.set({ severity: s })}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors", active ? "bg-raised font-semibold text-fg" : "text-muted hover:text-fg")}>
                {s !== "all" && <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_META[s].dot)} />}
                {s === "all" ? "Tất cả" : SEVERITY_META[s].label}
                <span className="text-faint">{n}</span>
              </button>
            );
          })}
          {url.view === "open" && rows.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                <input type="checkbox" checked={allVisibleSelected} className="h-4 w-4 accent-[var(--color-iris)]"
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((a) => a.id)) : new Set())} />
                Chọn tất cả đang hiện
              </label>
              {selected.size > 0 && (
                <ResolveControl count={selected.size} busy={resolve.isPending}
                  onResolve={(note) => resolve.mutate({ ids: [...selected], note })} />
              )}
            </div>
          )}
        </div>

        {query.isLoading ? (
          <ul aria-busy="true">{Array.from({ length: 5 }, (_, i) => <li key={i} className="h-[92px] animate-pulse border-b border-line/70 bg-raised/30" />)}</ul>
        ) : query.isError ? (
          <div className="p-8 text-center text-[13px] text-muted">
            Không tải được cảnh báo. <button type="button" className="font-medium text-iris-hi hover:underline" onClick={() => query.refetch()}>Thử lại</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 p-10 text-center">
            <Check size={20} className="text-good" />
            <p className="text-[13.5px] font-semibold text-fg">{url.view === "open" ? "Không còn cảnh báo cần xử lý" : "Chưa có cảnh báo nào được xử lý"}</p>
            {(url.q || url.type || url.severity !== "all" || url.audience !== "all") && (
              <button type="button" className="text-[12.5px] text-iris-hi hover:underline"
                onClick={() => { setSearch(""); url.set({ q: "", type: null, severity: "all", audience: "all" }); }}>Bỏ bộ lọc</button>
            )}
          </div>
        ) : (
          <ul>
            {rows.map((a) => (
              <AlertRow
                key={a.id}
                alert={a}
                view={url.view}
                selected={selected.has(a.id)}
                onSelect={(on) => setSelected((prev) => { const n = new Set(prev); if (on) n.add(a.id); else n.delete(a.id); return n; })}
                busy={busy.has(a.id)}
                onResolve={(note) => resolve.mutate({ ids: [a.id], note })}
                onReopen={() => reopen.mutate(a.id)}
              />
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <p className="border-t border-line px-4 py-2 text-[11.5px] text-faint">
            {rows.length} cảnh báo · {url.view === "open" ? "nghiêm trọng trước, mới nhất trong cùng mức. Sự cố lặp lại được gộp và tự mở lại khi xảy ra tiếp." : "mới xử lý nhất trước (tối đa 300)."}
          </p>
        )}
      </Card>
    </div>
  );
}
