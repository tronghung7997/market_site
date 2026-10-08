"use client";

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { privateImageBase, privateImageSource } from "@/lib/media";
import { formatDateTime } from "@/lib/utils";
import { Button, Spinner } from "@/components/ui";
import { DepositStatusBadge, OrderStatusBadge, SlidePanel, WithdrawStatusBadge } from "@/components/admin";
import { ImageStrip } from "@/components/media/ImageStrip";
import { useLedgerGroup } from "../data";
import { ACTOR_LABEL, ROLE_LABEL, groupKind, hasAdminNote, typeLabel } from "../model";

const KIND_TITLE = { order: "Đơn hàng", deposit: "Lệnh nạp", withdraw: "Lệnh rút" } as const;

/** Mọi bút toán của một sự kiện (đơn / lệnh nạp / lệnh rút), cũ → mới. */
export function GroupPanel({
  groupKey, onClose, onFilterGroup, onFilterAccount,
}: {
  groupKey: string | null;
  onClose: () => void;
  onFilterGroup: (key: string) => void;
  onFilterAccount: (accountId: number) => void;
}) {
  const q = useLedgerGroup(groupKey);
  const data = q.data;
  const h = data?.header;
  const kind = groupKey ? groupKind(groupKey) : "order";
  const accounts = React.useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of data?.entries ?? []) if (e.account_role !== "platform") seen.set(e.account_id, e.account_email);
    return [...seen.entries()];
  }, [data]);

  return (
    <SlidePanel isOpen={groupKey !== null} onClose={onClose} title={KIND_TITLE[kind]} width="lg">
      {q.isLoading ? (
        <div className="flex justify-center py-10"><Spinner label="Đang tải bút toán" /></div>
      ) : q.isError || !data || !h ? (
        <div className="space-y-3 py-6 text-center">
          <p className="text-[13px] text-bad">Không tải được sự kiện này.</p>
          <Button variant="secondary" size="sm" onClick={() => q.refetch()}>Thử lại</Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="font-mono text-[18px] font-semibold text-fg">{h.label ?? groupKey}</div>
            <div className="mt-1 text-[12.5px] text-muted">
              {kind === "order" && <>{h.buyer_email} mua từ {h.seller_email}{h.status && <> · <OrderStatusBadge status={h.status} /></>}</>}
              {kind === "deposit" && <>{h.account_email} · {h.provider}{h.status && <> · <DepositStatusBadge status={h.status} /></>}</>}
              {kind === "withdraw" && <>{h.account_email} · {h.bank_name ?? "—"}{h.status && <> · <WithdrawStatusBadge status={h.status} /></>}</>}
            </div>
          </div>

          {kind === "order" && h.total_amount !== undefined && (
            <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
              <Fact label="Người mua trả" value={vnd(h.total_amount)} />
              <Fact label="Đã hoàn" value={vnd(h.refunded_amount ?? 0)} />
              <Fact
                label={h.escrow_open ? "Còn giữ" : "Còn trong escrow"}
                value={vnd(h.escrow_remaining ?? 0)}
                tone={!h.escrow_open && (h.escrow_remaining ?? 0) !== 0 ? "bad" : undefined}
              />
            </dl>
          )}
          {kind === "withdraw" && h.amount !== undefined && (
            <>
              <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
                <Fact label="Yêu cầu rút" value={vnd(h.amount)} />
                <Fact label="Phí rút" value={vnd(h.fee_amount ?? 0)} />
                <Fact label="Chuyển khoản" value={vnd(h.amount - (h.fee_amount ?? 0))} />
              </dl>
              {h.payout_reference && (
                <p className="text-[12.5px] text-muted">Mã chuyển khoản <span className="font-mono text-fg">{h.payout_reference}</span></p>
              )}
              {h.reject_reason && <p className="text-[12.5px] text-bad">Lý do từ chối: {h.reject_reason}</p>}
            </>
          )}

          <section aria-label="Chuỗi bút toán">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Chuỗi bút toán · {data.entries.length}</h3>
            {data.entries.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted">Sự kiện này chưa có bút toán nào.</p>
            ) : (
              <ol className="mt-2 divide-y divide-line">
                {data.entries.map((e) => (
                  <li key={e.id} className="flex gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-fg">
                        <span className="font-medium">{typeLabel(e.type, e.actor, groupKey)}</span>
                        <span className="text-muted"> · {e.account_role === "platform" ? ROLE_LABEL.platform : e.account_email}</span>
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted">
                        <span className="tabular-nums">{formatDateTime(e.created_at, "vi")}</span> · {ACTOR_LABEL[e.actor]} · <span className="font-mono">#{e.id}</span>
                      </div>
                      {hasAdminNote(e) && <div className="mt-1 text-[12px] text-fg">“{e.description}”</div>}
                      {e.proof_images.length > 0 && (
                        <ImageStrip
                          size="sm"
                          className="mt-1.5"
                          title="Ảnh chứng từ"
                          images={e.proof_images.map((image) => ({ ...privateImageSource(image, privateImageBase.adminTransactionProof(e.id)), id: image.id }))}
                        />
                      )}
                    </div>
                    <Amount direction={e.direction} amount={e.amount} />
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button variant="secondary" size="sm" onClick={() => { onFilterGroup(groupKey!); onClose(); }}>Lọc sổ theo sự kiện này</Button>
            {kind === "order" && h.order_id && (
              <Link href={`/admin/orders/${h.order_id}`} className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] text-iris-hi hover:underline">Mở đơn hàng</Link>
            )}
            {accounts.map(([id, email]) => (
              <button key={id} type="button" onClick={() => { onFilterAccount(id); onClose(); }} className="inline-flex h-8 max-w-[220px] items-center truncate rounded-lg px-3 text-[13px] text-iris-hi hover:underline">
                Sổ của {email}
              </button>
            ))}
          </div>
        </div>
      )}
    </SlidePanel>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={cn("mt-0.5 font-mono text-[14px] tabular-nums text-fg", tone === "bad" && "text-bad")}>{value}</dd>
    </div>
  );
}

export function Amount({ direction, amount, className }: { direction: string; amount: number; className?: string }) {
  return (
    <span className={cn(
      "shrink-0 text-right font-mono text-[13px] tabular-nums",
      direction === "in" ? "text-good" : direction === "out" ? "text-bad" : "text-muted",
      className,
    )}>
      {direction === "in" ? "+" : direction === "out" ? "−" : ""}{vnd(amount)}
      {/* Chuyển khoản rút tiền và phí rút trừ vào tiền đang khoá, không đụng số dư khả dụng. */}
      {direction === "neutral" && <span className="block font-sans text-[11px]">từ tiền khoá</span>}
    </span>
  );
}
