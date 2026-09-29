import { api } from "./api";
import { copyFromBff, fetchBffText } from "./download";
import type { LineRow } from "./order-line-text";
import { orderProxyLines } from "./dispute-form";
import type { ProxyLine, Resource } from "./types";

/** Largest page `GET /orders/{ref}/resources` serves (backend ORDER_RESOURCES_PAGE_MAX). */
export const ORDER_LINES_PAGE = 200;

/**
 * Every delivered line of an order, fetched page by page. An order can hold
 * thousands of lines of up to 200 KB each, so only call this for an explicit
 * user action that needs all of them (copy all, pick lines to dispute).
 */
export async function fetchAllOrderLines(
  orderId: string | number,
  { after = null, signal }: { after?: number | null; signal?: AbortSignal } = {},
): Promise<Resource[]> {
  const rows: Resource[] = [];
  let cursor = after;
  for (;;) {
    signal?.throwIfAborted();
    const page = await api.orderResources(orderId, { after: cursor, limit: ORDER_LINES_PAGE });
    rows.push(...page.items);
    if (page.next_after == null || page.items.length === 0) return rows;
    cursor = page.next_after;
  }
}

/** Only the named lines of an order (e.g. the ones a dispute refers to), with their line numbers. */
export async function fetchOrderLinesByIds(orderId: string | number, ids: number[]): Promise<Resource[]> {
  const unique = [...new Set(ids)].filter((id) => id > 0);
  const rows: Resource[] = [];
  for (let start = 0; start < unique.length; start += ORDER_LINES_PAGE) {
    const page = await api.orderResources(orderId, { ids: unique.slice(start, start + ORDER_LINES_PAGE) });
    rows.push(...page.items);
  }
  return rows;
}

/** Page size of `GET /me/proxies` this reads with (the endpoint's largest). */
const PROXY_LINES_PAGE = 100;
const PROXY_LINES_MAX_PAGES = 5;

/**
 * Every proxy line of one order, `#NN` ascending. `/me/proxies?q=` also
 * matches titles/notes/tags, so the result is narrowed to the exact code.
 */
export async function fetchOrderProxyLines(orderCode: string): Promise<ProxyLine[]> {
  const items: ProxyLine[] = [];
  for (let page = 1; page <= PROXY_LINES_MAX_PAGES; page += 1) {
    const res = await api.myProxies.list({ q: orderCode, sort: "line", page, per_page: PROXY_LINES_PAGE });
    items.push(...res.items);
    if (res.items.length === 0 || page * PROXY_LINES_PAGE >= res.total) break;
  }
  return orderProxyLines(items, orderCode);
}

export { isClippedLine, lineDisplayText, userPassLines } from "./order-line-text";

/** Full text of one delivered line: from the row when the list carried it, else fetched. */
export async function fetchOrderLineText(orderRef: string | number, row: LineRow, { locale }: { locale?: string } = {}): Promise<string> {
  return row.data ?? fetchBffText(api.orderLineUrl(orderRef, row.id), { locale });
}

/** Copy one delivered line in full. A clipped line is fetched on click; the
 *  pending fetch is handed to the clipboard so the click's activation holds. */
export async function copyOrderLine(orderRef: string | number, row: LineRow, { locale }: { locale?: string } = {}): Promise<void> {
  if (row.data != null) {
    await navigator.clipboard.writeText(row.data);
    return;
  }
  await copyFromBff(api.orderLineUrl(orderRef, row.id), { locale });
}
