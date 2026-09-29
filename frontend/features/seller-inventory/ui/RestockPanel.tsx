"use client";

import { useLocale, useTranslations } from "next-intl";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { InventoryPackageDetail, RestockPreview, RestockResult, StockBatchSummary } from "@/lib/types";
import { Button, ProgressBar, Select, Skeleton } from "@/components/ui";
import { AlertTriangle, Check, CheckCircle2, Download, Upload, X } from "@/components/Icons";
import {
  RESOURCE_LINE_MAX_LENGTH,
  checkStockGroup,
  downloadRestockTemplate,
  isAbortError,
  isStockGroupBlocked,
  mismatchedLines,
  tooLongRestockLines,
  type RestockProgress,
} from "../logic";
import { stockAppendLines, stockFormatGroups } from "../stock-sources";
import { previewRestockInBatches, useRestock, type StockUploadGroup } from "../useInventory";
import { useStockSources } from "../useStockSources";
import { useStockFormatChoice } from "../useStockFormatChoice";
import { FormatTextarea } from "./FormatTextarea";
import { StockFormatGroupCard } from "./StockFormatGroupCard";
import { StockFormatToggle } from "./StockFormatToggle";
import { StockSourceChips } from "./StockSourceChips";

const MAX_LINES = 5000;

type Outcome = { tone: "bad" | "warn"; text: string };

function Stat({ label, value, tone = "neutral", hint, loading, stale }: {
  label: string; value: string; tone?: "neutral" | "warn" | "bad" | "good"; hint?: string; loading?: boolean; stale?: boolean;
}) {
  const color = { neutral: "text-fg", warn: "text-warn", bad: "text-bad", good: "text-good" }[tone];
  return (
    <div className={cn("rounded-lg border bg-surface px-3 py-2", tone === "bad" && !loading ? "border-bad/30" : "border-line")}>
      <div className="text-[11px] text-faint">{label}</div>
      {loading ? (
        <Skeleton className="mt-1 h-[18px] w-14" />
      ) : (
        <div className={cn("font-mono text-[15px] font-semibold tabular transition-opacity duration-200", color, stale && "opacity-45")}>
          {value}{hint && <span className="ml-1 text-[11px] font-medium text-faint">· {hint}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Stock upload of a package. A new batch ("lô") takes its format from the
 * first line of each file or paste (and login notes from a `#` line under it);
 * adding to an existing batch sends lines only. Column-count mismatches are
 * warnings: the seller answers for the format buyers are shown.
 */
export function RestockPanel({
  pkg, batches, initialBatchId = null, onClose, onDone,
}: {
  pkg: InventoryPackageDetail;
  batches: readonly StockBatchSummary[];
  /** Open in "add to this batch" mode (from the batch list). */
  initialBatchId?: number | null;
  onClose: () => void;
  onDone: (result: RestockResult) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const restock = useRestock(pkg.variant_id);
  const stock = useStockSources({
    pastedName: t("restock.pastedSource"),
    onReadError: (name) => setOutcome({ tone: "bad", text: t("restock.readFailed", { name }) }),
  });
  const [manualText, setManualText] = useState("");
  const [targetBatchId, setTargetBatchId] = useState<number | null>(initialBatchId);
  const [hasFormat, setHasFormat] = useStockFormatChoice(pkg.variant_key ?? String(pkg.variant_id));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [previewData, setPreviewData] = useState<RestockPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [progress, setProgress] = useState<RestockProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const uploading = restock.isPending;

  // Typing stays responsive: the parse below follows the deferred value.
  const deferredManual = useDeferredValue(manualText);
  const targetBatch = batches.find((batch) => batch.id === targetBatchId) ?? null;
  const groups = useMemo(
    () => (targetBatch ? [] : stockFormatGroups(stock.sources, deferredManual, t("restock.typedSource"), hasFormat)),
    [targetBatch, stock.sources, deferredManual, t, hasFormat],
  );
  const items = useMemo(
    () => (targetBatch ? stockAppendLines(stock.sources, deferredManual, targetBatch.format) : groups.flatMap((group) => group.items)),
    [targetBatch, stock.sources, deferredManual, groups],
  );
  const noteOf = (key: string, fallback: string | null) => notes[key] ?? fallback ?? "";
  const checks = useMemo(() => groups.map((group) => checkStockGroup(group)), [groups]);
  const appendMismatch = useMemo(() => (targetBatch ? mismatchedLines(items, targetBatch.field_count) : null), [targetBatch, items]);
  const mismatchTotal = appendMismatch ? appendMismatch.total : checks.reduce((sum, check) => sum + (check?.mismatch.total ?? 0), 0);
  // No account under a format, or line 1 is an account with no format typed.
  const blockedGroups = useMemo(() => groups.filter(isStockGroupBlocked).length, [groups]);
  const tooMany = items.length > MAX_LINES;
  const tooLong = useMemo(() => tooLongRestockLines(items), [items]);

  // Live server preview (stock lookups + field counts). A newer upload aborts
  // the older run between batches instead of letting stale results land.
  useEffect(() => {
    if (items.length === 0 || tooMany) {
      setPreviewData(null); setPreviewError(null); setChecking(null);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(() => {
      setChecking({ done: 0, total: items.length });
      previewRestockInBatches(pkg.variant_id, items, {
        signal: controller.signal,
        onProgress: (done, total) => { if (!controller.signal.aborted) setChecking({ done, total }); },
      })
        .then((data) => { if (!controller.signal.aborted) { setPreviewData(data); setPreviewError(null); } })
        .catch((err) => {
          if (controller.signal.aborted || isAbortError(err)) return;
          setPreviewData(null);
          setPreviewError(apiErrorMessage(err, t("restock.failed")));
        })
        .finally(() => { if (!controller.signal.aborted) setChecking(null); });
    }, 350);
    return () => { clearTimeout(handle); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tooMany, pkg.variant_id]);

  // Leaving mid-upload would stop the remaining batches silently.
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  useEffect(() => () => uploadRef.current?.abort(), []);

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    setOutcome(null);
    void stock.addFiles(files);
  };

  const uploadGroups = (): StockUploadGroup[] => (targetBatch
    ? [{ items, batchId: targetBatch.id }]
    : groups.filter((group) => group.items.length > 0 && (group.format || group.unformatted)).map((group) => ({
      items: group.items, format: group.format, loginNote: group.unformatted ? null : noteOf(group.key, group.note).trim() || null,
    })));

  const submit = async () => {
    if (items.length === 0 || tooMany || tooLong.length > 0 || blockedGroups > 0 || uploading) return;
    setOutcome(null);
    setStopping(false);
    const controller = new AbortController();
    uploadRef.current = controller;
    let reached: RestockProgress | null = null;
    try {
      const result = await restock.mutateAsync({
        groups: uploadGroups(),
        signal: controller.signal,
        onProgress: (next) => { reached = next; setProgress(next); },
      });
      // Closing the panel and the refreshed table re-render together; as a
      // transition React can slice that work instead of freezing the page.
      startTransition(() => {
        stock.clear();
        setManualText("");
        setNotes({});
        setPreviewData(null);
        setPreviewError(null);
        onDone(result);
      });
    } catch (err) {
      const saved = reached as RestockProgress | null;
      const counts = saved
        ? { done: saved.done.toLocaleString(locale), total: saved.total.toLocaleString(locale), added: saved.added.toLocaleString(locale) }
        : { done: "0", total: items.length.toLocaleString(locale), added: "0" };
      if (isAbortError(err)) {
        setOutcome({ tone: "warn", text: t("restock.stopped", counts) });
      } else {
        const message = apiErrorMessage(err, t("restock.failed"));
        // Earlier batches are committed; the lines stay so a retry sends only what is missing.
        setOutcome({ tone: "bad", text: saved && saved.done > 0 ? t("restock.partialFailed", { ...counts, error: message }) : message });
      }
    } finally {
      uploadRef.current = null;
      setProgress(null);
      setStopping(false);
    }
  };

  const stop = () => {
    setStopping(true);
    uploadRef.current?.abort();
  };

  const toAdd = previewData?.to_add ?? items.length;
  const previewLoading = checking !== null && previewData === null;
  const previewStale = checking !== null && previewData !== null;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const hasSources = stock.sources.length > 0 || stock.reading.length > 0;

  return (
    <section aria-label={t("restock.title")} className="space-y-3 rounded-xl border border-iris/35 bg-iris-soft/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <Upload size={14} className="text-iris" />
          {t("restock.title")} <span className="text-iris-hi">{pkg.variant_name}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => downloadRestockTemplate("txt", "sample_inventory_template")} className="h-7 gap-1 text-[11.5px] text-iris"><Download size={12} /> {t("restock.template")}</Button>
          <label className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-line-2 bg-raised px-2 text-[11.5px] font-medium text-fg hover:border-faint focus-within:ring-2 focus-within:ring-iris/40",
            uploading && "pointer-events-none opacity-50",
          )}>
            <Upload size={12} /> {t("restock.upload")}
            {/* Visually hidden but focusable through its label (Input's w-full would defeat sr-only). */}
            <input type="file" accept=".txt,.csv" multiple disabled={uploading} onChange={handleFiles} className="sr-only" />
          </label>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={uploading} aria-label={t("restock.close")} className="h-7 w-7 p-0 text-muted"><X size={14} /></Button>
        </div>
      </div>

      {batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t("restock.modeLabel")} className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12px] font-medium">
            {([["new", t("restock.modeNew")], ["append", t("restock.modeAppend")]] as const).map(([mode, label]) => {
              const active = (mode === "append") === (targetBatchId !== null);
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={uploading}
                  onClick={() => setTargetBatchId(mode === "append" ? (targetBatchId ?? batches[0].id) : null)}
                  className={cn("h-8 rounded-md px-3 transition-colors", active ? "bg-iris-soft text-iris-hi" : "text-muted hover:text-fg")}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {targetBatchId !== null && (
            <Select
              aria-label={t("restock.pickBatch")}
              value={String(targetBatchId)}
              disabled={uploading}
              onChange={(event) => setTargetBatchId(Number(event.target.value))}
              className="h-9 w-auto min-w-0 max-w-full flex-1 font-mono text-[12px]"
            >
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.format} · {t("batches.inStock", { count: batch.available })}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}

      {targetBatch
        ? (
          <p className="text-[11.5px] leading-relaxed text-muted">
            {t("format.appendRule")} <code className="rounded bg-raised px-1 font-mono text-fg">{targetBatch.format}</code>{targetBatch.login_note && <> · {targetBatch.login_note}</>}
          </p>
        )
        : <StockFormatToggle checked={hasFormat} onChange={setHasFormat} disabled={uploading} />}

      <StockSourceChips sources={stock.sources} reading={stock.reading} onRemove={stock.remove} disabled={uploading} />

      <FormatTextarea
        autoFocus
        highlight={!targetBatch && hasFormat}
        rows={hasSources ? 3 : 5}
        value={manualText}
        readOnly={uploading}
        onChange={(e) => { setManualText(e.target.value); setOutcome(null); }}
        onPaste={(event) => { stock.handlePaste(event); }}
        placeholder={hasSources ? t("restock.placeholderMore") : targetBatch || !hasFormat ? t("restock.placeholder") : t("restock.placeholderFormat")}
        aria-label={t("restock.title")}
        className="bg-surface font-mono text-xs leading-relaxed"
      />
      {groups.length > 0 && (
        <div className="space-y-2">
          {groups.map((group) => (
            <StockFormatGroupCard
              key={group.key}
              group={group}
              name={groups.length > 1 || group.key !== "typed" ? group.name : undefined}
              note={noteOf(group.key, group.note)}
              onNoteChange={(value) => setNotes((prev) => ({ ...prev, [group.key]: value }))}
              onFormatChange={group.sourceId === undefined ? undefined : (value) => stock.setFormat(group.sourceId as number, value)}
              onUseFormat={() => setHasFormat(true)}
              onDisableFormat={() => setHasFormat(false)}
              disabled={uploading}
            />
          ))}
        </div>
      )}
      {appendMismatch && appendMismatch.total > 0 && targetBatch && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-warn">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t("format.mismatch", { count: appendMismatch.total, lines: appendMismatch.lines.slice(0, 6).join(", ") })}
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-1.5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-busy={checking !== null}>
            <Stat label={t("restock.stat.recognized")} value={items.length.toLocaleString(locale)} hint={stock.sources.length === 1 && !manualText.trim() ? stock.sources[0].name : undefined} />
            <Stat label={t("restock.stat.duplicateInFile")} loading={previewLoading} stale={previewStale} value={(previewData?.duplicate_in_file ?? 0).toLocaleString(locale)} tone={(previewData?.duplicate_in_file ?? 0) > 0 ? "warn" : "neutral"} hint={(previewData?.duplicate_in_file ?? 0) > 0 ? t("restock.stat.skipped") : undefined} />
            <Stat label={t("restock.stat.existing")} loading={previewLoading} stale={previewStale} value={(previewData?.existing_in_stock ?? 0).toLocaleString(locale)} tone={(previewData?.existing_in_stock ?? 0) > 0 ? "warn" : "neutral"} hint={(previewData?.existing_in_stock ?? 0) > 0 ? t("restock.stat.skipped") : undefined} />
            <Stat label={t("restock.stat.malformed")} value={mismatchTotal.toLocaleString(locale)} tone={mismatchTotal > 0 ? "warn" : "neutral"} />
          </div>
          <p aria-live="polite" className="flex min-h-[16px] items-center gap-1.5 text-[11px] text-faint">
            {checking && (
              <>
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-iris border-t-transparent" />
                {t("restock.checking", { done: checking.done.toLocaleString(locale), total: checking.total.toLocaleString(locale) })}
              </>
            )}
          </p>
        </div>
      )}

      {tooLong.length > 0 && (
        <p role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2 text-xs font-medium text-bad">
          {t("restock.tooLong", { lines: tooLong.slice(0, 5).join(", "), count: tooLong.length, max: RESOURCE_LINE_MAX_LENGTH.toLocaleString(locale) })}
        </p>
      )}
      {tooMany && (
        <p role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2 text-xs font-medium text-bad">{t("restock.tooMany", { max: MAX_LINES.toLocaleString(locale) })}</p>
      )}
      {previewError && !outcome && <p role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2 text-xs font-medium text-bad">{previewError}</p>}
      {outcome && (
        <p role="alert" className={cn("rounded-lg border p-2 text-xs font-medium", outcome.tone === "bad" ? "border-bad/20 bg-bad-soft text-bad" : "border-warn/20 bg-warn-soft text-warn")}>{outcome.text}</p>
      )}

      {uploading && progress && (
        <div className="space-y-1.5 animate-fade-in">
          <ProgressBar value={progress.done} max={progress.total} label={t("restock.progressLabel")} />
          <p aria-live="polite" className="flex flex-wrap justify-between gap-2 text-[11.5px] text-muted">
            <span className="font-mono tabular">
              {t("restock.uploadProgress", { done: progress.done.toLocaleString(locale), total: progress.total.toLocaleString(locale), percent, added: progress.added.toLocaleString(locale) })}
            </span>
            {stopping && <span className="text-warn">{t("restock.stopping")}</span>}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11.5px] text-faint">{t("restock.dedupe")}</span>
        <div className="flex items-center gap-2">
          {uploading ? (
            <Button size="sm" variant="secondary" onClick={stop} disabled={stopping}>{t("restock.stop")}</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onClose}>{t("restock.cancel")}</Button>
          )}
          <Button
            size="sm"
            loading={uploading}
            onClick={() => void submit()}
            disabled={items.length === 0 || tooMany || tooLong.length > 0 || toAdd === 0 || blockedGroups > 0 || stock.reading.length > 0}
            className="gap-1.5"
          >
            {uploading
              ? t("restock.submitting")
              : <><Check size={13} /> {t(mismatchTotal > 0 ? "restock.submitAnyway" : "restock.submit", { count: toAdd.toLocaleString(locale) })}</>}
          </Button>
        </div>
      </div>
      {previewData && previewData.to_add === 0 && items.length > 0 && !checking && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><CheckCircle2 size={13} /> {t("restock.nothingNew")}</p>
      )}
    </section>
  );
}
