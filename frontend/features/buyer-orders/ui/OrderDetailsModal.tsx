"use client";

import React, { useDeferredValue, useEffect, useState, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import {
  Copy,
  Check,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Star,
  Layers,
  Activity,
  Bolt,
  ClipboardList,
  FileText,
  Maximize,
  Minimize,
  Eye,
  EyeOff,
  Info,
} from "@/components/Icons";
import {
  deliveryResourceMarks,
  disputeResourceIds,
  isDeliveryRowClaimable,
  resourceLabelMap,
  resourceWarrantyGeneration,
} from "@/lib/dispute-case";
import { lineLabel, resourceLineMap } from "@/lib/order-ref";
import { DeliveryAccountBadge } from "@/components/orders/DeliveryAccountBadge";
import { InspectionChecklist } from "@/components/orders/InspectionChecklist";
import { canOpenDispute, displayOrderStatus, hasOpenDispute } from "@/lib/order-status";
import { fulfillmentFromOrder } from "@/lib/fulfillment";
import { deliveredDataFileName, labelledFields, maskDeliveredLine, nameCarriesTerm, startsBatchBlock } from "../model";
import { useVariantTermFor } from "@/lib/variant-term";
import { formatDate, formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { api } from "@/lib/api";
import { copyFromBff, downloadFromBff } from "@/lib/download";
import { useOrderLines } from "@/lib/hooks/useOrderLines";
import { copyOrderLine, fetchOrderLineText, fetchOrderLinesByIds, userPassLines } from "@/lib/order-lines";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Dispute, Order, Resource } from "@/lib/types";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Button, CopyButton, Disclosure, Tag } from "@/components/ui";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import OrderProxyPanel from "./OrderProxyPanel";
import ServiceDashboard from "@/components/ServiceDashboard";
import { OrderDispute } from "@/components/orders/OrderCardPrimitives";
import { OrderTimeline } from "./OrderTimeline";
import OrderChatButton from "@/components/chat/OrderChatButton";
import ReviewForm from "./ReviewForm";

interface ParsedItem {
  id: number;
  raw: string;
  user?: string;
  pass?: string;
  resourceId?: number | null;
  resourceStatus?: string;
  isConfigOrInstruction?: boolean;
  /** The list carried only this line's head (`raw`); the full line is fetched on demand. */
  clipped?: boolean;
  /** Length of the full line in characters. */
  length?: number | null;
  /** Stock batch of the line: its format and login notes head its block. */
  batchId?: number | null;
}

type InspectorTab = "delivery" | "review" | "dispute";

/** Stock lines longer than this (cookies, tokens) show clipped until expanded. */
const LINE_CLIP = 240;
const PAGE_SIZE = { compact: 20, expanded: 50 } as const;
/** Per-viewer convenience: the inspector reopens at the size last chosen. */
const INSPECTOR_SIZE_KEY = "orders.inspector.expanded";

function readInspectorExpanded(): boolean {
  try {
    return window.localStorage.getItem(INSPECTOR_SIZE_KEY) === "1";
  } catch {
    return false;
  }
}
type DeliveryKind = "instant" | "manual" | "api" | "task" | "proxy";

/** The API's `fulfillment.kind`, or the same rule derived from the old fields. */
function deliveryKind(order: Order): DeliveryKind {
  const kind = order.fulfillment?.kind;
  if (kind) return kind;
  const info = fulfillmentFromOrder(order).kind;
  return info === "sla" ? "manual" : info;
}

const KIND_TAB_KEY: Record<DeliveryKind, "tabDeliveryDataEmpty" | "tabProxy" | "tabApiAccess" | "tabTaskProgress" | "tabHandover"> = {
  instant: "tabDeliveryDataEmpty",
  manual: "tabHandover",
  api: "tabApiAccess",
  task: "tabTaskProgress",
  proxy: "tabProxy",
};

/** Delivered text as one receipt: what manual, API and task orders hand over
 *  besides their dashboard. Copy/download only — no per-line claims here. */
function DeliveryReceipt({ text, fileName }: { text: string; fileName: string }) {
  const t = useTranslations("orders");
  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="rounded-xl border border-line bg-canvas">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[12px] font-semibold text-fg">{t("deliveredData")}</span>
        <div className="flex items-center gap-1">
          <CopyButton text={text} className="rounded-lg px-2 py-1 hover:bg-raised" />
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <Download size={11} /> {t("downloadTxt")}
          </button>
        </div>
      </div>
      <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[12px] text-fg">{text}</pre>
    </div>
  );
}

export default function OrderDetailsModal({
  order: o,
  onClose,
  onConfirm,
  confirming,
  disputeRevision,
  onOpenDispute,
  reviewDone,
  onReviewDone,
  onDelivered,
  onDisputeChanged,
  highlightResourceIds = [],
  highlightLines = [],
  lockDismiss = false,
  open = true,
  initialTab,
}: {
  order: Order;
  onClose: () => void;
  onConfirm: (orderId: number) => void;
  confirming: boolean;
  disputeRevision: number;
  onOpenDispute: (orderId: number, options?: { variantName?: string | null; initialReason?: string; initialEvidence?: Record<string, string>; resourceIds?: number[] }) => void;
  reviewDone?: boolean;
  onReviewDone: (orderId: number, ok: boolean, message: string) => void;
  onDelivered: (orderId: number, deliveredData: string) => void;
  onDisputeChanged: (order: Order, outcome: "withdrawn") => void;
  highlightResourceIds?: number[];
  /** 1-based stock lines to highlight (what notifications link to). */
  highlightLines?: number[];
  lockDismiss?: boolean;
  open?: boolean;
  /** Land on a specific tab (the orders list's "Đánh giá" link opens straight on review). */
  initialTab?: "review";
}) {
  const t = useTranslations("orders");
  const termFor = useVariantTermFor();
  const tc = useTranslations("common");
  const tcur = useTranslations("currency");
  const locale = useLocale();
  const { formatOrderHistoryMoney, formatBrowseMoney, currency, showFxHints } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const st = displayOrderStatus(o, locale);
  const money = formatOrderHistoryMoney(o.total_amount, o.display_fx_rate_snapshot, { locale });

  // Order lists carry no delivered text: an order that delivered a text (manual
  // hand-over, API key, proxy) reads it from its detail.
  const needsText = !o.delivered_data && o.has_delivery !== false && o.delivery_count == null;
  const detailQuery = useQuery({
    queryKey: queryKeys.orderDetail(o.id),
    queryFn: () => api.getOrder(o.order_code),
    enabled: needsText,
    staleTime: 30_000,
  });
  const deliveredText = o.delivered_data ?? detailQuery.data?.delivered_data ?? null;

  // Parsing delivered_data (multi-line accounts/proxies/gateway keys)
  const textLines = useMemo(() => {
    if (!deliveredText) return [];
    return deliveredText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }, [deliveredText]);

  const parsedItems: ParsedItem[] = useMemo(() => {
    return textLines.map((line, idx) => {
      // Check if line contains a resource ID pattern like: id:123, [123], #123, ID=123, res_123
      const idMatch =
        line.match(/(?:^|[\s|;,])(?:id|resource|res|item)[_:\s#=]+([a-zA-Z0-9_-]+)/i) ||
        line.match(/^\[#?([a-zA-Z0-9_-]+)\]/);
      const customId = idMatch && /^\d+$/.test(idMatch[1]) ? Number(idMatch[1]) : null;

      // Detect if line is instruction / gateway / service / endpoint config rather than raw stock item
      const isConfig =
        /^(gateway\s*key|gọi\s*qua|endpoint|api\s*key|token|base\s*url|link|url|hướng\s*dẫn|note|server|port|host|proxy\s*type):/i.test(
          line
        ) ||
        line.startsWith("http://") ||
        line.startsWith("https://") ||
        line.startsWith("gwk_") ||
        line.startsWith("ak_live_") ||
        line.startsWith("sk_");

      const parts = line.split(/[|:]/);
      return {
        id: idx + 1,
        raw: line,
        user: parts[0] || "",
        pass: parts[1] || "",
        resourceId: customId,
        isConfigOrInstruction: isConfig,
      };
    });
  }, [textLines]);

  // Stock lines arrive a page at a time (an order can hold thousands of large
  // lines); search, select and claims work on what is loaded.
  const orderLines = useOrderLines(o.id, { queryKey: queryKeys.orderLines(o.id, disputeRevision) });
  const resources = orderLines.rows;
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<number>>(new Set());
  const [caseRecord, setCaseRecord] = useState<Dispute | null>(null);
  // Lines the dispute names, for its chips and line numbers even when not loaded yet.
  const [caseLines, setCaseLines] = useState<Resource[]>([]);
  const [bulkBusy, setBulkBusy] = useState<"copy" | "download" | null>(null);
  const [bulkError, setBulkError] = useState("");
  const hasCase = Boolean(o.has_dispute || o.dispute_status);

  useEffect(() => {
    setSelectedResourceIds(new Set());
  }, [disputeRevision]);

  useEffect(() => {
    let active = true;
    if (!hasCase) {
      setCaseRecord(null);
      setCaseLines([]);
      return;
    }
    api.orderDispute(o.id)
      .catch(() => null)
      .then(async (dispute) => {
        if (!active) return;
        setCaseRecord(dispute);
        const ids = disputeResourceIds(dispute);
        const named = ids.length > 0 ? await fetchOrderLinesByIds(o.id, ids).catch(() => []) : [];
        if (active) setCaseLines(named);
      });
    return () => { active = false; };
  }, [hasCase, o.id, disputeRevision]);

  const accountMarks = useMemo(() => deliveryResourceMarks(caseRecord), [caseRecord]);
  const stockLineCount = orderLines.total;
  const items: ParsedItem[] = useMemo(() => {
    if (resources.length === 0) return parsedItems;
    return resources.map((resource, idx) => {
      // Long lines (cookie exports) arrive as their head; the first fields are in it.
      const raw = resource.data ?? resource.data_preview ?? "";
      const parts = raw.split(/[|:]/);
      return {
        id: resource.line_no ?? idx + 1,
        raw,
        user: parts[0] || "",
        pass: parts[1] || "",
        resourceId: resource.id,
        resourceStatus: resource.status,
        isConfigOrInstruction: false,
        clipped: resource.data == null,
        length: resource.data_length ?? raw.length,
        batchId: resource.batch_id ?? null,
      };
    });
  }, [parsedItems, resources]);

  // Highlights arrive as resource ids (in-app) or as line numbers (notification
  // links, which never carry row ids); both resolve to the same set here.
  const highlightIds = useMemo(() => {
    const ids = new Set(highlightResourceIds);
    for (const item of items) {
      if (item.resourceId != null && highlightLines.includes(item.id)) ids.add(item.resourceId);
    }
    return ids;
  }, [highlightResourceIds, highlightLines, items]);

  const isServiceDelivery = useMemo(() => {
    if (items.length === 0) return false;
    const configCount = items.filter((it) => it.isConfigOrInstruction).length;
    return configCount > 0 && configCount >= items.length / 2;
  }, [items]);

  const [activeTab, setActiveTab] = useState<InspectorTab>(
    initialTab ?? (highlightResourceIds.length > 0 || highlightLines.length > 0 ? "delivery" : o.has_dispute ? "dispute" : "delivery"),
  );
  // Legacy proxy orders have no dproxy state: the panel reports that and the
  // generic service dashboard takes its place.
  const [proxyPanelApplicable, setProxyPanelApplicable] = useState<boolean | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  // Typing stays responsive on 1000-line deliveries: the filter runs on the deferred value.
  const deferredItemSearch = useDeferredValue(itemSearch);
  const [itemPage, setItemPage] = useState(1);
  const [copyFormat, setCopyFormat] = useState<"raw" | "userpass">("raw");
  const [copiedKey, setCopiedKey] = useState<string | number | null>(null);
  const [askConfirm, setAskConfirm] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [openLines, setOpenLines] = useState<Set<number>>(new Set());
  // Full text of clipped lines the buyer opened, by line number.
  const [fullLines, setFullLines] = useState<Record<number, string>>({});
  // Account lines start hidden (passwords on screen); copy and download
  // always use the full value.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => { setExpanded(readInspectorExpanded()); }, []);

  const itemsPerPage = expanded ? PAGE_SIZE.expanded : PAGE_SIZE.compact;
  const toggleExpanded = () => {
    const next = !expanded;
    // Keep the first visible line on screen across the page-size change.
    const firstShown = (itemPage - 1) * itemsPerPage;
    setItemPage(Math.floor(firstShown / (next ? PAGE_SIZE.expanded : PAGE_SIZE.compact)) + 1);
    setExpanded(next);
    try {
      window.localStorage.setItem(INSPECTOR_SIZE_KEY, next ? "1" : "0");
    } catch { /* storage blocked: the size just is not remembered */ }
  };
  const toggleLine = (item: ParsedItem) => {
    const opening = !openLines.has(item.id);
    setOpenLines((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
    if (opening && item.clipped && item.resourceId != null && fullLines[item.id] == null) {
      fetchOrderLineText(o.order_code, { id: item.resourceId, data: null }, { locale })
        .then((text) => setFullLines((current) => ({ ...current, [item.id]: text })))
        .catch((cause) => setBulkError(apiErrorMessage(cause, t("linesLoadFailed"))));
    }
  };
  const sizeFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const fulfillmentStatus = o.fulfillment?.status ?? o.status;
  const delivered = ["delivered", "completed"].includes(fulfillmentStatus);
  const kind = deliveryKind(o);
  // Stock lines get the line inspector (search, select, per-line claims). Every
  // other kind renders the surface that fits it: proxy controls, API access +
  // usage, task progress, or a plain receipt for manual hand-over.
  const usesInspector = kind === "instant" || (kind === "manual" && (stockLineCount > 0 || o.delivery_count != null));
  const canDispute = o.status === "delivered" && !hasOpenDispute(o)
    && (o.capabilities?.can_dispute ?? canOpenDispute(o.status, o.escrow_expires_at));
  const canAppendClaims = hasOpenDispute(o)
    && (o.capabilities?.can_append_claims ?? o.status === "delivered");
  const canSelectAccounts = canDispute || canAppendClaims;
  const canConfirm = o.status === "delivered" && !hasOpenDispute(o)
    && (o.capabilities?.can_confirm ?? true);
  // The seller's "check before you confirm" list lives on the product, in
  // the reader's language; fetched only while the order can be confirmed.
  const productRef = o.product_key ? (o.product_slug ? `${o.product_slug}-${o.product_key}` : o.product_key) : null;
  const inspection = useQuery({
    queryKey: ["product-inspection", productRef, locale],
    queryFn: () => api.product(productRef!),
    enabled: canConfirm && !!productRef,
    staleTime: 5 * 60_000,
    select: (product) => product.inspection_steps?.filter(Boolean) ?? [],
  });
  // Reviews open the moment goods are delivered — confirming (releasing escrow) is not required.
  const canReview = !reviewDone && !o.has_review
    && (o.capabilities?.can_review ?? ["delivered", "completed"].includes(o.status));

  useEffect(() => {
    if (!canConfirm) setAskConfirm(false);
  }, [canConfirm]);
  const canChat = o.capabilities?.can_chat ?? !["cancelled", "refunded"].includes(o.status);
  // The protection cell says where the money is, not just when escrow ends:
  // held (delivered), paused (dispute), released (completed) or returned.
  const escrowState = useMemo<{ label: string; tone: "good" | "bad" | "muted" }>(() => {
    if (hasOpenDispute(o)) return { label: t("escrowPaused"), tone: "bad" };
    if (o.status === "refunded") return { label: t("refundedToWallet"), tone: "muted" };
    if (o.status === "cancelled") return { label: t("escrowNone"), tone: "muted" };
    if (o.status === "completed" || o.settlement?.status === "released") return { label: t("escrowReleased"), tone: "muted" };
    if (o.status === "delivered" && o.escrow_expires_at) return { label: t("escrowUntil", { date: formatDate(o.escrow_expires_at, locale) }), tone: "good" };
    return { label: t("escrowAuto"), tone: "good" };
  }, [o, t, locale]);
  const showReview = canReview || !!reviewDone || !!o.has_review;

  const filteredItems = useMemo(() => {
    if (!deferredItemSearch.trim()) return items;
    const q = deferredItemSearch.toLowerCase().replace(/^#/, "");
    return items.filter((it) => {
      if (it.raw.toLowerCase().includes(deferredItemSearch.toLowerCase())) return true;
      // "#03" / "3" finds stock line 3 (line numbers are what the UI shows).
      if (/^\d+$/.test(q) && Number(q) === it.id) return true;
      return false;
    });
  }, [items, deferredItemSearch]);

  const deliveryLabels = useMemo(() => resourceLabelMap([...caseLines, ...resources]), [caseLines, resources]);
  const deliveryLines = useMemo(() => resourceLineMap([...caseLines, ...resources]), [caseLines, resources]);

  const selectableFilteredResourceIds = useMemo(
    () => filteredItems.flatMap((item) => {
      if (!item.resourceId || !canSelectAccounts) return [];
      const mark = accountMarks[item.resourceId];
      return isDeliveryRowClaimable({
        resourceStatus: item.resourceStatus,
        mark,
        generation: resourceWarrantyGeneration(item.resourceId, caseRecord?.resource_actions),
      })
        ? [item.resourceId]
        : [];
    }),
    [accountMarks, canSelectAccounts, caseRecord?.resource_actions, filteredItems],
  );

  const liveItems = useMemo(
    () => items.filter((item) => !item.resourceId || item.resourceStatus === "assigned"),
    [items],
  );

  const paginatedItems = useMemo(() => {
    const start = (itemPage - 1) * itemsPerPage;
    return filteredItems.slice(start, start + itemsPerPage);
  }, [filteredItems, itemPage]);

  useEffect(() => {
    if (highlightIds.size === 0 || items.length === 0) return;
    const index = items.findIndex((item) => item.resourceId != null && highlightIds.has(item.resourceId));
    if (index >= 0) setItemPage(Math.floor(index / itemsPerPage) + 1);
  }, [highlightIds, items, itemsPerPage]);

  // A highlighted line past the loaded pages (a notification about line #850)
  // loads the rest so it can be shown.
  const { complete: linesComplete, isFetchingNextPage, loadAll: loadAllLines } = orderLines;
  useEffect(() => {
    if (linesComplete || isFetchingNextPage || resources.length === 0) return;
    const loadedIds = new Set(resources.map((r) => r.id));
    const needed = highlightLines.some((line) => line > resources.length)
      || highlightResourceIds.some((id) => !loadedIds.has(id));
    if (needed) void loadAllLines().catch(() => {});
  }, [highlightLines, highlightResourceIds, isFetchingNextPage, linesComplete, loadAllLines, resources]);

  const totalItemPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));

  const toggleResource = (resourceId: number) => {
    setSelectedResourceIds((current) => {
      const next = new Set(current);
      if (next.has(resourceId)) next.delete(resourceId); else next.add(resourceId);
      return next;
    });
  };

  const openSelectedDispute = () => {
    const resourceIds = [...selectedResourceIds];
    if (resourceIds.length === 0) return;
    onOpenDispute(o.id, {
      variantName: o.variant_name,
      resourceIds,
      initialReason: t("reasonSelectedAccounts", { count: resourceIds.length }),
      initialEvidence: { issue: t("evidenceIssueItem") },
    });
  };

  const handleCopySingle = async (item: ParsedItem) => {
    try {
      if (item.clipped && item.resourceId != null) {
        // Already opened: the full text is here; otherwise it is fetched on click.
        await copyOrderLine(o.order_code, { id: item.resourceId, data: fullLines[item.id] ?? null, data_preview: item.raw }, { locale });
      } else {
        await navigator.clipboard.writeText(item.raw);
      }
      setCopiedKey(item.id);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (cause) {
      setBulkError(apiErrorMessage(cause, t("linesLoadFailed")));
    }
  };

  const handleCopyAll = async () => {
    setBulkError("");
    setBulkBusy("copy");
    try {
      if (resources.length > 0) {
        // Stock lines: every live line, streamed by the server (the list holds
        // only pages, and only the head of long lines).
        await copyFromBff(api.orderDeliveryUrl(o.order_code), {
          locale, transform: copyFormat === "userpass" ? userPassLines : undefined,
        });
      } else {
        const out = copyFormat === "userpass"
          ? liveItems.map((it) => (it.user && it.pass ? `${it.user}|${it.pass}` : it.raw)).join("\n")
          : liveItems.map((it) => it.raw).join("\n");
        await navigator.clipboard.writeText(out);
      }
      setCopiedKey("all");
      setTimeout(() => setCopiedKey(null), 2500);
    } catch (cause) {
      setBulkError(apiErrorMessage(cause, t("linesLoadFailed")));
    } finally {
      setBulkBusy(null);
    }
  };

  const handleDownload = async () => {
    setBulkError("");
    setBulkBusy("download");
    try {
      // Streamed by the server: every live line, however large the order.
      await downloadFromBff(api.orderDeliveryUrl(o.order_code), {
        fileName: deliveredDataFileName(o), fallbackName: deliveredDataFileName(o), locale,
      });
    } catch (cause) {
      setBulkError(apiErrorMessage(cause, t("linesLoadFailed")));
    } finally {
      setBulkBusy(null);
    }
  };

  const liveLineCount = resources.length > 0 ? (o.delivery_count ?? liveItems.length) : liveItems.length;

  const tabButton = (tab: InspectorTab, icon: React.ReactNode, label: string) => (
    <button
      key={tab}
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      onClick={() => setActiveTab(tab)}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris ${
        activeTab === tab ? "bg-iris text-white font-semibold" : "text-muted hover:bg-raised hover:text-fg"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  const KindIcon = kind === "proxy" ? Activity : kind === "api" ? Bolt : kind === "task" ? ClipboardList : kind === "manual" ? FileText : Layers;
  const lineCount = resources.length > 0 ? stockLineCount : items.length;
  const deliveryTabLabel = usesInspector && lineCount > 0
    ? t("tabDeliveryData", { count: lineCount })
    : t(KIND_TAB_KEY[kind]);
  const receiptFileName = deliveredDataFileName(o);
  const receipt = deliveredText ? (
    <Disclosure label={t("proxyRaw")} labelOpen={t("proxyRawHide")} open={showReceipt} onToggle={() => setShowReceipt((v) => !v)}>
      <div className="mt-2"><DeliveryReceipt text={deliveredText} fileName={receiptFileName} /></div>
    </Disclosure>
  ) : null;
  const pendingState = (
    <div className="rounded-xl border border-dashed border-line p-8 text-center text-muted">
      <p className="text-[13px]">{st.hint || t("noDeliveryData")}</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !lockDismiss) onClose(); }}>
      <DialogContent
        className={cn(
          "left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-line bg-surface p-0 shadow-card-lg sm:rounded-2xl data-[state=open]:slide-in-from-top-[0%] data-[state=closed]:slide-out-to-top-[0%] data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
          // Phones are always full screen; desktop toggles between the data
          // dialog size and the whole viewport (minus a 16px gutter).
          expanded
            ? "sm:left-4 sm:top-4 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]"
            : "sm:left-1/2 sm:top-[5dvh] sm:h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-4xl sm:-translate-x-1/2",
        )}
        onPointerDownOutside={(event) => { if (lockDismiss) event.preventDefault(); }}
        onInteractOutside={(event) => { if (lockDismiss) event.preventDefault(); }}
      >
        <button
          type="button"
          onClick={toggleExpanded}
          aria-pressed={expanded}
          aria-label={expanded ? t("restoreDialog") : t("expandDialog")}
          title={expanded ? t("restoreDialog") : t("expandDialog")}
          className="absolute right-11 top-2.5 z-10 hidden h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris sm:inline-flex"
        >
          {expanded ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
        {/* Fixed-height frame: header + tabs stay put and only the body scrolls,
            so switching tabs never re-centres or resizes the dialog. */}
        <div className="shrink-0 space-y-3 border-b border-line px-4 pt-4 sm:px-6 sm:pt-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pr-8 sm:pr-20">
          <div className="flex items-center gap-3.5 min-w-0">
            <ProductCover
              coverId={parseCoverId(o)}
              title={o.product_title ?? "??"}
              className="h-11 w-11 rounded-xl shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[16px] sm:text-[17px] font-bold text-fg tracking-tight break-words">
                  {o.product_title ?? tc("orderNumber", { id: o.order_code })}
                </h2>
                <Tag tone={st.tone}>{st.label}</Tag>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-muted mt-1 flex-wrap">
                <span className="font-mono font-bold text-iris">{o.order_code}</span>
                <span>•</span>
                <span className="whitespace-nowrap">{formatDateTime(o.created_at, locale)}</span>
                {o.seller_name && (
                  <>
                    <span>•</span>
                    {o.seller_path ? (
                      <Link href={o.seller_path} className="font-medium text-fg hover:text-iris hover:underline">{o.seller_name}</Link>
                    ) : (
                      <span className="font-medium text-fg">{o.seller_name}</span>
                    )}
                  </>
                )}
                {o.variant_name && (
                  <>
                    <span>•</span>
                    <span className="font-medium text-fg bg-raised px-2 py-0.5 rounded-md border border-line break-all">
                      {nameCarriesTerm(o.variant_name, termFor(o.service_type).term) ? o.variant_name : t("packageNamed", { name: o.variant_name, ...termFor(o.service_type) })}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Top KPI row */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 rounded-xl border border-line bg-raised/40 p-3 text-center">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">{t("qtyDelivered")}</div>
            <div className="font-mono text-[16px] font-bold text-iris mt-0.5">
              {usesInspector && lineCount > 0
                ? t("qtyWithLines", { count: o.quantity.toLocaleString(), lines: lineCount })
                : `x${o.quantity.toLocaleString()}`}
            </div>
          </div>

          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">{t("payment")}</div>
            <div className="font-mono text-[16px] font-bold text-fg mt-0.5 tabular">
              {money.text}
            </div>
            {o.discount_amount ? (
              <div className="mt-0.5 text-[11.5px] text-good">
                {t("promoApplied", {
                  code: o.promo_code ?? "",
                  amount: formatOrderHistoryMoney(o.discount_amount, o.display_fx_rate_snapshot, { locale }).text,
                })}
              </div>
            ) : null}
          </div>

          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">{t("escrowInsurance")}</div>
            <div className={`text-[12px] font-medium flex items-center justify-center gap-1 mt-1 ${escrowState.tone === "good" ? "text-good" : escrowState.tone === "bad" ? "text-bad" : "text-muted"}`}>
              <ShieldCheck size={14} />
              <span>{escrowState.label}</span>
            </div>
          </div>

          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">{t("disputeProduct")}</div>
            {hasCase ? (
              <button
                onClick={() => setActiveTab("dispute")}
                className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-bad hover:underline cursor-pointer"
              >
                <AlertTriangle size={12} />
                {t("disputeViewCase")}
              </button>
            ) : canDispute ? (
              <button
                onClick={() => {
                  onOpenDispute(o.id, {
                    variantName: o.variant_name,
                    initialReason: "",
                    initialEvidence: { issue: t("evidenceIssuePackage") },
                  });
                }}
                className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-bad hover:underline cursor-pointer"
              >
                <AlertTriangle size={12} />
                {o.variant_name ? t("disputeThisPackage") : t("disputeThisOrder")}
              </button>
            ) : (
              <div className="mt-1 text-[12px] text-faint">&mdash;</div>
            )}
          </div>
        </div>


          {/* The steps with their times, on phones too (stacked); the expanded
              view keeps the header short for the delivered lines. */}
          {!expanded && !["refunded", "cancelled"].includes(o.status) && (
            <div className="rounded-xl border border-line bg-surface px-3 py-3 sm:px-4">
              <OrderTimeline order={o} disputed={hasOpenDispute(o)} />
            </div>
          )}

          <div role="tablist" aria-label={t("details")} className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-2 pt-1 scrollbar-none">
            {tabButton("delivery", <KindIcon size={14} />, deliveryTabLabel)}
            {hasCase && tabButton("dispute", <AlertTriangle size={14} />, t("tabDispute"))}
            {showReview && tabButton("review", <Star size={14} />, t("tabReview"))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
          {activeTab === "delivery" && (
            <div className={cn("space-y-3", !(usesInspector && items.length > 0) && "py-4")}>
              {usesInspector ? (
                <>
    {orderLines.isPending && orderLines.fetchStatus !== "idle" ? (
      <div className="rounded-xl border border-dashed border-line p-8 text-center text-[13px] text-muted">{tc("loading")}</div>
    ) : orderLines.isError && resources.length === 0 ? (
      <div className="rounded-xl border border-bad/30 bg-bad-soft/30 p-6 text-center">
        <p className="text-[13px] text-bad">{apiErrorMessage(orderLines.error, t("linesLoadFailed"))}</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => void orderLines.refetch()}>{t("retryLines")}</Button>
      </div>
    ) : items.length > 0 ? (
      <>
        {/* Search & bulk actions stay reachable while the list scrolls (desktop;
            on phones they scroll away so the lines get the small screen). */}
        <div className="z-20 -mx-4 space-y-2.5 border-b border-line bg-surface px-4 pb-3 pt-4 sm:sticky sm:top-0 sm:-mx-6 sm:px-6">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => {
                setItemSearch(e.target.value);
                setItemPage(1);
              }}
              placeholder={t("searchAccounts", { count: lineCount.toLocaleString() })}
              className="w-full rounded-xl border border-line bg-canvas pl-8.5 pr-3 py-2 text-[12.5px] text-fg placeholder:text-placeholder focus:border-iris focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {selectableFilteredResourceIds.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelectedResourceIds(new Set(selectableFilteredResourceIds))}
              >
                {t("selectAllResults", { count: selectableFilteredResourceIds.length })}
              </Button>
            )}
            {!isServiceDelivery && (
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-pressed={revealed}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-2 text-[12px] font-semibold text-fg hover:bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
              >
                {revealed ? <EyeOff size={14} /> : <Eye size={14} />} {revealed ? t("hideLines") : t("showLines")}
              </button>
            )}
            <button
              onClick={() => void handleCopyAll()}
              disabled={bulkBusy !== null}
              aria-busy={bulkBusy === "copy"}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-iris px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-iris/90 transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2"
            >
              {copiedKey === "all" ? <Check size={14} /> : <Copy size={14} />}
              {bulkBusy === "copy" ? t("preparingLines") : copiedKey === "all" ? t("copiedAll") : t("copyAllCount", { count: liveLineCount })}
            </button>

            <button
              onClick={() => void handleDownload()}
              disabled={bulkBusy !== null}
              aria-busy={bulkBusy === "download"}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-surface px-3.5 py-2 text-[12px] font-semibold text-fg hover:bg-raised transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2"
            >
              <Download size={14} /> {bulkBusy === "download" ? t("preparingLines") : t("downloadTxt")}
            </button>
          </div>
        </div>
        {bulkError && <p role="alert" className="text-[11.5px] text-bad">{bulkError}</p>}
        {selectedResourceIds.size > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-bad/25 bg-bad-soft/30 px-3.5 py-2">
            <div className="text-[12px] font-semibold text-fg">
              {t("selectedAccounts", { count: selectedResourceIds.size })}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelectedResourceIds(new Set())}>{tc("cancel")}</Button>
              <Button size="sm" variant="danger" onClick={openSelectedDispute}>
                <AlertTriangle size={13} className="mr-1" />
                {o.has_dispute ? t("addToDispute") : t("openDisputeSelected")}
              </Button>
            </div>
          </div>
        )}
        </div>
        {liveLineCount !== lineCount && (
          <p className="text-[11px] text-muted">{t("copyLiveHint")}</p>
        )}
        {!orderLines.complete && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2 text-[11.5px] text-muted">
            <span>{t("linesLoaded", { loaded: resources.length.toLocaleString(), total: stockLineCount.toLocaleString() })}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={orderLines.isFetchingNextPage}
              onClick={() => void orderLines.loadAll().catch(() => {})}
            >
              {orderLines.isFetchingNextPage ? tc("loading") : t("loadAllLines")}
            </Button>
          </div>
        )}

        {/* One compact row per line; the dialog body is the only scroll area. */}
        <div className="rounded-xl border border-line divide-y divide-line bg-canvas">
          {paginatedItems.map((item, idx) => {
            const batch = item.batchId != null ? orderLines.batches.get(item.batchId) : undefined;
            // Stock lines are grouped by the batch they came from: a header with
            // its format and login notes opens each block.
            const blockHeader = orderLines.batches.size > 0 && startsBatchBlock(paginatedItems.map((row) => row.batchId), idx)
              ? <BatchBlockHeader key={`batch-${item.id}`} format={batch?.format ?? null} note={batch?.login_note ?? null} />
              : null;
            const fields = batch && !item.clipped && !isServiceDelivery ? labelledFields(item.raw, batch.format, !revealed) : null;
            const globalIdx = (itemPage - 1) * itemsPerPage + idx + 1;
            const isCopied = copiedKey === item.id;
            const mark = item.resourceId ? accountMarks[item.resourceId] : undefined;
            const highlighted = !!item.resourceId && highlightIds.has(item.resourceId);
            const inactive = mark?.kind === "refunded" || mark?.kind === "replaced" || item.resourceStatus === "error";
            const showRowIndex = !item.isConfigOrInstruction && !isServiceDelivery && items.length > 1;
            const fullLength = item.length ?? item.raw.length;
            const long = fullLength > LINE_CLIP;
            const lineOpen = openLines.has(item.id);
            const fullText = item.clipped ? fullLines[item.id] : item.raw;
            const claimable = canSelectAccounts && item.resourceId != null && isDeliveryRowClaimable({
              resourceStatus: item.resourceStatus,
              mark,
              generation: resourceWarrantyGeneration(item.resourceId, caseRecord?.resource_actions),
            });
            return (
              <React.Fragment key={item.id}>
              {blockHeader}
              <div
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-3 py-2.5 text-[12px] transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto]",
                  highlighted ? "bg-iris-soft/40" : "hover:bg-raised/40",
                  inactive && "opacity-70",
                )}
              >
                <div className="flex items-center gap-2 pt-px">
                  {item.resourceId && (
                    <input
                      type="checkbox"
                      aria-label={t("selectAccount", { id: item.resourceId })}
                      checked={selectedResourceIds.has(item.resourceId)}
                      disabled={!claimable}
                      onChange={() => toggleResource(item.resourceId!)}
                      className="h-4 w-4 shrink-0 accent-iris disabled:opacity-35 cursor-pointer"
                    />
                  )}
                  {item.resourceId ? (
                    <span className="min-w-9 rounded bg-iris-soft px-1.5 py-0.5 text-center font-mono text-[10.5px] font-bold text-iris tabular">
                      {lineLabel(item.id)}
                    </span>
                  ) : showRowIndex ? (
                    <span className="min-w-9 text-center font-mono text-[10.5px] text-faint tabular">
                      #{String(globalIdx).padStart(2, "0")}
                    </span>
                  ) : null}
                </div>

                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
                    <DeliveryAccountBadge
                      mark={mark}
                      highlighted={highlighted}
                      formatRefund={formatBrowseMoney}
                      lineOf={deliveryLines}
                    />
                    {item.resourceId && itemSearch.replace(/^#/, "") === String(item.id).padStart(2, "0") && !highlighted && (
                      <span className="shrink-0 rounded-md bg-iris-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-iris-hi">
                        {t("accountFromTimeline")}
                      </span>
                    )}
                  </div>
                  {fields && !long ? (
                    <dl className={cn("flex flex-wrap gap-x-3 gap-y-1 leading-5", inactive && "text-muted line-through")}>
                      {fields.map((field, index) => (
                        <div key={index} className="flex min-w-0 max-w-full items-baseline gap-1.5">
                          <dt className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-iris-hi">{field.label}</dt>
                          <dd className={cn("min-w-0 break-all font-mono text-[12px]", inactive ? "text-muted" : "text-fg")}>{field.value || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <>
                      {batch && !item.clipped && !isServiceDelivery && (
                        <Tag tone="warn" className="font-semibold">{t("formatMismatch", { fields: item.raw.split("|").length, expected: batch.field_count })}</Tag>
                      )}
                      <p
                        className={cn(
                          "font-mono text-[12px] leading-5 break-all",
                          inactive ? "text-muted line-through" : "text-fg",
                          long && lineOpen && "max-h-64 overflow-y-auto rounded-md bg-raised/60 p-2",
                        )}
                      >
                        {!revealed && !item.isConfigOrInstruction && !isServiceDelivery
                          ? maskDeliveredLine(item.raw)
                          : long && !(lineOpen && fullText != null) ? `${item.raw.slice(0, LINE_CLIP)}…` : fullText}
                      </p>
                    </>
                  )}
                  {long && (revealed || item.isConfigOrInstruction || isServiceDelivery) && (
                    <button
                      type="button"
                      onClick={() => toggleLine(item)}
                      aria-expanded={lineOpen}
                      className="rounded text-[11px] font-medium text-iris hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                    >
                      {lineOpen
                        ? t("collapseLine")
                        : t("showFullLine", { size: `${sizeFormat.format(fullLength / 1024)} KB` })}
                    </button>
                  )}
                </div>

                <div className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1">
                  {claimable && (
                    <button
                      type="button"
                      title={t("disputeThisItem")}
                      onClick={() => {
                        onOpenDispute(o.id, {
                          variantName: o.variant_name,
                          initialReason: t("reasonItemPrefix", { n: globalIdx, raw: item.raw.slice(0, LINE_CLIP) }),
                          initialEvidence: { username: item.user || item.raw.slice(0, LINE_CLIP), issue: t("evidenceIssueItem") },
                          resourceIds: item.resourceId ? [item.resourceId] : undefined,
                        });
                      }}
                      className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[11px] text-bad transition-colors hover:bg-bad-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                    >
                      <AlertTriangle size={11} />
                      <span>{mark?.kind === "replacement" ? t("warrantyIssue") : t("itemIssue")}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleCopySingle(item)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                      isCopied ? "bg-good text-white" : "border border-line bg-surface text-iris hover:bg-iris hover:text-white",
                    )}
                  >
                    {isCopied ? <Check size={12} /> : <Copy size={12} />}
                    <span>{isCopied ? t("copiedShort") : tc("copy")}</span>
                  </button>
                </div>
              </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Pager stays on screen at the bottom of the scroll area. */}
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between border-t border-line bg-surface px-4 py-2.5 text-[12px] text-muted sm:-mx-6 sm:px-6">
          <span>
            {t("showingItems", {
              from: (itemPage - 1) * itemsPerPage + 1,
              to: Math.min(itemPage * itemsPerPage, filteredItems.length),
              total: filteredItems.length.toLocaleString(),
            })}
          </span>

          <div className="flex items-center gap-1">
            <button
              disabled={itemPage === 1}
              onClick={() => setItemPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-line p-1 hover:bg-raised disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-2 font-mono font-semibold text-fg">
              {itemPage} / {totalItemPages}
            </span>
            <button
              disabled={itemPage === totalItemPages && (orderLines.complete || orderLines.isFetchingNextPage)}
              aria-label={t("nextLinesPage")}
              onClick={() => {
                // The last loaded page continues into the next server page.
                if (itemPage === totalItemPages && !orderLines.complete) {
                  void orderLines.fetchNextPage().then(() => setItemPage((p) => p + 1));
                  return;
                }
                setItemPage((p) => Math.min(totalItemPages, p + 1));
              }}
              className="rounded-lg border border-line p-1 hover:bg-raised disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </>
    ) : (
      <div className="rounded-xl border border-dashed border-line p-8 text-center text-muted">
        <p className="text-[13px]">{st.hint || t("noDeliveryData")}</p>
      </div>
    )}

                </>
              ) : kind === "proxy" ? (
                <>
                  {delivered ? (
                    <>
                      <OrderProxyPanel
                        orderId={o.id}
                        deliveredData={deliveredText}
                        onDelivered={onDelivered}
                        onAvailability={setProxyPanelApplicable}
                      />
                      {proxyPanelApplicable === false && (
                        <>
                          <ServiceDashboard orderId={o.id} viewerRole="buyer" />
                          {receipt}
                        </>
                      )}
                    </>
                  ) : pendingState}
                </>
              ) : kind === "api" || kind === "task" ? (
                <>
                  {o.status === "pending" ? pendingState : <ServiceDashboard orderId={o.id} viewerRole="buyer" />}
                  {receipt}
                </>
              ) : (
                // manual hand-over without stock lines: the receipt is the delivery
                deliveredText ? <DeliveryReceipt text={deliveredText} fileName={receiptFileName} />
                  : needsText && detailQuery.isPending ? <div className="rounded-xl border border-dashed border-line p-8 text-center text-[13px] text-muted">{tc("loading")}</div>
                  : pendingState
              )}
            </div>
          )}

          {activeTab === "dispute" && hasCase && (
            <div className="space-y-3 py-4">
    <p className="text-[12px] text-muted">{t("disputeTabHint")}</p>
    <OrderDispute
      orderId={o.id}
      refreshKey={disputeRevision}
      layout="panel"
      resourceLabels={deliveryLabels}
      onResourceClick={(resourceId) => {
        const line = deliveryLines[resourceId];
        setItemSearch(line ? lineLabel(line) : "");
        setItemPage(1);
        setActiveTab("delivery");
        if (line && line > resources.length && !orderLines.complete) void orderLines.loadAll().catch(() => {});
      }}
      onClaimAccounts={(resourceIds) => {
        onOpenDispute(o.id, {
          variantName: o.variant_name,
          resourceIds,
          initialReason: t("reasonSelectedAccounts", { count: resourceIds.length }),
          initialEvidence: { issue: t("evidenceIssueItem") },
        });
      }}
      onDisputeChanged={(outcome) => {
        setActiveTab("delivery");
        onDisputeChanged(o, outcome);
      }}
    />
            </div>
          )}

          {activeTab === "review" && showReview && (
            <div className="space-y-4 py-4">
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-fg text-[13.5px]">{t("reviewSeller")}</span>
        <Star size={16} className="text-warn fill-warn" />
      </div>
      <ul className="space-y-1 text-[11.5px] text-muted">
        {[t("reviewHow1"), t("reviewHow2"), t("reviewHow3")].map((line, i) => (
          <li key={i} className="flex items-start gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-good" />{line}</li>
        ))}
      </ul>
      {canReview ? <ReviewForm
        orderId={o.id}
        onDone={(ok, msg) => {
          onReviewDone(o.id, ok, msg);
        }}
        onCancel={() => setActiveTab("delivery")}
      /> : <p className="text-[12px] text-muted">{t("reviewed")}</p>}
    </div>

    {canChat && (
      <div className="rounded-xl border border-line bg-surface p-4 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-fg">{t("chatSellerTitle")}</div>
          <div className="text-[11.5px] text-muted">{t("chatSellerHint")}</div>
        </div>
        <OrderChatButton orderId={o.id} />
      </div>
    )}
            </div>
          )}
        </div>

        {/* Modal Footer — confirm stays here so every tab can finish the order */}
        <div className="shrink-0 space-y-2 border-t border-line bg-surface px-4 py-3 sm:px-6">
          {canConfirm && askConfirm && (
            <div className="rounded-xl border border-warn/30 bg-warn-soft px-3 py-2.5">
              {(inspection.data?.length ?? 0) > 0 && (
                <InspectionChecklist steps={inspection.data!} className="mb-2.5 border-b border-warn/20 pb-2.5" />
              )}
              <p className="text-[12.5px] font-semibold text-fg">{t("confirmReleaseTitle", { amount: money.text })}</p>
              <p className="text-[11.5px] text-muted mt-0.5">{t("confirmReleaseBody")}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button size="sm" onClick={() => onConfirm(o.id)} disabled={confirming}>
                  {confirming ? t("confirming") : t("confirmReleaseYes")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAskConfirm(false)} disabled={confirming}>
                  {t("confirmReleaseMore")}
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {canChat ? <OrderChatButton orderId={o.id} /> : <span />}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" size="md" onClick={onClose} disabled={confirming}>
                {tc("close")}
              </Button>
              {canConfirm && !askConfirm && (
                <Button size="md" onClick={() => setAskConfirm(true)} disabled={confirming}>
                  {t("confirmReceived")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Opens a block of delivered lines from one stock batch: its format (the
 *  column names) and how to sign in. Lines uploaded before formats existed
 *  get a plain "no format" header when the order also has formatted lines. */
function BatchBlockHeader({ format, note }: { format: string | null; note: string | null }) {
  const t = useTranslations("orders");
  return (
    <div className="space-y-1 bg-iris-soft/35 px-3 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={format ? "iris" : "neutral"} className="font-semibold uppercase tracking-wide">{format ? t("formatTag") : t("noFormatTag")}</Tag>
        {format ? (
          <>
            <code className="min-w-0 max-w-full break-all font-mono text-[12.5px] font-semibold text-iris-hi">{format}</code>
            <CopyButton text={format} label={t("copyFormat")} className="ml-auto" />
          </>
        ) : (
          <span className="text-muted">{t("noFormatHint")}</span>
        )}
      </div>
      {note && (
        <div className="flex items-start gap-2 rounded-lg border border-iris/25 bg-surface px-2.5 py-2">
          <Info size={14} className="mt-0.5 shrink-0 text-iris" />
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-iris-hi">{t("sellerNote")}</div>
            <p className="break-words text-[12.5px] leading-relaxed text-fg">{note}</p>
          </div>
        </div>
      )}
    </div>
  );
}
