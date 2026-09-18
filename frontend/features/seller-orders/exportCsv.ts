import { api } from "@/lib/api";
import type { Order } from "@/lib/types";
import { csvCell, ordersFiltersToQuery, type SellerOrdersFilters } from "./model";

const EXPORT_PAGE = 100;
export const EXPORT_MAX_ROWS = 5000;

/** Every order matching the current filters (not just the visible page). */
export async function fetchAllFilteredOrders(filters: SellerOrdersFilters): Promise<Order[]> {
  const rows: Order[] = [];
  for (let page = 1; rows.length < EXPORT_MAX_ROWS; page++) {
    const res = await api.sellerOrders({ ...ordersFiltersToQuery(filters), page, per_page: EXPORT_PAGE });
    rows.push(...res.items);
    if (res.items.length < EXPORT_PAGE || rows.length >= res.total) break;
  }
  return rows.slice(0, EXPORT_MAX_ROWS);
}

export function ordersToCsv(orders: Order[], includeDeliveredData: boolean): string {
  const headers = [
    "Order_Code", "Created_At", "Product", "Variant", "Quantity", "Amount_VND", "Status",
    "Fulfillment", "Buyer_Email", "Dispute_Status",
    ...(includeDeliveredData ? ["Delivered_Data"] : []),
  ];
  const lines = orders.map((o) => [
    o.order_code ?? o.id, o.created_at, o.product_title, o.variant_name, o.quantity, o.total_amount, o.status,
    o.fulfillment?.kind ?? "", o.buyer_email, o.dispute_status ?? "",
    ...(includeDeliveredData ? [o.delivered_data] : []),
  ].map(csvCell).join(","));
  return [headers.join(","), ...lines].join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
