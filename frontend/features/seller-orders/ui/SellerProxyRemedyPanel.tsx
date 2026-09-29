"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api, newIdempotencyKey } from "@/lib/api";
import { cn } from "@/lib/cn";
import { lineLabel } from "@/lib/order-ref";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { pendingProxyLineNos, proxyRefundTotal, summarizeDisputeCase } from "@/lib/dispute-case";
import type { Dispute, SellerDisputeProxyLine } from "@/lib/types";
import { Banner, Button, Skeleton, Tag, Textarea } from "@/components/ui";
import { AlertTriangle } from "@/components/Icons";

/** Per-proxy remedy of a proxy-order case: the seller refunds the lines the
 *  buyer reported (Σ of their refund caps); each refunded proxy is revoked. */
export function SellerProxyRemedyPanel({
  dispute,
  formatRefund,
  onChanged,
}: {
  dispute: Dispute;
  formatRefund: (amount: number) => string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();
  const query = useQuery({
    queryKey: ["seller-orders", "dispute-proxies", dispute.id, dispute.proxy_actions?.length ?? 0],
    queryFn: () => api.sellerDisputeProxies(dispute.id),
  });
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const pending = useMemo(() => pendingProxyLineNos(items), [items]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A retry of the same batch reuses its key, so a lost response cannot refund twice.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const selectedLines = pending.filter((line) => selected.has(line));
  const total = proxyRefundTotal(items, selectedLines);
  const summary = summarizeDisputeCase(dispute);

  const toggle = (line: number) => {
    setConfirming(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(line)) next.delete(line); else next.add(line);
      return next;
    });
  };

  const submit = async () => {
    if (selectedLines.length === 0) return;
    const signature = selectedLines.join(",");
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newIdempotencyKey() };
    setSubmitting(true);
    setError(null);
    try {
      await api.sellerRefundDisputeProxies(dispute.id, selectedLines, attempt.current.key, note.trim() || undefined);
      attempt.current = null;
      setSelected(new Set());
      setNote("");
      setConfirming(false);
      await query.refetch();
      await onChanged();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("refundProxiesFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-lg border border-warn/25 bg-warn-soft/30 px-3 py-2">
        <p className="font-semibold text-fg">{t("proxyRemedyTitle", { count: pending.length })}</p>
        <p className="mt-0.5 text-[11.5px] text-muted">{t("proxyRemedyHint")}</p>
        {summary.refunded > 0 && (
          <p className="mt-1 text-[11.5px] text-muted">
            {t("handledProxiesSummary", { count: summary.refunded, amount: formatRefund(summary.refundedAmount) })}
          </p>
        )}
      </div>

      {pending.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setConfirming(false); setSelected(new Set(pending)); }} disabled={submitting}>
            {t("proxySelectPending", { count: pending.length })}
          </Button>
          {selectedLines.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => { setConfirming(false); setSelected(new Set()); }} disabled={submitting}>
              {t("clearSelection")}
            </Button>
          )}
        </div>
      )}

      <div role="group" aria-label={t("proxyLinesAria")} className="max-h-72 overflow-y-auto rounded-xl border border-line divide-y divide-line/50">
        {query.isPending ? (
          <div className="space-y-2 p-3" aria-busy="true">
            {[0, 1, 2].map((row) => <Skeleton key={row} className="h-6 w-full" />)}
          </div>
        ) : query.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-4 text-bad" role="alert">
            <span>{apiErrorMessage(query.error, t("proxyLoadFailed"))}</span>
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("retry")}</Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted">{t("proxyRemedyEmpty")}</p>
        ) : items.map((item) => (
          <ProxyRow
            key={item.line_no}
            item={item}
            selectable={pending.includes(item.line_no)}
            checked={selected.has(item.line_no)}
            disabled={submitting}
            onToggle={() => toggle(item.line_no)}
            formatRefund={formatRefund}
          />
        ))}
      </div>

      {pending.length > 0 && (
        <div className="space-y-3 rounded-xl border border-line bg-raised/50 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
            <span className="text-muted">{t("selected")}: <span className="font-mono font-bold text-fg">{selectedLines.length}</span></span>
            {selectedLines.length > 0 && (
              <span className="text-muted">{t("refundEstimate")}: <span className="font-mono font-bold tabular text-warn">{formatRefund(total)}</span></span>
            )}
          </div>
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("resourceActionNote")}
            aria-label={t("resourceActionNote")}
            className="text-xs"
            disabled={submitting}
          />
          {error && <Banner tone="bad">{error}</Banner>}
          {confirming ? (
            <div className="rounded-lg border border-bad/30 bg-bad-soft/40 p-3">
              <p className="flex items-start gap-1.5 text-[12px] font-semibold text-fg">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-bad" />
                {t("confirmRefundProxies", { count: selectedLines.length, amount: formatRefund(total) })}
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="danger" loading={submitting} onClick={() => void submit()}>
                  {t("refundProxies", { count: selectedLines.length })}
                </Button>
                <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setConfirming(false)}>{t("cancel")}</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" disabled={selectedLines.length === 0} onClick={() => setConfirming(true)}>
              {t("refundProxies", { count: selectedLines.length })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ProxyRow({
  item, selectable, checked, disabled, onToggle, formatRefund,
}: {
  item: SellerDisputeProxyLine;
  selectable: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  formatRefund: (amount: number) => string;
}) {
  const t = useTranslations("seller");
  const statusKey = `proxyStatus.${item.status}`;
  return (
    <label
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 text-[11.5px]",
        selectable ? "cursor-pointer hover:bg-raised/60" : "cursor-default",
        checked && "bg-iris-soft/20",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={!selectable || disabled}
        onChange={onToggle}
        aria-label={t("selectProxyLine", { line: lineLabel(item.line_no) })}
        className="h-3.5 w-3.5 shrink-0 accent-iris"
      />
      <span className="shrink-0 rounded bg-iris-soft px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-iris">{lineLabel(item.line_no)}</span>
      <span className={cn("min-w-0 flex-1 truncate font-mono", selectable ? "text-fg" : "text-muted")}>
        {item.host ? `${item.host}:${item.port}` : "—"}
      </span>
      <span className="hidden shrink-0 text-[10.5px] text-faint sm:inline">{t.has(statusKey) ? t(statusKey) : item.status}</span>
      {item.refund_amount_cap != null && (
        <span className="shrink-0 font-mono text-[10.5px] tabular text-muted">{formatRefund(item.refund_amount_cap)}</span>
      )}
      {item.remedied ? (
        <Tag tone="good">{t("resourceRefunded")}</Tag>
      ) : item.claimed ? (
        <Tag tone="warn">{t("claimPending")}</Tag>
      ) : (
        <span className="shrink-0 text-[10.5px] text-faint">{t("proxyNotClaimed")}</span>
      )}
    </label>
  );
}
