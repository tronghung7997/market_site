"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import type { Resource } from "@/lib/types";
import { Button, CopyButton, Tag, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, EyeOff, RotateCcw } from "@/components/Icons";
import { canArchiveInventoryResource, canEditInventoryResource, canRestockInventoryResource, isDefectiveReturnResource } from "../logic";
import { useResourceMutations } from "../useInventory";

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
  variantId,
  onClose,
  onNotice,
}: {
  resource: Resource | null;
  variantId: number;
  onClose: () => void;
  onNotice: (tone: "good" | "bad", text: string) => void;
}) {
  return (
    <Dialog open={Boolean(resource)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {resource && <ResourceDetailBody key={resource.id} resource={resource} variantId={variantId} onClose={onClose} onNotice={onNotice} />}
    </Dialog>
  );
}

function ResourceDetailBody({ resource, variantId, onClose, onNotice }: { resource: Resource; variantId: number; onClose: () => void; onNotice: (tone: "good" | "bad", text: string) => void }) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const { update, restockOne, archive, restore } = useResourceMutations(variantId);
  const [data, setData] = useState(resource.data);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setData(resource.data); }, [resource.data]);

  const status = resourceStatusTone(resource);
  const editable = canEditInventoryResource(resource.status, resource.order_id) && !resource.is_archived;
  const restockable = canRestockInventoryResource(resource.status, resource.order_id) && !resource.is_archived;
  const archivable = canArchiveInventoryResource(resource.status) && !resource.is_archived;
  const busy = update.isPending || restockOne.isPending || archive.isPending || restore.isPending;

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
        {status.key === "returned" && (
          <div className="rounded-xl border border-warn/30 bg-warn-soft/80 p-3 text-warn-hi">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><AlertCircle size={14} /> {t("resource.returnedTitle", { id: resource.order_id ?? 0 })}</p>
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
            <CopyButton text={data} />
          </div>
          {editable ? (
            <Textarea id="resource-detail-content" rows={5} value={data} onChange={(e) => setData(e.target.value)} className="bg-surface font-mono text-xs leading-relaxed" />
          ) : (
            <div className="max-h-40 overflow-y-auto break-all rounded-xl border border-line bg-raised/50 p-3 font-mono text-xs select-all">{resource.data}</div>
          )}
        </div>
        {error && <p role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-raised/50 p-3">
        <div className="flex items-center gap-1.5">
          {resource.is_archived ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => restore.mutateAsync(resource.id), "resource.restored", "resource.restoreFailed")} className="h-8 gap-1 text-xs text-iris">
              <RotateCcw size={13} /> {t("resource.restore")}
            </Button>
          ) : archivable && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => archive.mutateAsync(resource.id), "resource.archived", "resource.archiveFailed")} className="h-8 gap-1 text-xs text-muted hover:text-bad">
              <EyeOff size={13} /> {t("resource.archive")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>{t("resource.close")}</Button>
          {restockable && (
            <Button size="sm" disabled={busy || !data.trim()} onClick={() => void run(() => restockOne.mutateAsync({ id: resource.id, data: data.trim() }), "resource.restockedOne", "resource.saveFailed")} className={cn("gap-1 bg-good text-white hover:bg-good/90")}>
              <RotateCcw size={13} /> {t("resource.restockOne")}
            </Button>
          )}
          {editable && (
            <Button size="sm" disabled={busy || !data.trim() || data.trim() === resource.data} onClick={() => void run(() => update.mutateAsync({ id: resource.id, data: data.trim() }), "resource.saved", "resource.saveFailed")}>
              {t("resource.save")}
            </Button>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
