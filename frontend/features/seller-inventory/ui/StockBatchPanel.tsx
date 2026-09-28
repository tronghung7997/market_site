"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { downloadFromBff } from "@/lib/download";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import type { StockBatchList, StockBatchSummary } from "@/lib/types";
import { Button, Card, Input, Skeleton, Tag } from "@/components/ui";
import { AlertTriangle, Download, Edit2, Plus } from "@/components/Icons";
import { cleanLoginNote, restockFieldCount } from "../logic";
import { useAssignStockFormat, useUpdateStockBatch } from "../useInventory";

type Notify = (tone: "good" | "bad" | "warn", text: string) => void;

function FormatEditor({
  initialFormat, initialNote, expectedFields, hint, busy, submitLabel, onSubmit, onCancel,
}: {
  initialFormat: string;
  initialNote: string;
  /** Columns the stock lines have, to flag a format that disagrees. */
  expectedFields?: number;
  hint?: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (format: string, note: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("sellerInventory");
  const [format, setFormat] = useState(initialFormat);
  const [note, setNote] = useState(initialNote);
  const trimmed = format.trim();
  const fields = trimmed ? restockFieldCount(trimmed) : 0;
  const mismatch = expectedFields !== undefined && trimmed !== "" && fields !== expectedFields;
  return (
    <form
      className="space-y-2 rounded-lg border border-iris/30 bg-iris-soft/15 p-3"
      onSubmit={(event) => { event.preventDefault(); if (trimmed) onSubmit(trimmed, note); }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="space-y-1">
          <span className="text-[12px] font-medium text-muted">{t("batches.formatLabel")}</span>
          <Input
            value={format}
            onChange={(event) => setFormat(event.target.value.replace(/[\r\n]+/g, " "))}
            maxLength={500}
            required
            placeholder="UID|PASS|2FA|MAIL"
            aria-invalid={mismatch || undefined}
            className="h-9 font-mono text-[12.5px]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] font-medium text-muted">{t("format.noteLabel")} <span className="font-normal text-faint">· {t("format.noteOptional")}</span></span>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder={t("format.notePlaceholder")}
            className="h-9 text-[12.5px]"
          />
        </label>
      </div>
      {mismatch && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-warn">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {t("batches.columnsHint", { format: fields, lines: expectedFields })}
        </p>
      )}
      {hint && <p className="text-[11.5px] text-muted">{hint}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{t("batches.cancel")}</Button>
        <Button type="submit" size="sm" loading={busy} disabled={!trimmed}>{submitLabel}</Button>
      </div>
    </form>
  );
}

function BatchRow({ batch, onAddMore, onNotice }: { batch: StockBatchSummary; onAddMore: (batchId: number) => void; onNotice: Notify }) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const update = useUpdateStockBatch();
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const save = async (format: string, note: string) => {
    const loginNote = cleanLoginNote(note);
    try {
      const saved = await update.mutateAsync({
        batchId: batch.id, format, ...(loginNote ? { login_note: loginNote } : { clear_note: true }),
      });
      setEditing(false);
      onNotice("good", saved.id === batch.id ? t("batches.saved") : t("batches.savedSplit"));
    } catch (err) {
      onNotice("bad", apiErrorMessage(err));
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFromBff(`/api/seller/stock-batches/${batch.id}/export.txt`, { fallbackName: `stock_batch_${batch.id}.txt`, locale });
    } catch (err) {
      onNotice("bad", apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="min-w-0 max-w-full break-all font-mono text-[13px] font-semibold text-iris-hi">{batch.format}</code>
            <span className="text-[11.5px] text-faint">{t("format.columns", { count: batch.field_count })}</span>
            {batch.mismatched > 0 && <Tag tone="warn">{t("batches.mismatched", { count: batch.mismatched })}</Tag>}
            {batch.source !== "upload" && <Tag tone="neutral">{t(`batches.source.${batch.source === "assign" ? "assign" : "split"}`)}</Tag>}
          </div>
          <p className={cn("text-[12px]", batch.login_note ? "text-fg" : "text-faint")}>
            {batch.login_note ? <><span className="text-muted">{t("format.noteLabel")}:</span> {batch.login_note}</> : t("batches.noNote")}
          </p>
          <p className="text-[11.5px] text-faint">
            {t("batches.created", { date: formatDateTime(batch.created_at, locale) })}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex items-center gap-3 font-mono text-[12.5px] tabular">
            <span className={cn(batch.available > 0 ? "text-good" : "text-muted")}>{t("batches.inStock", { count: batch.available })}</span>
            <span className="text-muted">{t("batches.sold", { count: batch.sold })}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:justify-end">
            <Button size="sm" variant="secondary" onClick={() => onAddMore(batch.id)} className="h-8 gap-1 text-xs"><Plus size={13} /> {t("batches.addMore")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing} className="h-8 gap-1 text-xs"><Edit2 size={13} /> {t("batches.edit")}</Button>
            <Button size="sm" variant="ghost" onClick={() => void download()} loading={downloading} disabled={batch.available === 0} className="h-8 gap-1 text-xs"><Download size={13} /> {t("batches.download")}</Button>
          </div>
        </div>
      </div>
      {editing && (
        <FormatEditor
          initialFormat={batch.format}
          initialNote={batch.login_note ?? ""}
          hint={batch.sold > 0 ? t("batches.splitHint", { sold: batch.sold }) : undefined}
          busy={update.isPending}
          submitLabel={t("batches.save")}
          onSubmit={(format, note) => void save(format, note)}
          onCancel={() => setEditing(false)}
        />
      )}
    </li>
  );
}

function UnformattedGroup({ variantId, fieldCount, count, onNotice }: { variantId: number; fieldCount: number; count: number; onNotice: Notify }) {
  const t = useTranslations("sellerInventory");
  const apiErrorMessage = useApiErrorMessage();
  const assign = useAssignStockFormat(variantId);
  const [open, setOpen] = useState(false);
  const submit = async (format: string, note: string) => {
    try {
      const result = await assign.mutateAsync({ format, login_note: cleanLoginNote(note), field_count: fieldCount });
      setOpen(false);
      onNotice("good", t("batches.assignDone", { count: result.count }));
    } catch (err) {
      onNotice("bad", apiErrorMessage(err));
    }
  };
  return (
    <li className="space-y-2 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] text-fg">{t("batches.fieldGroup", { fields: fieldCount, count })}</span>
        {!open && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className="ml-auto h-8 text-xs">{t("batches.assign")}</Button>
        )}
      </div>
      {open && (
        <FormatEditor
          initialFormat=""
          initialNote=""
          expectedFields={fieldCount}
          hint={t("batches.assignHint", { count })}
          busy={assign.isPending}
          submitLabel={t("batches.assignSubmit", { count })}
          onSubmit={(format, note) => void submit(format, note)}
          onCancel={() => setOpen(false)}
        />
      )}
    </li>
  );
}

/** A package's stock batches ("lô") with their format and notes, and the
 *  stock uploaded before batches, grouped by field count so a seller gives a
 *  whole group its format at once. */
export function StockBatchPanel({
  variantId, data, loading, onAddMore, onNotice,
}: {
  variantId: number;
  data: StockBatchList | undefined;
  loading: boolean;
  onAddMore: (batchId: number) => void;
  onNotice: Notify;
}) {
  const t = useTranslations("sellerInventory");
  if (loading && !data) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }
  if (!data || (data.batches.length === 0 && data.unformatted.in_stock === 0)) return null;
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold text-fg">{t("batches.title")}</h2>
          <p className="text-[12px] text-muted">{t("batches.subtitle")}</p>
        </div>
        <span className="text-[12px] text-faint">{t("batches.count", { count: data.batches.length })}</span>
      </div>
      {data.batches.length > 0 && (
        <ul className="divide-y divide-line">
          {data.batches.map((batch) => <BatchRow key={batch.id} batch={batch} onAddMore={onAddMore} onNotice={onNotice} />)}
        </ul>
      )}
      {data.unformatted.in_stock > 0 && (
        <div className="border-t border-dashed border-line-2 bg-raised/40">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <Tag tone="neutral" className="font-semibold uppercase tracking-wide">{t("batches.unformattedTitle")}</Tag>
            <span className="text-[12px] text-muted">{t("batches.unformattedHint", { count: data.unformatted.in_stock })}</span>
          </div>
          <ul className="divide-y divide-line">
            {data.unformatted.by_field_count.map((group) => (
              <UnformattedGroup key={group.field_count} variantId={variantId} fieldCount={group.field_count} count={group.count} onNotice={onNotice} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
