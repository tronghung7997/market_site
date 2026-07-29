"use client";

/** Thế giới HẬU-MUA của trang sản phẩm: sau khi đơn được tạo, khối này thay
 *  form đặt hàng trong phiếu — poll đơn provider tới khi chốt, kể tiến trình
 *  3 bước, trả lời câu "tiền đâu" khi thất bại, và bàn giao dữ liệu khi xong.
 *  Interface: { order, onRebuy } — không biết gì về variant/qty/panel. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, vnd } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { orderStatus } from "@/lib/order-status";
import type { Order } from "@/lib/types";
import { Button, CopyButton, Tag } from "@/components/ui";
import { Check, Clock, X } from "@/components/Icons";

const ORDER_POLL_MS = 3000;
// Backend refunds and cancels an order it cannot provision within 15 minutes,
// so there is nothing left to watch for after that.
const ORDER_POLL_TIMEOUT_MS = 15 * 60 * 1000;

/** Orders provisioned through an external provider come back `pending` — the
 *  provider call runs after the request returns — so watch until it settles.
 *  Only those: a manual variant order is also `pending`, but it waits on the
 *  seller for up to their SLA in hours, so polling it would spin for nothing. */
function useOrderPolling(initial: Order, enabled: boolean) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState(initial);

  useEffect(() => setOrder(initial), [initial]);

  const settled = order.status !== "pending";
  useEffect(() => {
    if (settled || !enabled) return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > ORDER_POLL_TIMEOUT_MS) {
        clearInterval(timer);
        return;
      }
      try {
        const fresh = await api.getOrder(order.id);
        if (fresh.status !== "pending") {
          clearInterval(timer);
          // Đơn chốt hỏng = tiền vừa quay về ví — làm mới cache ví để số dư
          // trên TopNav khớp với dòng "Đã hoàn ... về ví" đang hiện ở đây.
          if (fresh.status === "cancelled" || fresh.status === "refunded") {
            queryClient.invalidateQueries({ queryKey: queryKeys.wallet() });
          }
        }
        setOrder(fresh);
      } catch {
        // A failed poll is not worth surfacing — the next tick retries, and the
        // sweeper settles the order server-side regardless.
      }
    }, ORDER_POLL_MS);
    return () => clearInterval(timer);
  }, [order.id, settled, enabled, queryClient]);

  return order;
}

/** Đồng hồ "đang xử lý · m:ss" — tín hiệu tác vụ còn sống, đếm từ lúc đặt đơn. */
function useElapsed(since: string, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Tiến trình provision 3 bước: tiền đã trừ (xong ngay khi đơn tồn tại) →
 *  gọi nhà cung cấp (đang chạy) → bàn giao dữ liệu (chờ). */
function ProvisionSteps({ elapsed }: { elapsed: string }) {
  return (
    <div role="status" aria-live="polite" className="relative pl-7">
      <div className="absolute left-[8px] top-2.5 bottom-2.5 w-px bg-line" />

      <div className="relative pb-3">
        <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
          <Check size={10} />
        </span>
        <p className="text-[12.5px] text-muted">Đã thanh toán từ ví</p>
      </div>

      <div className="relative pb-3">
        <span className="absolute -left-7 top-[1px] h-[17px] w-[17px] rounded-full border-2 border-warn/25 border-t-warn bg-surface animate-spin-ring" />
        <p className="text-[12.5px] font-medium text-fg">
          Đang lấy hàng từ nhà cung cấp
          <span className="ml-1.5 font-mono text-[11px] font-normal text-faint tabular-nums">{elapsed}</span>
        </p>
      </div>

      <div className="relative">
        <span className="absolute -left-7 top-[1px] h-[17px] w-[17px] rounded-full border border-line-2 bg-surface" />
        <p className="text-[12.5px] text-faint">Bàn giao thông tin sản phẩm</p>
      </div>
    </div>
  );
}

export default function OrderResult({ order: initial, onRebuy }: { order: Order; onRebuy: () => void }) {
  // product_id (rather than variant_id) means a provider adapter fulfils this one.
  const viaProvider = initial.product_id != null;
  const order = useOrderPolling(initial, viaProvider);

  const pending = order.status === "pending";
  const failed = order.status === "cancelled" || order.status === "refunded";
  const working = pending && viaProvider;
  const elapsed = useElapsed(order.created_at, working);
  const st = orderStatus(order.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* key theo status để icon chạy lại hiệu ứng khi đơn chuyển trạng thái */}
        <span key={order.status} className={`relative ${!pending ? "animate-seal" : ""}`}>
          {working && (
            <span
              aria-hidden
              className="absolute -inset-1 rounded-full border-2 border-warn/20 border-t-warn animate-spin-ring"
            />
          )}
          <span
            className={`grid place-items-center h-9 w-9 rounded-full border ${
              pending
                ? "bg-warn-soft text-warn border-warn/25"
                : failed
                ? "bg-bad-soft text-bad border-bad/25"
                : "bg-good-soft text-good border-good/25"
            }`}
          >
            {pending ? <Clock size={16} /> : failed ? <X size={16} /> : <Check size={16} />}
          </span>
        </span>
        <div>
          <div className="text-[13.5px] font-medium">Đơn #{order.id}</div>
          <Tag tone={st.tone}>{st.label}</Tag>
        </div>
      </div>

      {pending ? (
        viaProvider ? (
          <div className="space-y-3.5">
            <ProvisionSteps elapsed={elapsed} />

            {/* Chỗ dữ liệu bàn giao sẽ hiện ra — shimmer để hứa trước vị trí */}
            <div className="rounded-lg border border-line bg-raised/60 p-3">
              <p className="text-[11px] text-faint uppercase tracking-wider mb-2">Thông tin bàn giao</p>
              <div className="space-y-1.5" aria-hidden>
                <div className="h-3 w-3/4 rounded bg-line/70 animate-shimmer" />
                <div className="h-3 w-1/2 rounded bg-line/70 animate-shimmer" />
              </div>
            </div>

            <p className="text-[11.5px] text-faint">
              Trang tự cập nhật khi xong — bạn không cần tải lại. Nếu quá 15 phút không lấy được hàng,
              tiền sẽ tự hoàn về ví.
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Người bán sẽ giao trong thời hạn SLA.</p>
        )
      ) : failed ? (
        <div className="space-y-3.5">
          {viaProvider ? (
            /* Cùng bố cục timeline với trạng thái chờ — kể nốt câu chuyện:
               tiền đã trừ → lấy hàng thất bại → tiền đã về ví */
            <div className="relative pl-7">
              <div className="absolute left-[8px] top-2.5 bottom-2.5 w-px bg-line" />

              <div className="relative pb-3">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
                  <Check size={10} />
                </span>
                <p className="text-[12.5px] text-muted">Đã thanh toán từ ví</p>
              </div>

              <div className="relative pb-3">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-bad/30 bg-bad-soft text-bad">
                  <X size={10} />
                </span>
                <p className="text-[12.5px] font-medium text-fg">Nhà cung cấp không cấp được hàng</p>
                {order.cancel_reason && (
                  <p className="mt-0.5 text-[11.5px] text-faint">{order.cancel_reason}</p>
                )}
              </div>

              <div className="relative">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
                  <Check size={10} />
                </span>
                <p className="text-[12.5px] text-muted">Đã hoàn tiền về ví</p>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">
              Đơn đã {order.status === "refunded" ? "được hoàn tiền" : "bị huỷ"}.
            </p>
          )}

          {/* Điều người dùng lo nhất: tiền đâu — trả lời to, rõ, kèm số tiền */}
          <div className="flex items-start gap-2.5 rounded-lg border border-good/25 bg-good-soft p-3 animate-rise">
            <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full bg-good/15 text-good">
              <Check size={13} />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-good">
                Đã hoàn {vnd(order.total_amount)} về ví của bạn
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Tiền về thẳng số dư khả dụng — bạn có thể đặt lại ngay.
              </p>
            </div>
          </div>
        </div>
      ) : order.delivered_data ? (
        <div className="animate-rise">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-faint uppercase tracking-wider">Thông tin bàn giao</span>
            <CopyButton text={order.delivered_data} label="Copy" copiedLabel="Đã copy" />
          </div>
          <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-3 whitespace-pre-wrap break-all">{order.delivered_data}</pre>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">Người bán sẽ giao trong thời hạn SLA.</p>
      )}

      <div className="flex gap-2">
        {failed ? (
          /* Tiền đã về ví — hành động tự nhiên nhất là đặt lại; nút phụ để tự kiểm chứng tiền hoàn */
          <>
            <Button size="sm" block onClick={onRebuy} className="flex-1">Thử đặt lại</Button>
            <Link href="/wallet" className="flex-1"><Button variant="secondary" block size="sm">Kiểm tra ví</Button></Link>
          </>
        ) : (
          <>
            <Link href="/orders" className="flex-1"><Button variant="secondary" block size="sm">Xem đơn hàng</Button></Link>
            <Button variant="secondary" size="sm" onClick={onRebuy} className="flex-1">Mua thêm</Button>
          </>
        )}
      </div>
    </div>
  );
}
