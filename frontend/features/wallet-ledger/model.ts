/** The wallet ledger (/transactions) as a buyer or seller reads it: which side
 *  of a deal each row belongs to, what state its money is in, and the list view
 *  (group, kind, direction, period, search) kept in the URL. Filtering, totals
 *  and paging run on the server (GET /wallet/ledger, `src/wallet/ledger_view.py`,
 *  same groups and states). Pure, so node:test can load it. */

import type { Transaction } from "@/lib/types";
// Relative import keeps this module loadable by node:test (no path alias).
import { TX_KINDS, txKind, type TxKind } from "../../lib/tx-kind.ts";
import { foldText } from "../../lib/text-fold.ts";

/** Who the row is about: buying, selling, money in/out of the wallet, or the rest. */
export const TX_GROUPS = ["buy", "sell", "funds", "other"] as const;
export type TxGroup = (typeof TX_GROUPS)[number];

const GROUP_OF_KIND: Record<TxKind, TxGroup> = {
  purchase: "buy", refund: "buy",
  sale: "sell",
  topup: "funds", withdraw: "funds",
  affiliate: "other", adjustment: "other",
};

export function txGroup(type: string): TxGroup {
  return GROUP_OF_KIND[txKind(type)];
}

export function kindsOfGroup(group: TxGroup | "all"): readonly TxKind[] {
  return group === "all" ? TX_KINDS : TX_KINDS.filter((kind) => GROUP_OF_KIND[kind] === group);
}

/** How money moved for deposits and withdrawals. Generic on purpose: the UI
 *  never names the processor behind a rail. Other rows have no channel. */
export type TxChannel = "bank" | "usdt";
export const TX_CHANNELS: readonly TxChannel[] = ["bank", "usdt"];

export function txChannel(tx: Pick<Transaction, "type" | "description" | "reference_id">): TxChannel | null {
  const kind = txKind(tx.type);
  if (kind === "withdraw") return "bank";
  if (tx.type !== "deposit") return null;
  const text = `${tx.description ?? ""} ${tx.reference_id ?? ""}`.toLowerCase();
  if (text.includes("usdt") || text.includes("nowpayments")) return "usdt";
  return "bank";
}

/** i18n key under `transactions.label` naming the row. */
export function txLabelKey(tx: Pick<Transaction, "type" | "description" | "reference_id">): string {
  if (tx.type === "deposit") return txChannel(tx) === "usdt" ? "deposit_usdt" : "deposit_bank";
  return LABELLED.has(tx.type) ? tx.type : "unknown";
}

const LABELLED = new Set([
  "topup", "purchase_hold", "refund", "purchase_release", "promo_subsidy", "platform_fee",
  "affiliate_commission", "affiliate_clawback", "withdraw_lock", "withdraw_unlock", "withdraw", "withdraw_fee",
  "adjustment_credit", "adjustment_debit",
]);

export type TxTone = "good" | "warn" | "bad" | "iris" | "neutral";

/** What happened to the row's money. `open` = it is not settled yet (shown
 *  under "Đang chờ"). Keys live under `transactions.state`. */
export interface TxState {
  key: string;
  tone: TxTone;
  open: boolean;
}

const PURCHASE_STATE: Record<string, TxState> = {
  pending: { key: "buy_processing", tone: "warn", open: true },
  processing: { key: "buy_processing", tone: "warn", open: true },
  delivered: { key: "buy_awaiting_confirm", tone: "warn", open: true },
  disputed: { key: "buy_disputed", tone: "bad", open: true },
  completed: { key: "buy_paid_to_shop", tone: "good", open: false },
  refunded: { key: "buy_refunded", tone: "neutral", open: false },
  cancelled: { key: "buy_refunded", tone: "neutral", open: false },
};

const WITHDRAW_STATE: Record<string, TxState> = {
  pending: { key: "withdraw_pending", tone: "warn", open: true },
  approved: { key: "withdraw_approved", tone: "iris", open: true },
  paid: { key: "withdraw_paid", tone: "good", open: false },
  rejected: { key: "withdraw_rejected", tone: "neutral", open: false },
};

export function txState(
  tx: Pick<Transaction, "type" | "direction" | "order_status" | "withdraw_status">,
): TxState {
  if (tx.type === "purchase_hold" && tx.order_status && PURCHASE_STATE[tx.order_status]) {
    return PURCHASE_STATE[tx.order_status];
  }
  if (tx.type === "withdraw_lock" && tx.withdraw_status && WITHDRAW_STATE[tx.withdraw_status]) {
    return WITHDRAW_STATE[tx.withdraw_status];
  }
  if (tx.direction === "in") return { key: "credited", tone: "good", open: false };
  if (tx.direction === "out") return { key: "debited", tone: "neutral", open: false };
  return { key: "settled", tone: "neutral", open: false };
}

// ---------------------------------------------------------------------------
// List view (URL state)
// ---------------------------------------------------------------------------

export const TX_PERIODS = ["all", "7d", "30d", "this_month", "last_month", "custom"] as const;
export type TxPeriod = (typeof TX_PERIODS)[number];
export type TxDirection = "all" | "in" | "out";

export interface TxView {
  group: TxGroup | "all";
  kind: TxKind | "all";
  dir: TxDirection;
  /** Only rows whose money is not settled yet (held for an order, withdrawal under review). */
  open: boolean;
  channel: TxChannel | "all";
  period: TxPeriod;
  /** Custom range, local `YYYY-MM-DD` days, both ends included. */
  from: string;
  to: string;
  q: string;
  page: number;
}

export const DEFAULT_TX_VIEW: TxView = {
  group: "all", kind: "all", dir: "all", open: false, channel: "all", period: "all", from: "", to: "", q: "", page: 1,
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** The view from the URL. Older links still work: `dir=pending` (now `open=1`)
 *  and `via=` (now `channel=`). */
export function parseTxView(search: URLSearchParams): TxView {
  const rawDir = search.get("dir");
  const kind = pick(search.get("kind"), TX_KINDS, "all");
  const group = pick(search.get("group"), TX_GROUPS, kind === "all" ? "all" : GROUP_OF_KIND[kind]);
  const period = pick(search.get("period"), TX_PERIODS, "all");
  let from = period === "custom" && ISO_DAY.test(search.get("from") ?? "") ? search.get("from")! : "";
  let to = period === "custom" && ISO_DAY.test(search.get("to") ?? "") ? search.get("to")! : "";
  if (from && to && from > to) [from, to] = [to, from];
  const page = Number(search.get("page"));
  return {
    group,
    // A kind outside the group cannot match anything; drop it.
    kind: kind !== "all" && group !== "all" && GROUP_OF_KIND[kind] !== group ? "all" : kind,
    dir: rawDir === "in" || rawDir === "out" ? rawDir : "all",
    open: search.get("open") === "1" || rawDir === "pending",
    channel: pick(search.get("channel") ?? search.get("via"), TX_CHANNELS, "all"),
    period,
    from,
    to,
    q: (search.get("q") ?? "").slice(0, 80),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function txViewToSearch(v: TxView): string {
  const q = new URLSearchParams();
  if (v.q.trim()) q.set("q", v.q.trim());
  if (v.group !== "all") q.set("group", v.group);
  if (v.kind !== "all") q.set("kind", v.kind);
  if (v.dir !== "all") q.set("dir", v.dir);
  if (v.open) q.set("open", "1");
  if (v.channel !== "all") q.set("channel", v.channel);
  if (v.period !== "all") q.set("period", v.period);
  if (v.period === "custom") {
    if (v.from) q.set("from", v.from);
    if (v.to) q.set("to", v.to);
  }
  if (v.page > 1) q.set("page", String(v.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Filters that narrow the list (the page number is not one). */
export function hasTxFilters(v: TxView): boolean {
  return v.group !== "all" || v.kind !== "all" || v.dir !== "all" || v.open || v.channel !== "all"
    || v.period !== "all" || v.q.trim() !== "";
}

function localDay(iso: string, plusDays = 0): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d + plusDays);
}

/** `[start, end)` in local time for a period; open ends are undefined. */
export function periodBounds(v: Pick<TxView, "period" | "from" | "to">, now: Date): { start?: Date; end?: Date } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (v.period) {
    case "7d":
      return { start: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6) };
    case "30d":
      return { start: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29) };
    case "this_month":
      return { start: new Date(today.getFullYear(), today.getMonth(), 1) };
    case "last_month":
      return {
        start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        end: new Date(today.getFullYear(), today.getMonth(), 1),
      };
    case "custom":
      return {
        ...(v.from ? { start: localDay(v.from) } : {}),
        ...(v.to ? { end: localDay(v.to, 1) } : {}),
      };
    default:
      return {};
  }
}

/** Every query word starts a word of `text`, accent/case-insensitively, so
 *  "hoan tien" finds "Hoàn tiền" but not "chuyển khoản … tiền". A word with a
 *  digit (an order-code fragment like "znr6") may match anywhere. */
export function matchesWordStarts(text: string, query: string): boolean {
  const words = foldText(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return true;
  const folded = foldText(text);
  const textWords = folded.split(/[^a-z0-9]+/).filter(Boolean);
  return words.every((word) => (/\d/.test(word) && folded.includes(word)) || textWords.some((w) => w.startsWith(word)));
}
