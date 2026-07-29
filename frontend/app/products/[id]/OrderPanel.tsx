"use client";

/** Phiếu đặt hàng flow variant cố định — TOÀN BỘ luồng mua trong một cột:
 *  chọn gói → số lượng → tổng → CTA → modal xác nhận; có đơn rồi thì nhường
 *  chỗ cho OrderResult. Mọi quyết định (nút nào, disable khi nào, mode gì)
 *  lấy từ purchase.ts qua usePurchase — component này chỉ vẽ.
 *  PanelShell được export riêng để nhánh DynamicOrderForm tái dùng nắp tối. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { ProductDetail } from "@/lib/types";
import { Button, Card, Tag } from "@/components/ui";
import { Bolt, Clock, MessageCircle, Shield } from "@/components/Icons";
import { ctaState, outOfStock, panelMode } from "./purchase";
import type { PurchaseState } from "./usePurchase";
import OrderResult from "./OrderResult";

/** Vỏ phiếu: Card nắp ink-panel + dotgrid — điểm nhấn thị giác duy nhất của trang. */
export function PanelShell({ title, aside, children }: {
  title: string; aside?: ReactNode; children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden shadow-card-lg">
      <div className="flex items-center justify-between px-5 h-11 bg-ink-panel dotgrid-dark">
        <span className="text-[12.5px] font-semibold tracking-wide text-white/95">{title}</span>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export default function OrderPanel({ product, purchase }: {
  product: ProductDetail;
  purchase: PurchaseState;
}) {
  const router = useRouter();
  const { account } = useAuth();
  const { selected, qty, total, order, placing, placeError, showConfirm } = purchase;

  const instant = selected?.delivery_mode === "instant";
  const contact = panelMode(selected) === "contact";
  const cta = ctaState({ loggedIn: !!account, placing, selected });
  const showOosHint = !!account && !!selected && outOfStock(selected);

  const onCtaClick = () => {
    if (cta.intent === "login") router.push(`/login?next=/products/${product.id}`);
    else if (cta.intent === "confirm") purchase.openConfirm();
  };

  return (
    <>
      <PanelShell
        title="Đặt hàng"
        aside={selected && !order ? (
          <Tag tone={instant ? "good" : "warn"}>
            {instant ? <><Bolt size={10} /> Giao ngay</> : <><Clock size={10} /> Giao trong {selected.sla_hours}h</>}
          </Tag>
        ) : undefined}
      >
        {order ? <OrderResult order={order} onRebuy={purchase.rebuy} /> : (
          <div className="space-y-4">
            {/* Chọn gói — ngay trong phiếu, giá và tổng cùng một cột nhìn */}
            <fieldset>
              <legend className="text-[11px] font-semibold text-faint uppercase tracking-wider mb-2">
                Chọn gói · {product.variants.length}
              </legend>
              <div role="radiogroup" className="space-y-1.5 max-h-[304px] overflow-y-auto overscroll-contain pr-0.5">
                {product.variants.map((v) => {
                  const on = selected?.id === v.id;
                  const oos = outOfStock(v);
                  return (
                    <button
                      key={v.id}
                      role="radio"
                      aria-checked={on}
                      disabled={oos}
                      onClick={() => purchase.pickVariant(v)}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                        on
                          ? "border-iris ring-1 ring-iris bg-iris/4"
                          : "border-line bg-surface hover:border-line-2",
                        oos && "opacity-55",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-snug">{v.name}</span>
                        <span className="mt-1 flex items-center gap-2 text-[11px] leading-none">
                          {v.delivery_mode === "instant" ? (
                            oos
                              ? <span className="text-bad font-medium">Hết hàng</span>
                              : <span className="flex items-center gap-1 text-good"><Bolt size={10} /> Giao ngay · Kho {v.stock_count}</span>
                          ) : (
                            <span className="flex items-center gap-1 text-warn"><Clock size={10} /> Giao trong {v.sla_hours}h</span>
                          )}
                        </span>
                      </span>
                      <span className="font-mono text-[13px] font-semibold tabular shrink-0">
                        {v.price > 0 ? vnd(v.price) : "Liên hệ"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {contact ? (
              <>
                <p className="border-t border-line pt-3.5 text-[12.5px] text-muted leading-relaxed">
                  Gói theo yêu cầu — thoả thuận cấu hình và giá trực tiếp với người bán trước khi đặt.
                </p>
                <Link href={`/sellers/${product.seller_id}`} className="block">
                  <Button size="lg" block>
                    <MessageCircle size={14} /> Liên hệ người bán
                  </Button>
                </Link>
              </>
            ) : (
              <>
                {/* Số lượng */}
                <div className="flex items-center justify-between border-t border-line pt-3.5">
                  <span className="text-[12.5px] text-muted">Số lượng</span>
                  <div className="flex items-center border border-line rounded-lg overflow-hidden">
                    <button
                      aria-label="Giảm số lượng"
                      onClick={() => purchase.setQty(qty - 1)}
                      className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
                    >−</button>
                    <input
                      type="number" min={1} value={qty} aria-label="Số lượng"
                      onChange={(e) => purchase.setQty(Number(e.target.value) || 1)}
                      className="h-9 w-12 text-center font-mono text-[13px] font-medium border-x border-line bg-surface [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      aria-label="Tăng số lượng"
                      onClick={() => purchase.setQty(qty + 1)}
                      className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
                    >+</button>
                  </div>
                </div>

                {/* Tổng — vùng giá duy nhất của trang */}
                <div className="flex items-end justify-between border-t border-line pt-3.5">
                  <div>
                    <div className="text-[12.5px] text-muted">Tổng cộng</div>
                    {qty > 1 && selected && (
                      <div className="font-mono tabular text-[11px] text-faint mt-1">{qty} × {vnd(selected.price)}</div>
                    )}
                  </div>
                  <span className="font-mono text-[24px] leading-none font-bold tabular text-iris-hi">{vnd(total)}</span>
                </div>

                {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}

                <Button size="lg" block disabled={cta.disabled} onClick={onCtaClick}>
                  {cta.label}
                </Button>
                {showOosHint && (
                  <p className="text-[11.5px] text-faint text-center -mt-1.5">
                    Gói này tạm hết hàng — chọn gói khác hoặc liên hệ người bán.
                  </p>
                )}
              </>
            )}

            <p className="text-[11.5px] text-faint leading-relaxed text-center">
              <Shield size={11} className="inline -mt-0.5 mr-0.5 text-good" />
              Ký quỹ {product.escrow_days} ngày · Tiền chỉ chuyển khi bạn xác nhận
            </p>
          </div>
        )}
      </PanelShell>

      {/* Modal xác nhận — biên nhận trước khi trừ ví */}
      {showConfirm && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={purchase.closeConfirm}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            role="dialog" aria-modal="true" aria-label="Xác nhận đơn hàng"
            className="relative w-full max-w-[400px] mx-4 bg-surface border border-line rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-line">
              <span className="text-[14px] font-semibold">Xác nhận đơn hàng</span>
            </div>
            <div className="p-5 space-y-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted">Sản phẩm</span>
                <span className="font-medium text-right max-w-[220px] truncate">{product.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Gói</span>
                <span className="font-medium">{selected.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Số lượng</span>
                <span className="font-medium">{qty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Đơn giá</span>
                <span className="font-medium">{vnd(selected.price)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Giao hàng</span>
                <span className="font-medium">{instant ? "Giao ngay (tự động)" : `Thủ công (trong ${selected.sla_hours}h)`}</span>
              </div>
              <div className="border-t border-line pt-3 flex justify-between items-end">
                <span className="text-muted">Tổng cộng</span>
                <span className="font-mono text-[18px] font-bold tabular text-iris-hi">{vnd(total)}</span>
              </div>
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-good/5 border border-good/15 text-[12px] text-muted">
                <Shield size={13} className="text-good mt-0.5 shrink-0" />
                <span>Ký quỹ {product.escrow_days} ngày — tiền chỉ chuyển cho người bán khi bạn xác nhận hài lòng.</span>
              </div>
              {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-line">
              <Button variant="secondary" block onClick={purchase.closeConfirm} disabled={placing}>Huỷ</Button>
              <Button block disabled={placing} onClick={purchase.buy}>{placing ? "Đang xử lý…" : "Xác nhận mua"}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
