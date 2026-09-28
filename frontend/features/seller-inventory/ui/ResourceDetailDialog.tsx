"use client";

import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import { labelledFields } from "@/lib/stock-format";
import type { Resource, SellerResourceRow, StockBatchSummary } from "@/lib/types";
import { Button, CopyButton, Skeleton, Tag, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, AlertTriangle, EyeOff, RotateCcw, ShieldCheck } from "@/components/Icons";
import { canArchiveInventoryResource, canEditInventoryResource, canRestockInventoryResource, isDefectiveReturnResource } from "../logic";
import { useResourceMutations, useRevealedResource } from "../useInventory";

export function resourceStatusTone(r: Pick<Resource, "status" | "order_id" | "is_archived">): { tone: "good" | "neutral" | "warn" | "bad"; key: "available" | "assigned" | "returned" | "error" | "expired" | "archived" } {
  if (r.is_archived) return { tone: "neutral", key: "archived" };
  if (r.status === "available") return { tone: "good", key: "available" };
  if (r.status === "assigned") return { tone: "neutral", key: "assigned" };
  if (isDefectiveReturnResource(r.status, r.order_id)) return { tone: "warn", key: "returned" };
  if (r.status === "error") return { tone: "bad", key: "error" };
  return { tone: "warn", key: "expired" };
}

export function ResourceDetailDialog({
  resource,
  batch = null,
  variantId,
  onClose,
  onNotice,
}: {
  resource: SellerResourceRow | null;
  /** Batch of the row: its format heads the dialog and labels the fields. */
  batch?: Pick<StockBatchSummary, "format" | "field_count" | "login_note"> | null;
  variantId: number;
  onClose: () => void;
  onNotice: (tone: "good" | "bad", text: string) => void;
}) {
  return (
    <Dialog open={Boolean(resource)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {resource && <ResourceDetailBody key={resource.id} resource={resource} batch={batch} variantId={variantId} onClose={onClose} onNotice={onNotice} />}
    </Dialog>
  );
}

function ResourceDetailBody({ resource, batch, variantId, onClose, onNotice }: {
  resource: SellerResourceRow;
  batch: Pick<StockBatchSummary, "format" | "field_count" | "login_note"> | null;
  variantId: number;
  onClose: () => void;
  onNotice: (tone: "good" | "bad", text: string) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const { update, restockOne, archive, restore } = useResourceMutations(variantId);
  // Opening the row is the explicit "view" action: the full line is fetched
  // now (audited server-side) and never kept once the dialog closes.
  const reveal = useRevealedResource(resource.id);
  const original = reveal.data?.data ?? null;
  const [data, setData] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (original !== null) setData(original); }, [original]);

  const status = resourceStatusTone(resource);
  const editable = canEditInventoryResource(resource.status, resource.order_id) && !resource.is_archived;
  const restockable = canRestockInventoryResource(resource.status, resource.order_id) && !resource.is_archived;
  const archivable = canArchiveInventoryResource(resource.status) && !resource.is_archived;
  const busy = update.isPending || restockOne.isPending || archive.isPending || restore.isPending;
  // The line read under its batch's columns (live while editing).
  const fields = batch && original !== null ? labelledFields(data.trim(), batch.format) : null;

  const run = async (fn: () => Promise<unknown>, doneKey: string, failKey: string) => {
    setError(null);
    try {
      await fn();
      onNotice("good", t(doneKey));
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t(failKey)));
    }
  };

  return (
    <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg gap-0 rounded-2xl border-line bg-surface p-0 shadow-card-lg sm:w-full">
      <div className="flex items-center gap-2 border-b border-line bg-raised/50 px-4 py-3">
        <Tag tone={status.tone}>{t(`resource.status.${status.key}`)}</Tag>
        <DialogTitle className="text-[13.5px] font-bold text-fg">
          {t("resource.detailTitle")}
        </DialogTitle>
      </div>
      <DialogDescription className="sr-only">{t("resource.detailTitle")}</DialogDescription>

      <div className="space-y-4 p-4 text-xs">
        {batch ? (
          <section aria-label={t("format.tag")} className="space-y-1.5 rounded-xl border border-iris/30 bg-iris-soft/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="iris" className="font-semibold uppercase tracking-wide">{t("format.tag")}</Tag>
              <code className="min-w-0 break-all font-mono text-[13px] font-semibold text-iris-hi">{batch.format}</code>
              <span className="text-[11.5px] text-faint">· {t("format.columns", { count: batch.field_count })}</span>
              <CopyButton text={batch.format} label={t("resource.copyFormat")} className="ml-auto" />
            </div>
            <p className={cn("text-[12px]", batch.login_note ? "text-fg" : "text-faint")}>
              {batch.login_note ? <><span className="text-muted">{t("format.noteLabel")}:</span> {batch.login_note}</> : t("batches.noNote")}
            </p>
          </section>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-raised/50 p-3">
            <Tag tone="neutral" className="font-semibold uppercase tracking-wide">{t("batches.unformattedTitle")}</Tag>
            <span className="text-[11.5px] text-muted">{t("resource.noFormatHint")}</span>
          </div>
        )}
        {status.key === "returned" && (
          <div className="rounded-xl border border-warn/30 bg-warn-soft/80 p-3 text-warn-hi">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><AlertCircle size={14} /> {t("resource.returnedTitle", { id: resource.order_code ?? "…" })}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{t("resource.returnedHint")}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-raised/40 p-2.5 text-[11.5px]">
          <div><span className="text-faint">{t("resource.createdAt")}</span><div className="mt-0.5 font-mono font-medium text-fg">{formatDateTime(resource.created_at, locale)}</div></div>
          <div>
            <span className="text-faint">{t("resource.orderRef")}</span>
            <div className="mt-0.5">
              {resource.order_id ? <Link href={`/seller/orders/${resource.order_code ?? resource.order_id}`} className="font-mono font-bold text-iris hover:underline">{resource.order_code ?? t("resource.orderRef")}</Link> : <span className="text-muted">{t("resource.notDelivered")}</span>}
            </div>
          </div>
          {resource.assigned_at && <div><span className="text-faint">{t("resource.assignedAt")}</span><div className="mt-0.5 font-mono font-medium text-fg">{formatDateTime(resource.assigned_at, locale)}</div></div>}
          {resource.expires_at && <div><span className="text-faint">{t("resource.expiresAt")}</span><div className="mt-0.5 font-mono font-medium text-fg">{formatDateTime(resource.expires_at, locale)}</div></div>}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="resource-detail-content" className="font-semibold text-fg">{editable ? t("resource.editContent") : t("resource.content")}</label>
            {original !== null && <CopyButton text={data} />}
          </div>
          {reveal.isPending ? (
            <div aria-busy="true" className="space-y-2 rounded-xl border border-line bg-raised/50 p-3">
              <span role="status" className="sr-only">{t("resource.revealing")}</span>
              <Skeleton className="h-3.5 w-11/12" /><Skeleton className="h-3.5 w-4/5" /><Skeleton className="h-3.5 w-2/3" />
            </div>
          ) : reveal.isError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bad/20 bg-bad-soft p-3 text-xs font-medium text-bad">
              <span className="min-w-0">{apiErrorMessage(reveal.error, t("resource.revealFailed"))}</span>
              <Button size="sm" variant="secondary" onClick={() => void reveal.refetch()} className="h-7 text-[12px]">{t("retry")}</Button>
            </div>
          ) : editable ? (
            <Textarea id="resource-detail-content" rows={5} value={data} onChange={(e) => setData(e.target.value)} className="bg-surface font-mono text-xs leading-relaxed" />
          ) : (
            <div className="max-h-40 overflow-y-auto break-all rounded-xl border border-line bg-raised/50 p-3 font-mono text-xs select-all">{original}</div>
          )}
          {batch && original !== null && (fields ? (
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-line bg-surface p-3">
              {fields.map((field, index) => (
                <Fragment key={index}>
                  <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-iris-hi">{field.label}</dt>
                  <dd className="min-w-0 break-all font-mono text-[12px] text-fg">{field.value || "—"}</dd>
                </Fragment>
              ))}
            </dl>
          ) : (
            <p className="flex items-start gap-1.5 text-[11.5px] text-warn">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {t("resource.offFormat", { fields: data.trim().split("|").length, expected: batch.field_count })}
            </p>
          ))}
          <p className="flex items-center gap-1.5 text-[11px] text-faint"><ShieldCheck size={12} /> {t("resource.revealNote")}</p>
        </div>
        {error && <p role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-raised/50 p-3">
        <div className="flex items-center gap-1.5">
          {resource.is_archived ? (
            <Button size="sm" variant="ghost" loading={restore.isPending} disabled={busy} onClick={() => void run(() => restore.mutateAsync(resource.id), "resource.restored", "resource.restoreFailed")} className="h-8 gap-1 text-xs text-iris">
              {!restore.isPending && <RotateCcw size={13} />} {t("resource.restore")}
            </Button>
          ) : archivable && (
            <Button size="sm" variant="ghost" loading={archive.isPending} disabled={busy} onClick={() => void run(() => archive.mutateAsync(resource.id), "resource.archived", "resource.archiveFailed")} className="h-8 gap-1 text-xs text-muted hover:text-bad">
              {!archive.isPending && <EyeOff size={13} />} {t("resource.archive")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("resource.close")}</Button>
          {restockable && (
            <Button size="sm" loading={restockOne.isPending} disabled={busy || original === null || !data.trim()} onClick={() => void run(() => restockOne.mutateAsync({ id: resource.id, data: data.trim() }), "resource.restockedOne", "resource.saveFailed")} className={cn("gap-1 bg-good text-white hover:bg-good/90")}>
              {!restockOne.isPending && <RotateCcw size={13} />} {t("resource.restockOne")}
            </Button>
          )}
          {editable && (
            <Button size="sm" loading={update.isPending} disabled={busy || original === null || !data.trim() || data.trim() === original} onClick={() => void run(() => update.mutateAsync({ id: resource.id, data: data.trim() }), "resource.saved", "resource.saveFailed")}>
              {t("resource.save")}
            </Button>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
