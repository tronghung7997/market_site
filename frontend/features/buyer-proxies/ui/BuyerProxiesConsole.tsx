"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { Button, Card, Input, Pagination, Select } from "@/components/ui";
import { AlertTriangle, Globe, Search, Upload, X } from "@/components/Icons";
import {
  DEFAULT_FILTERS, EXPIRY_FILTERS, IP_TYPES, PAGE_SIZES, PROXY_SORTS, ROTATIONS, UNTAGGED, bulkCounts, hasActiveProxyFilters,
  isExpired, proxyFiltersToQuery, type BulkResult, type ExpiryFilter, type ProxyFilters, type ProxyIpType, type ProxyLine,
  type ProxyRotation, type ProxySort, type ProxyTag, type TagTone,
} from "../model";
import {
  ensureTag, fetchAllProxyLines, importTags, rotateLines, useAllProxyLines, useInvalidateProxies, usePatchCachedLine,
  useProxyLineLookup, useProxyLines, useProxyTags, whitelistLines,
} from "../useBuyerProxies";
import { useProxiesUrl } from "../useProxiesUrl";
import { ProxiesSummaryStrip } from "./ProxiesSummaryStrip";
import { ProxyFilterRail } from "./ProxyFilterRail";
import { ProxiesTable, ProxyLineCard, type LineActionHandlers } from "./ProxiesTable";
import { ProxyBulkBar, type BulkAction } from "./ProxyBulkBar";
import { ExportDialog, ManageTagsDialog, TagAssignDialog, WhitelistDialog, type TagChange } from "./ProxyDialogs";
import { ProxyDetailsDialog } from "./ProxyDetailsDialog";

export function BuyerProxiesSkeleton() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true">
      <div className="space-y-1.5"><div className="h-6 w-44 rounded bg-raised" /><div className="h-3.5 w-72 rounded bg-raised" /></div>
      <div className="h-[84px] rounded-xl border border-line bg-raised" />
      <div className="grid gap-4 lg:grid-cols-[200px_1fr]"><div className="hidden h-[420px] rounded-xl border border-line bg-raised lg:block" /><div className="h-[520px] rounded-xl border border-line bg-raised" /></div>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="animate-pulse divide-y divide-line" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3.5">
          <div className="h-3.5 w-3.5 rounded bg-raised" />
          <div className="h-3 w-20 rounded bg-raised" />
          <div className="h-3 w-40 rounded bg-raised" />
          <div className="hidden h-3 w-24 rounded bg-raised md:block" />
          <div className="ml-auto h-3 w-16 rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}

type DialogState =
  | { kind: "tag"; lines: ProxyLine[] }
  | { kind: "importTags" }
  | { kind: "export"; lines: ProxyLine[] }
  | { kind: "whitelist"; lines: ProxyLine[] }
  | { kind: "manageTags" }
  | null;

type NoticeTone = "good" | "bad" | "warn";

export function BuyerProxiesConsole() {
  const t = useTranslations("buyerProxies");
  const tc = useTranslations("common");
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const { account, loading: authLoading } = useAuth();
  const accountId = account?.id;
  const enabled = Boolean(account);
  const url = useProxiesUrl();
  const { filters } = url;

  const list = useProxyLines(filters, accountId, enabled);
  const tagsQuery = useProxyTags(accountId, enabled);
  const invalidate = useInvalidateProxies(accountId);
  const patchCached = usePatchCachedLine(accountId);

  const pageLines = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const summary = list.data?.summary ?? null;
  const facets = list.data?.facets ?? null;
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);
  const tagMap = useMemo(() => new Map(tags.map((tg) => [tg.id, tg])), [tags]);
  const tagName = useCallback((id: string) => tagMap.get(id)?.name ?? id, [tagMap]);
  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));

  const patch = useCallback((p: Partial<ProxyFilters>) => url.setFilters({ ...filters, ...p }), [filters, url]);
  const reset = () => url.setFilters({ ...DEFAULT_FILTERS });

  // A page past the end (lines expired away, a stale link) snaps back to the last page.
  useEffect(() => {
    if (list.data && !list.isPlaceholderData && total > 0 && filters.page > totalPages) patch({ page: totalPages });
  }, [list.data, list.isPlaceholderData, total, filters.page, totalPages, patch]);

  /* ---------- notices */
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), tone === "bad" ? 6000 : 3600);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  /* ---------- selection: snapshots, so it can span pages */
  const [selected, setSelected] = useState<Map<string, ProxyLine>>(new Map());
  const lastClick = useRef<string | null>(null);
  useEffect(() => {
    // Keep selected snapshots fresh with whatever the current page just loaded.
    setSelected((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const l of pageLines) if (next.has(l.id) && next.get(l.id) !== l) { next.set(l.id, l); changed = true; }
      return changed ? next : prev;
    });
  }, [pageLines]);
  const toggle = useCallback((id: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const byId = new Map(pageLines.map((l) => [l.id, l]));
      if (shift && lastClick.current) {
        const ids = pageLines.map((l) => l.id);
        const a = ids.indexOf(lastClick.current); const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.set(x, byId.get(x)!);
          lastClick.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else { const line = byId.get(id); if (line) next.set(id, line); }
      lastClick.current = id;
      return next;
    });
  }, [pageLines]);
  const togglePage = useCallback(() => {
    setSelected((prev) => {
      const next = new Map(prev);
      const all = pageLines.every((l) => next.has(l.id));
      for (const l of pageLines) { if (all) next.delete(l.id); else next.set(l.id, l); }
      return next;
    });
  }, [pageLines]);
  const clearSelection = () => setSelected(new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const selectAllFiltered = async () => {
    setSelectingAll(true);
    try {
      const all = await fetchAllProxyLines(proxyFiltersToQuery(filters));
      setSelected(new Map(all.map((l) => [l.id, l])));
    } catch (error) {
      showNotice("bad", apiErrorMessage(error, t("notice.loadFailed")));
    } finally { setSelectingAll(false); }
  };
  const selectedLines = useMemo(() => [...selected.values()], [selected]);
  const capabilities = useMemo(() => ({
    rotate: selectedLines.filter((l) => l.rotation_available && !isExpired(l)).length,
    whitelist: selectedLines.filter((l) => l.whitelist_supported).length,
  }), [selectedLines]);

  /** Apply a server-confirmed change to the cached pages and the selection. */
  const patchLine = useCallback((id: string, p: Partial<ProxyLine>) => {
    patchCached(id, p);
    setSelected((prev) => {
      const cur = prev.get(id);
      return cur ? new Map(prev).set(id, { ...cur, ...p }) : prev;
    });
  }, [patchCached]);

  /* ---------- async work */
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const reportRotate = (r: BulkResult) => {
    const c = bulkCounts(r);
    const skipped = c.cooldown + c.unsupported + c.expired;
    const parts: string[] = [];
    if (c.ok > 0 || skipped > 0) parts.push(c.ok === 0 ? t("notice.rotateDoneNone", { skipped }) : t("notice.rotateDone", { ok: c.ok, skipped }));
    if (c.failed > 0) parts.push(t("notice.rotateFailed", { n: c.failed }));
    const tone: NoticeTone = c.failed > 0 && c.ok === 0 ? "bad" : c.failed > 0 || skipped > 0 ? "warn" : "good";
    showNotice(tone, parts.join(" · "));
  };

  const runRotate = async (lines: ProxyLine[]) => {
    if (lines.length === 0) return;
    const single = lines.length === 1 ? lines[0].id : null;
    if (single) setBusyLine(single);
    else { setBusy("rotate"); setProgress({ done: 0, total: lines.length }); }
    try {
      reportRotate(await rotateLines(lines, patchLine, single ? undefined : (done) => setProgress({ done, total: lines.length })));
    } finally {
      setBusy(null); setProgress(null); setBusyLine(null);
      void invalidate();
    }
  };

  const onBulk = (action: BulkAction) => {
    if (action === "rotate") void runRotate(selectedLines.filter((l) => l.rotation_available));
    else setDialog({ kind: action, lines: selectedLines });
  };

  const handlers = useMemo<LineActionHandlers>(() => ({
    onOpen: (line) => url.openLine(line.id),
    onRotate: (line) => { void runRotate([line]); },
    onTag: (line) => setDialog({ kind: "tag", lines: [line] }),
    onCopied: (ok) => showNotice(ok ? "good" : "bad", ok ? t("notice.copied") : t("notice.copyFailed")),
    // runRotate closes over patchLine/invalidate only, both stable per account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [url, t, showNotice, patchLine, invalidate]);

  /* ---------- tags */
  const refreshTags = () => queryClient.invalidateQueries({ queryKey: queryKeys.proxyTags(accountId) });
  const createTag = async (name: string, tone: TagTone): Promise<ProxyTag | null> => {
    try {
      const tag = await ensureTag(name, tone, tags);
      void refreshTags();
      return tag;
    } catch (error) {
      showNotice("bad", apiErrorMessage(error, t("notice.tagFailed")));
      return null;
    }
  };
  const tagOp = async (op: () => Promise<unknown>): Promise<boolean> => {
    try { await op(); return true; } catch (error) { showNotice("bad", apiErrorMessage(error, t("notice.tagFailed"))); return false; } finally { void invalidate(); }
  };
  const applyTags = async (lines: ProxyLine[], change: TagChange, mode: "merge" | "replace", perLine?: Map<string, string[]>) => {
    try {
      if (perLine) {
        const n = await importTags(perLine, tags);
        showNotice("good", t("notice.tagsImported", { n }));
      } else {
        await api.myProxies.assignTags({ line_ids: lines.map((l) => l.id), add: change.add, remove: change.remove, mode });
        showNotice("good", t("notice.tagsApplied", { n: lines.length }));
        // Selected snapshots carry tag_ids too; the page refetch refreshes those on screen.
        setSelected((prev) => {
          if (!lines.some((l) => prev.has(l.id))) return prev;
          const next = new Map(prev);
          for (const l of lines) {
            const cur = next.get(l.id);
            if (!cur) continue;
            const base = mode === "replace" ? [] : cur.tag_ids.filter((id) => !change.remove.includes(id));
            next.set(l.id, { ...cur, tag_ids: [...new Set([...base, ...change.add])] });
          }
          return next;
        });
      }
    } catch (error) {
      showNotice("bad", apiErrorMessage(error, t("notice.tagFailed")));
      throw error;
    } finally {
      void invalidate();
    }
  };

  /* ---------- whitelist + note */
  const applyWhitelist = async (lines: ProxyLine[], ip: string) => {
    const r = await whitelistLines(lines, ip, patchLine);
    void invalidate();
    const c = bulkCounts(r);
    if (c.ok === 0) {
      showNotice("bad", t("notice.whitelistFailed", { n: c.failed }));
      throw new Error("whitelist failed");
    }
    const failedPart = c.failed > 0 ? ` · ${t("notice.whitelistFailedPart", { n: c.failed })}` : "";
    if (!ip) showNotice(c.failed ? "warn" : "good", t("notice.whitelistCleared", { n: c.ok }) + failedPart);
    else if (r.applied.length === c.ok) showNotice(c.failed ? "warn" : "good", t("notice.whitelistApplied", { n: c.ok }) + failedPart);
    else showNotice("warn", t("notice.whitelistSaved", { n: c.ok, applied: r.applied.length }) + failedPart);
  };
  const saveNote = async (line: ProxyLine, note: string): Promise<boolean> => {
    try {
      const updated = await api.myProxies.setNote(line.id, note);
      patchLine(line.id, { note: updated?.note ?? note });
      showNotice("good", t("notice.noteSaved"));
      return true;
    } catch (error) {
      showNotice("bad", apiErrorMessage(error, t("notice.noteFailed")));
      return false;
    }
  };

  /* ---------- search box (debounced → URL) */
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search, 250);
  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => { if (debounced.trim() !== filters.search.trim()) patch({ search: debounced, page: 1 }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- deep-linked line + header import */
  const lookup = useProxyLineLookup(url.lineId, list.data?.items, accountId, enabled);
  const openLine = lookup.line;
  const { closeLine } = url;
  useEffect(() => {
    if (!lookup.missing) return;
    showNotice("warn", t("notice.lineNotFound"));
    closeLine();
  }, [lookup.missing, closeLine, showNotice, t]);
  const importOpen = dialog?.kind === "importTags";
  const allLines = useAllProxyLines(accountId, enabled && importOpen);

  if (authLoading || !account) return <BuyerProxiesSkeleton />;

  const active = hasActiveProxyFilters(filters);
  const nothingAtAll = summary?.all === 0 && !active;
  const firstLoad = !list.data && list.isPending;
  const loadError = !list.data && list.isError;
  const refreshing = list.isFetching && list.isPlaceholderData;
  const dialogLines = dialog && "lines" in dialog ? dialog.lines : [];
  // The header import works on every line; its "pick" tab then tags all of them.
  const tagDialogLines = importOpen ? allLines.data ?? [] : dialogLines;

  return (
    <div className="space-y-5">
      {notice && (
        <div role="status" aria-live="polite" className={cn(
          "fixed right-4 top-4 z-[90] max-w-[calc(100vw-2rem)] rounded-xl border px-4 py-2.5 text-[13px] font-semibold shadow-card-lg sm:right-5 sm:top-5",
          notice.tone === "good" && "border-good/25 bg-good-soft text-good",
          notice.tone === "warn" && "border-warn/25 bg-warn-soft text-warn",
          notice.tone === "bad" && "border-bad/25 bg-bad-soft text-bad",
        )}>{notice.text}</div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-[26px] font-semibold tracking-tight text-fg">{t("title")}</h1>
          <p className="text-[12.5px] text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={nothingAtAll || firstLoad} onClick={() => setDialog({ kind: "importTags" })}><Upload size={13} /> {t("importTags")}</Button>
          <Link href="/categories"><Button size="sm"><Globe size={13} /> {t("buyMore")}</Button></Link>
        </div>
      </div>

      <ProxiesSummaryStrip summary={facets?.status ?? null} total={summary} active={filters.tab} onSelect={(tab) => patch({ tab, page: 1 })} />

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <ProxyFilterRail filters={filters} tags={tags} facets={facets} onChange={patch} onManageTags={() => setDialog({ kind: "manageTags" })} className="hidden self-start lg:block" />

        <Card className="relative overflow-hidden p-0">
          <div className="flex flex-col gap-2.5 border-b border-line bg-raised/30 p-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-2.5 text-faint"><Search size={13} /></span>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="h-8.5 rounded-lg bg-surface pl-8 pr-7 text-xs" />
              {search && <button type="button" onClick={() => setSearch("")} aria-label={t("clearSearch")} className="absolute right-1.5 top-1.5 grid h-5.5 w-5.5 place-items-center rounded text-faint hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"><X size={12} /></button>}
            </div>
            {/* Mobile: type / rotation / expiry selects replace the rail */}
            <div className="grid grid-cols-3 gap-2 lg:hidden">
              <Select value={filters.ipTypes[0] ?? ""} onChange={(e) => patch({ ipTypes: e.target.value ? [e.target.value as ProxyIpType] : [], page: 1 })} aria-label={t("rail.ipType")} className="h-10 bg-surface text-xs md:h-8.5">
                <option value="">{t("rail.ipTypeAll")}</option>
                {IP_TYPES.map((v) => <option key={v} value={v}>{t(`ipType.${v}`)}</option>)}
              </Select>
              <Select value={filters.rotations[0] ?? ""} onChange={(e) => patch({ rotations: e.target.value ? [e.target.value as ProxyRotation] : [], page: 1 })} aria-label={t("rail.rotation")} className="h-10 bg-surface text-xs md:h-8.5">
                <option value="">{t("rail.rotationAll")}</option>
                {ROTATIONS.map((v) => <option key={v} value={v}>{t(`rotation.${v}`)}</option>)}
              </Select>
              <Select value={filters.expiry} onChange={(e) => patch({ expiry: e.target.value as ExpiryFilter, page: 1 })} aria-label={t("rail.expiry")} className="h-10 bg-surface text-xs md:h-8.5">
                <option value="">{t("rail.expiryAll")}</option>
                {EXPIRY_FILTERS.filter(Boolean).map((e) => <option key={e} value={e}>{t(`expiry.${e}`)}</option>)}
              </Select>
            </div>
            <Select value={filters.sort} onChange={(e) => patch({ sort: e.target.value as ProxySort, page: 1 })} aria-label={t("sortLabel")} className="h-10 bg-surface text-xs md:h-8.5 md:w-48">
              {PROXY_SORTS.map((s) => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
            </Select>
            {active && <Button size="sm" variant="ghost" onClick={reset} className="h-8.5"><X size={12} /> {t("clearFilters")}</Button>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-[12px] text-muted">
            <span aria-live="polite">{list.data ? t("resultSummary", { shown: pageLines.length, total }) : t("loading")}</span>
            {filters.tags.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                {filters.tags.map((id) => (
                  <button key={id} type="button" onClick={() => patch({ tags: filters.tags.filter((x) => x !== id), page: 1 })} aria-label={t("removeFilter", { name: id === UNTAGGED ? t("rail.untagged") : tagName(id) })} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
                    {id === UNTAGGED ? t("rail.untagged") : tagName(id)} <X size={10} />
                  </button>
                ))}
              </span>
            )}
          </div>

          {tagsQuery.isError && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-warn-soft/40 px-3 py-2 text-[12px] text-warn">
              <span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} /> {t("tagsLoadError")}</span>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => void tagsQuery.refetch()}>{t("retry")}</Button>
            </div>
          )}

          {firstLoad ? <RowsSkeleton /> : loadError ? (
            <div className="space-y-2 px-4 py-12 text-center" role="alert">
              <AlertTriangle size={32} className="mx-auto text-bad" />
              <p className="text-[13.5px] font-medium text-fg">{t("error.title")}</p>
              <p className="text-xs text-muted">{apiErrorMessage(list.error, t("error.hint"))}</p>
              <div className="pt-2"><Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("retry")}</Button></div>
            </div>
          ) : (
            <div aria-busy={refreshing} className={cn("transition-opacity", refreshing && "opacity-60")}>
              <div className="space-y-3 p-3 md:hidden">
                {pageLines.length === 0
                  ? <EmptyBlock nothingAtAll={nothingAtAll} filtered={active} onReset={reset} />
                  : pageLines.map((l) => <ProxyLineCard key={l.id} line={l} tags={tagMap} selected={selected.has(l.id)} onToggle={() => toggle(l.id, false)} handlers={handlers} busy={busyLine === l.id} />)}
              </div>
              <div className="hidden md:block">
                <ProxiesTable lines={pageLines} tags={tagMap} selected={new Set(selected.keys())} onToggle={toggle} onTogglePage={togglePage} handlers={handlers} busyLine={busyLine}
                  empty={<EmptyBlock nothingAtAll={nothingAtAll} filtered={active} onReset={reset} />} />
              </div>
            </div>
          )}

          {total > 0 && (
            <div className="flex flex-col gap-2 border-t border-line bg-raised/20 p-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
              <span className="tabular">{t("showing", { from: (filters.page - 1) * filters.perPage + 1, to: Math.min(filters.page * filters.perPage, total), total })}</span>
              <div className="flex items-center gap-3">
                <Pagination page={Math.min(filters.page, totalPages)} totalPages={totalPages} onChange={(p) => patch({ page: p })} />
                <Select value={filters.perPage} onChange={(e) => patch({ perPage: Number(e.target.value), page: 1 })} aria-label={t("perPageAria")} className="h-8 rounded-lg bg-surface px-2.5 text-xs">
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{tc("perPage", { n })}</option>)}
                </Select>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Outside the card: `overflow-hidden` there would turn the card into the sticky container. */}
      <ProxyBulkBar count={selected.size} filteredTotal={total} busy={busy} selectingAll={selectingAll} progress={progress} onAction={onBulk}
        onSelectAllFiltered={() => void selectAllFiltered()} onClear={clearSelection} capabilities={capabilities} />

      {/* ---------- dialogs */}
      <TagAssignDialog
        open={dialog?.kind === "tag" || importOpen}
        initialTab={importOpen ? "import" : "pick"}
        lines={tagDialogLines}
        linesLoading={importOpen && allLines.isPending}
        tags={tags}
        onClose={() => setDialog(null)}
        onCreateTag={createTag}
        onApply={(change, mode, perLine) => applyTags(tagDialogLines, change, mode, perLine)}
      />
      <ManageTagsDialog open={dialog?.kind === "manageTags"} tags={tags} onClose={() => setDialog(null)}
        onCreate={(name, tone) => tagOp(() => ensureTag(name, tone, tags))}
        onUpdate={(id, p) => tagOp(() => api.myProxies.updateTag(id, p))}
        onDelete={async (id) => {
          const ok = await tagOp(() => api.myProxies.deleteTag(id));
          if (ok && filters.tags.includes(id)) patch({ tags: filters.tags.filter((x) => x !== id), page: 1 });
          return ok;
        }} />
      <ExportDialog open={dialog?.kind === "export"} lines={dialogLines} tagName={tagName} onClose={() => setDialog(null)} />
      <WhitelistDialog open={dialog?.kind === "whitelist"} lines={dialogLines} onClose={() => setDialog(null)} onConfirm={(ip) => applyWhitelist(dialogLines, ip)} />

      {openLine && (
        <ProxyDetailsDialog
          key={openLine.id}
          line={openLine}
          tags={tagMap}
          rotating={busyLine === openLine.id}
          onClose={url.closeLine}
          onRotate={() => handlers.onRotate(openLine)}
          onTag={() => handlers.onTag(openLine)}
          onWhitelist={() => setDialog({ kind: "whitelist", lines: [openLine] })}
          onNote={(note) => saveNote(openLine, note)}
        />
      )}
    </div>
  );
}

function EmptyBlock({ nothingAtAll, filtered, onReset }: { nothingAtAll: boolean; filtered: boolean; onReset: () => void }) {
  const t = useTranslations("buyerProxies");
  return (
    <div className="space-y-2 px-4 py-12 text-center">
      <Globe size={36} className="mx-auto text-faint" />
      <p className="text-[13.5px] font-medium text-fg">{nothingAtAll ? t("empty.title") : t("empty.filteredTitle")}</p>
      <p className="text-xs text-muted">{nothingAtAll ? t("empty.hint") : t("empty.filteredHint")}</p>
      <div className="pt-2">
        {nothingAtAll ? <Link href="/categories"><Button size="sm">{t("buyMore")}</Button></Link>
          : filtered ? <Button size="sm" variant="secondary" onClick={onReset}>{t("clearFilters")}</Button> : null}
      </div>
    </div>
  );
}
