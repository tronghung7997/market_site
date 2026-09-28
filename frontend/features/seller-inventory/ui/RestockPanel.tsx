"use client";

import { useLocale, useTranslations } from "next-intl";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { InventoryPackageDetail, RestockPreview, RestockResult } from "@/lib/types";
import { Button, ProgressBar, Skeleton, Textarea } from "@/components/ui";
import { AlertTriangle, Check, CheckCircle2, Download, Upload, X } from "@/components/Icons";
import {
  RESOURCE_LINE_MAX_LENGTH,
  downloadRestockTemplate,
  isAbortError,
  splitRestockSource,
  tooLongRestockLines,
  type RestockProgress,
} from "../logic";
import { previewRestockInBatches, useRestock } from "../useInventory";
import { useStockSources } from "../useStockSources";
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

export function RestockPanel({ pkg, onClose, onDone }: { pkg: InventoryPackageDetail; onClose: () => void; onDone: (result: RestockResult) => void }) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const restock = useRestock(pkg.variant_id);
  const stock = useStockSources({
    pastedName: t("restock.pastedSource"),
    onReadError: (name) => setOutcome({ tone: "bad", text: t("restock.readFailed", { name }) }),
  });
  const [manualText, setManualText] = useState("");
  const [keepManualHeader, setKeepManualHeader] = useState(false);
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
  const manual = useMemo(() => splitRestockSource(deferredManual), [deferredManual]);
  const items = useMemo(() => {
    const lines = [...stock.lines];
    if (manual.header && keepManualHeader) lines.push(manual.header);
    for (const item of manual.items) lines.push(item);
    return lines;
  }, [stock.lines, manual, keepManualHeader]);
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

  const submit = async () => {
    if (items.length === 0 || tooMany || tooLong.length > 0 || uploading) return;
    setOutcome(null);
    setStopping(false);
    const controller = new AbortController();
    uploadRef.current = controller;
    let reached: RestockProgress | null = null;
    try {
      const result = await restock.mutateAsync({
        items,
        signal: controller.signal,
        onProgress: (next) => { reached = next; setProgress(next); },
      });
      // Closing the panel and the refreshed table re-render together; as a
      // transition React can slice that work instead of freezing the page.
      startTransition(() => {
        stock.clear();
        setManualText("");
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

  const expected = previewData?.expected_field_count ?? pkg.expected_field_count;
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

      <p className="text-[11.5px] text-muted">
        {t("restock.rule")} <code className="rounded bg-raised px-1 font-mono text-fg">user|pass|2fa</code> · <code className="rounded bg-raised px-1 font-mono text-fg">license_key</code>
        {expected && expected > 1 && <> · {t("restock.expectedFields", { count: expected })}</>}
      </p>

      <StockSourceChips sources={stock.sources} reading={stock.reading} onRemove={stock.remove} onToggleHeader={stock.toggleHeader} disabled={uploading} />

      <Textarea
        autoFocus
        rows={hasSources ? 3 : 5}
        value={manualText}
        readOnly={uploading}
        onChange={(e) => { setManualText(e.target.value); setOutcome(null); }}
        onPaste={(event) => { stock.handlePaste(event); }}
        placeholder={hasSources ? t("restock.placeholderMore") : t("restock.placeholder")}
        aria-label={t("restock.title")}
        className="bg-surface font-mono text-xs leading-relaxed"
      />
      {manual.header && (
        <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
          <span className="min-w-0 truncate">
            {keepManualHeader ? t("restock.headerKept") : t("restock.headerSkipped")}
            {" "}<code className="rounded bg-raised px-1 font-mono text-[11px] text-fg">{manual.header.length > 60 ? `${manual.header.slice(0, 60)}…` : manual.header}</code>
          </span>
          <button type="button" onClick={() => setKeepManualHeader((v) => !v)} disabled={uploading} className="font-medium text-iris hover:underline disabled:opacity-50">
            {keepManualHeader ? t("restock.skipHeader") : t("restock.keepHeader")}
          </button>
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-1.5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-busy={checking !== null}>
            <Stat label={t("restock.stat.recognized")} value={items.length.toLocaleString(locale)} hint={stock.sources.length === 1 && !manual.items.length ? stock.sources[0].name : undefined} />
            <Stat label={t("restock.stat.duplicateInFile")} loading={previewLoading} stale={previewStale} value={(previewData?.duplicate_in_file ?? 0).toLocaleString(locale)} tone={(previewData?.duplicate_in_file ?? 0) > 0 ? "warn" : "neutral"} hint={(previewData?.duplicate_in_file ?? 0) > 0 ? t("restock.stat.skipped") : undefined} />
            <Stat label={t("restock.stat.existing")} loading={previewLoading} stale={previewStale} value={(previewData?.existing_in_stock ?? 0).toLocaleString(locale)} tone={(previewData?.existing_in_stock ?? 0) > 0 ? "warn" : "neutral"} hint={(previewData?.existing_in_stock ?? 0) > 0 ? t("restock.stat.skipped") : undefined} />
            <Stat label={t("restock.stat.malformed")} loading={previewLoading} stale={previewStale} value={(previewData?.malformed_total ?? 0).toLocaleString(locale)} tone={(previewData?.malformed_total ?? 0) > 0 ? "bad" : "neutral"} hint={previewData && previewData.malformed.length > 0 ? t("restock.stat.lines", { lines: previewData.malformed.slice(0, 5).map((m) => m.line).join(", ") }) : undefined} />
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

      {previewData && previewData.malformed_total > 0 && expected && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-warn">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t("restock.malformedHint", { expected, count: previewData.malformed_total })}
        </p>
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
          <Button size="sm" loading={uploading} onClick={() => void submit()} disabled={items.length === 0 || tooMany || tooLong.length > 0 || toAdd === 0 || stock.reading.length > 0} className="gap-1.5">
            {uploading ? t("restock.submitting") : <><Check size={13} /> {t("restock.submit", { count: toAdd.toLocaleString(locale) })}</>}
          </Button>
        </div>
      </div>
      {previewData && previewData.to_add === 0 && items.length > 0 && !checking && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><CheckCircle2 size={13} /> {t("restock.nothingNew")}</p>
      )}
    </section>
  );
}
