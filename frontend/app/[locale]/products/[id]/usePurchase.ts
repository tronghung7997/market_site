/** State machine mua hàng cho flow variant cố định: gói đang chọn, số lượng,
 *  modal xác nhận, đặt đơn và lỗi của nó. Mọi quyết định (gói mặc định, trần
 *  số lượng, trạng thái nút) uỷ quyền cho purchase.ts — hook này chỉ giữ state.
 *
 *  Gói đang chọn là DERIVED: `chosen` chỉ ghi lại lựa chọn tay của buyer,
 *  chưa chọn thì rơi về pickDefaultVariant(product) — không cần effect đồng
 *  bộ khi product tải xong, không có frame nào panel trống. */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
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
  const t = useTranslations("products");
  const te = useTranslations("errors");
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<Variant | null>(null);
  const [qty, setQtyRaw] = useState(1);
  const [order, setOrder] = useState<Order | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const selected = chosen ?? (product ? pickDefaultVariant(product.variants) : null);
  const total = selected ? selected.price * qty : 0;

  /** Đơn vừa tồn tại (mua fixed lẫn DynamicOrderForm đều đi qua đây):
   *  tiền đã rời ví — báo các cache liên quan tự làm mới, số dư trên TopNav
   *  nhảy ngay tại chỗ, danh sách đơn/thống kê cũng tươi khi mở. */
  const orderPlaced = (o: Order) => {
    setOrder(o);
    queryClient.invalidateQueries({ queryKey: queryKeys.wallet() });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.orderStats() });
  };

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
      orderPlaced(await api.createOrder(selected.id, qty));
      setShowConfirm(false);
    } catch (e) {
      if (e instanceof ApiError && (e.errorCode === "INSUFFICIENT_CREDIT" || e.status === 402)) {
        setPlaceError(te.has("INSUFFICIENT_CREDIT") ? te("INSUFFICIENT_CREDIT") : t("insufficientBalance"));
      } else if (e instanceof ApiError && e.errorCode && te.has(e.errorCode)) {
        setPlaceError(te(e.errorCode));
      } else {
        setPlaceError(e instanceof Error ? e.message : t("placeFailed"));
      }
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
    onOrderCreated: orderPlaced,
  };
}
