/** State machine mua hàng cho flow variant cố định: gói đang chọn, số lượng,
 *  modal xác nhận, đặt đơn và lỗi của nó. Mọi quyết định (gói mặc định, trần
 *  số lượng, trạng thái nút) uỷ quyền cho purchase.ts — hook này chỉ giữ state.
 *
 *  Gói đang chọn là DERIVED: `chosen` chỉ ghi lại lựa chọn tay của buyer,
 *  chưa chọn thì rơi về pickDefaultVariant(product) — không cần effect đồng
 *  bộ khi product tải xong, không có frame nào panel trống. */

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Order, ProductDetail, Variant } from "@/lib/types";
import { clampQty, pickDefaultVariant } from "./purchase";

export interface PurchaseState {
  selected: Variant | null;
  qty: number;
  total: number;
  order: Order | null;
  placing: boolean;
  placeError: string | null;
  showConfirm: boolean;
  pickVariant: (v: Variant) => void;
  setQty: (n: number) => void;
  openConfirm: () => void;
  closeConfirm: () => void;
  buy: () => Promise<void>;
  /** "Mua thêm"/"Thử đặt lại" sau khi có kết quả đơn: về lại form, giữ gói đã chọn. */
  rebuy: () => void;
  /** Đơn tạo từ DynamicOrderForm cũng đổ vào cùng slot `order` — hai flow
   *  chung một chỗ hiển thị kết quả. */
  onOrderCreated: (order: Order) => void;
}

export function usePurchase(product: ProductDetail | null): PurchaseState {
  const [chosen, setChosen] = useState<Variant | null>(null);
  const [qty, setQtyRaw] = useState(1);
  const [order, setOrder] = useState<Order | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const selected = chosen ?? (product ? pickDefaultVariant(product.variants) : null);
  const total = selected ? selected.price * qty : 0;

  const pickVariant = (v: Variant) => {
    setChosen(v);
    setPlaceError(null);
    setQtyRaw((q) => clampQty(q, v));
  };

  const setQty = (n: number) => setQtyRaw(clampQty(n, selected));

  const buy = async () => {
    if (!selected) return;
    setPlacing(true); setPlaceError(null);
    try {
      setOrder(await api.createOrder(selected.id, qty));
      setShowConfirm(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setPlaceError("Số dư không đủ — vui lòng nạp tiền vào ví.");
      else setPlaceError(e instanceof Error ? e.message : "Đặt hàng thất bại");
    } finally {
      setPlacing(false);
    }
  };

  return {
    selected, qty, total, order, placing, placeError, showConfirm,
    pickVariant, setQty,
    openConfirm: () => setShowConfirm(true),
    closeConfirm: () => { setShowConfirm(false); setPlaceError(null); },
    buy,
    rebuy: () => { setOrder(null); setQtyRaw(1); },
    onOrderCreated: setOrder,
  };
}
