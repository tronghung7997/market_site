"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useVariantTerm } from "@/lib/variant-term";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Order } from "@/lib/types";
import { Button, Input, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Package, Upload } from "@/components/Icons";
import { splitDeliveryLines } from "../model";
import { useDeliverOrder } from "../useSellerOrders";

/** Manual fulfilment: paste/upload one line per unit, then deliver. */
export function SellerDeliverDialog({
  order,
  onClose,
  onDelivered,
}: {
  order: Order | null;
  onClose: () => void;
  onDelivered?: (order: Order) => void;
}) {
  return (
    <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {order && <DeliverForm key={order.id} order={order} onClose={onClose} onDelivered={onDelivered} />}
    </Dialog>
  );
}

function DeliverForm({ order, onClose, onDelivered }: { order: Order; onClose: () => void; onDelivered?: (order: Order) => void }) {
  const t = useTranslations("seller");
  const term = useVariantTerm(order.service_type);
  const apiErrorMessage = useApiErrorMessage();
  const deliver = useDeliverOrder();
  const [data, setData] = useState("");
  const [error, setError] = useState<string | null>(null);

  const lines = splitDeliveryLines(data);
  const lineCount = lines.length;
  const duplicateCount = lineCount - new Set(lines).size;
  const isMatch = lineCount === order.quantity;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setData((evt.target?.result as string) || "");
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data.trim()) {
      setError(t("deliveryRequired"));
      return;
    }
    setError(null);
    try {
      const updated = await deliver.mutateAsync({ orderId: order.id, data: data.trim() });
      onDelivered?.(updated);
      onClose();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("deliveryFailed")));
    }
  };

  return (
    <DialogContent className="w-[calc(100vw-1.5rem)] max-w-xl gap-0 rounded-2xl border-line bg-surface p-0 shadow-card-lg sm:w-full">
      <div className="flex items-center gap-2.5 border-b border-line bg-raised/50 p-4 pr-12">
        <span className="rounded-lg bg-iris-soft p-1.5 text-iris"><Package size={18} /></span>
        <div className="min-w-0">
          <span className="rounded bg-iris-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-iris">
            {t("deliverModalTitle")}
          </span>
          <DialogTitle className="mt-0.5 truncate text-[14px] font-bold text-fg">
            {t("orderNumber", { id: order.order_code })} &bull; {order.product_title}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("deliveryCustomerHint")}</DialogDescription>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-h-[75vh] space-y-3.5 overflow-y-auto p-5 text-xs">
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-line bg-raised p-3 text-muted sm:flex-row sm:items-center">
          <div>
            <span>{t("variantLabel", { ...term })} </span>
            <strong className="text-fg">{order.variant_name || t("defaultVariant")}</strong>
          </div>
          <div className="flex items-center gap-2">
            <span>{t("deliveryRequirement")}</span>
            <span className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-sm font-bold text-iris-hi">
              {order.quantity.toLocaleString()} item
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface p-2.5">
          <span className="text-[11.5px] text-muted">{t("bulkUpload")}</span>
          <label className="cursor-pointer">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:bg-raised/80">
              <Upload size={12} className="text-iris" />
              <span>{t("uploadTxtCsv")}</span>
            </span>
            <Input type="file" accept=".txt,.csv" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="seller-deliver-data" className="font-semibold text-fg">{t("deliveryPayloadLabel")}</label>
            <span className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold",
              lineCount === 0
                ? "bg-raised text-faint"
                : isMatch
                  ? "border border-good/30 bg-good-soft/70 text-good"
                  : "border border-warn/30 bg-warn-soft/70 text-warn",
            )}>
              {lineCount === 0
                ? t("noDataEntered")
                : isMatch
                  ? t("deliveryExactLines", { count: lineCount.toLocaleString(), required: order.quantity.toLocaleString() })
                  : lineCount < order.quantity
                    ? t("deliveryMissingLines", { count: lineCount.toLocaleString(), required: order.quantity.toLocaleString(), missing: (order.quantity - lineCount).toLocaleString() })
                    : t("deliveryExtraLines", { count: lineCount.toLocaleString(), required: order.quantity.toLocaleString(), extra: (lineCount - order.quantity).toLocaleString() })}
            </span>
          </div>
          <Textarea
            id="seller-deliver-data"
            rows={6}
            value={data}
            onChange={(e) => setData(e.target.value)}
            placeholder={t("deliveryBulkPlaceholder")}
            className="bg-surface font-mono text-xs leading-relaxed"
            autoFocus
          />
          {duplicateCount > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-warn/30 bg-warn-soft/40 p-2 text-[11px] text-warn">
              <span>{t("duplicateLines", { count: duplicateCount.toLocaleString() })}</span>
              <Button size="sm" variant="ghost" type="button" onClick={() => setData(Array.from(new Set(lines)).join("\n"))} className="h-6 text-[10.5px] text-warn hover:underline">
                {t("removeDuplicates")}
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted">{t("deliveryCustomerHint")}</p>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <Button size="sm" variant="ghost" type="button" onClick={onClose} disabled={deliver.isPending}>
            {t("cancel")}
          </Button>
          <Button size="sm" type="submit" disabled={deliver.isPending || !data.trim()} className="gap-1.5">
            <Package size={13} />
            <span>{deliver.isPending ? t("deliverySubmitting") : t("deliveryConfirmCount", { count: lineCount.toLocaleString() })}</span>
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
