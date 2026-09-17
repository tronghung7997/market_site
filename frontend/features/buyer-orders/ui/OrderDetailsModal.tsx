"use client";

import React, { useDeferredValue, useEffect, useState, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
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
} from "@/components/Icons";
import {
  deliveryResourceMarks,
  isDeliveryRowClaimable,
  resourceLabelMap,
  resourceWarrantyGeneration,
} from "@/lib/dispute-case";
import { lineLabel, resourceLineMap } from "@/lib/order-ref";
import { DeliveryAccountBadge } from "@/components/orders/DeliveryAccountBadge";
import { canOpenDispute, displayOrderStatus, hasOpenDispute } from "@/lib/order-status";
import { fulfillmentFromOrder } from "@/lib/fulfillment";
import { deliveredDataFileName } from "../model";
import { useVariantTermFor } from "@/lib/variant-term";
import { formatDate, formatDateTime } from "@/lib/utils";
import { useMoney } from "@/lib/money";
import { api } from "@/lib/api";
import type { Dispute, Order, Resource } from "@/lib/types";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Button, CopyButton, Disclosure, Tag } from "@/components/ui";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import OrderProxyPanel from "./OrderProxyPanel";
import ServiceDashboard from "@/components/ServiceDashboard";
import { OrderDispute, StatusTimeline } from "@/components/orders/OrderCardPrimitives";
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
}

type InspectorTab = "delivery" | "review" | "dispute";
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
  const st = displayOrderStatus(o, locale);
  const money = formatOrderHistoryMoney(o.total_amount, o.display_fx_rate_snapshot, { locale });

  // Parsing delivered_data (multi-line accounts/proxies/gateway keys)
  const lines = useMemo(() => {
    if (!o.delivered_data) return [];
    return o.delivered_data
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }, [o.delivered_data]);

  const parsedItems: ParsedItem[] = useMemo(() => {
    return lines.map((line, idx) => {
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
  }, [lines]);

  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<number>>(new Set());
  const [caseRecord, setCaseRecord] = useState<Dispute | null>(null);
  const hasCase = Boolean(o.has_dispute || o.dispute_status);

  useEffect(() => {
    setSelectedResourceIds(new Set());
  }, [disputeRevision]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.orderResources(o.id),
      hasCase ? api.orderDispute(o.id).catch(() => null) : Promise.resolve(null),
    ])
      .then(([rows, dispute]) => {
        if (!active) return;
        setResources(rows);
        setCaseRecord(dispute);
      })
      .catch(() => {
        if (!active) return;
        setResources([]);
        setCaseRecord(null);
      });
    return () => { active = false; };
  }, [hasCase, o.id, disputeRevision]);

  const accountMarks = useMemo(() => deliveryResourceMarks(caseRecord), [caseRecord]);
  const items: ParsedItem[] = useMemo(() => {
    if (resources.length === 0) return parsedItems;
    return resources.map((resource, idx) => {
      const parts = resource.data.split(/[|:]/);
      return {
        id: idx + 1,
        raw: resource.data,
        user: parts[0] || "",
        pass: parts[1] || "",
        resourceId: resource.id,
        resourceStatus: resource.status,
        isConfigOrInstruction: false,
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

  const itemsPerPage = 20;
  const fulfillmentStatus = o.fulfillment?.status ?? o.status;
  const delivered = ["delivered", "completed"].includes(fulfillmentStatus);
  const kind = deliveryKind(o);
  // Stock lines get the line inspector (search, select, per-line claims). Every
  // other kind renders the surface that fits it: proxy controls, API access +
  // usage, task progress, or a plain receipt for manual hand-over.
  const usesInspector = kind === "instant" || (kind === "manual" && resources.length > 0);
  const canDispute = o.status === "delivered" && !hasOpenDispute(o)
    && (o.capabilities?.can_dispute ?? canOpenDispute(o.status, o.escrow_expires_at));
  const canAppendClaims = hasOpenDispute(o)
    && (o.capabilities?.can_append_claims ?? o.status === "delivered");
  const canSelectAccounts = canDispute || canAppendClaims;
  const canConfirm = o.status === "delivered" && !hasOpenDispute(o)
    && (o.capabilities?.can_confirm ?? true);
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

  const deliveryLabels = useMemo(() => resourceLabelMap(resources), [resources]);
  const deliveryLines = useMemo(() => resourceLineMap(resources), [resources]);

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

  const handleCopySingle = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCopyAll = () => {
    let out = "";
    if (copyFormat === "userpass") {
      out = liveItems.map((it) => (it.user && it.pass ? `${it.user}|${it.pass}` : it.raw)).join("\n");
    } else {
      out = liveItems.map((it) => it.raw).join("\n");
    }
    navigator.clipboard.writeText(out);
    setCopiedKey("all");
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleDownload = () => {
    const out = liveItems.map((it) => it.raw).join("\n");
    const blob = new Blob([out], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = deliveredDataFileName(o);
    a.click();
    URL.revokeObjectURL(url);
  };

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
  const deliveryTabLabel = usesInspector && items.length > 0
    ? t("tabDeliveryData", { count: items.length })
    : t(KIND_TAB_KEY[kind]);
  const receiptFileName = deliveredDataFileName(o);
  const receipt = o.delivered_data ? (
    <Disclosure label={t("proxyRaw")} labelOpen={t("proxyRawHide")} open={showReceipt} onToggle={() => setShowReceipt((v) => !v)}>
      <div className="mt-2"><DeliveryReceipt text={o.delivered_data} fileName={receiptFileName} /></div>
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
        className="left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-line bg-surface p-0 shadow-card-lg sm:left-1/2 sm:top-[5dvh] sm:h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-4xl sm:-translate-x-1/2 sm:rounded-2xl data-[state=open]:slide-in-from-top-[0%] data-[state=closed]:slide-out-to-top-[0%] data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100"
        onPointerDownOutside={(event) => { if (lockDismiss) event.preventDefault(); }}
        onInteractOutside={(event) => { if (lockDismiss) event.preventDefault(); }}
      >
        {/* Fixed-height frame: header + tabs stay put and only the body scrolls,
            so switching tabs never re-centres or resizes the dialog. */}
        <div className="shrink-0 space-y-3 border-b border-line px-4 pt-4 sm:px-6 sm:pt-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pr-8">
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
                <span className="font-mono font-bold text-iris">#{o.order_code}</span>
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
                      {t("packageNamed", { name: o.variant_name, ...termFor(o.service_type) })}
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
              {usesInspector && items.length > 0
                ? t("qtyWithLines", { count: o.quantity.toLocaleString(), lines: items.length })
                : `x${o.quantity.toLocaleString()}`}
            </div>
          </div>

          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">{t("payment")}</div>
            <div className="font-mono text-[16px] font-bold text-fg mt-0.5 tabular">
              {money.text}
            </div>
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
                    initialReason: o.variant_name ? t("reasonPackagePrefix", { name: o.variant_name }) : "",
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


          {/* Phones keep the header short: the status tag already says where the order is. */}
          {!["refunded", "cancelled"].includes(o.status) && (
            <div className="-mt-1 hidden sm:block">
              <StatusTimeline status={fulfillmentStatus} />
            </div>
          )}

          <div role="tablist" aria-label={t("details")} className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-2 pt-1 scrollbar-none">
            {tabButton("delivery", <KindIcon size={14} />, deliveryTabLabel)}
            {hasCase && tabButton("dispute", <AlertTriangle size={14} />, t("tabDispute"))}
            {showReview && tabButton("review", <Star size={14} />, t("tabReview"))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {activeTab === "delivery" && (
            <div className="space-y-3">
              {usesInspector ? (
                <>
    {items.length > 0 ? (
      <>
        {/* Search & Action Bar */}
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
              placeholder={t("searchAccounts", { count: items.length.toLocaleString() })}
              className="w-full rounded-xl border border-line bg-canvas pl-8.5 pr-3 py-2 text-[12.5px] text-fg placeholder:text-faint focus:border-iris focus:outline-none"
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
            <button
              onClick={handleCopyAll}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-iris px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-iris/90 transition-colors cursor-pointer"
            >
              {copiedKey === "all" ? <Check size={14} /> : <Copy size={14} />}
              {copiedKey === "all" ? t("copiedAll") : t("copyAllCount", { count: liveItems.length })}
            </button>

            <button
              onClick={handleDownload}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-[12px] font-semibold text-fg hover:bg-raised transition-colors cursor-pointer"
            >
              <Download size={14} /> {t("downloadTxt")}
            </button>
          </div>
        </div>
        {liveItems.length !== items.length && (
          <p className="text-[11px] text-muted">{t("copyLiveHint")}</p>
        )}

        {selectedResourceIds.size > 0 && (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-xl border border-bad/25 bg-surface px-3.5 py-2.5 shadow-card">
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

        {/* Paginated Resource List (Supports up to 10,000 lines without DOM lag) */}
        <div className="max-h-[420px] overflow-y-auto rounded-xl border border-line divide-y divide-line bg-canvas">
          {paginatedItems.map((item, idx) => {
            const globalIdx = (itemPage - 1) * itemsPerPage + idx + 1;
            const isCopied = copiedKey === item.id;
            const mark = item.resourceId ? accountMarks[item.resourceId] : undefined;
            const highlighted = !!item.resourceId && highlightIds.has(item.resourceId);
            const inactive = mark?.kind === "refunded" || mark?.kind === "replaced" || item.resourceStatus === "error";
            const showRowIndex = !item.isConfigOrInstruction && !isServiceDelivery && items.length > 1;
            return (
              <div
                key={item.id}
                className={`p-3 text-[12px] space-y-2 group transition-colors ${
                  highlighted ? "bg-iris-soft/40" : "hover:bg-raised/40"
                } ${inactive ? "opacity-70" : ""}`}
              >
                {/* Top meta row: Badges, Checkbox, Actions */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    {item.resourceId && (
                      <input
                        type="checkbox"
                        aria-label={t("selectAccount", { id: item.resourceId })}
                        checked={selectedResourceIds.has(item.resourceId)}
                        disabled={!canSelectAccounts || !isDeliveryRowClaimable({
                          resourceStatus: item.resourceStatus,
                          mark,
                          generation: resourceWarrantyGeneration(item.resourceId, caseRecord?.resource_actions),
                        })}
                        onChange={() => toggleResource(item.resourceId!)}
                        className="h-4 w-4 shrink-0 accent-iris disabled:opacity-35 cursor-pointer"
                      />
                    )}
                    {item.resourceId ? (
                      <span className="font-mono text-[10.5px] font-bold text-iris bg-iris-soft px-1.5 py-0.5 rounded shrink-0">
                        {lineLabel(item.id)}
                      </span>
                    ) : showRowIndex ? (
                      <span className="font-mono text-[10.5px] text-faint shrink-0">
                        #{String(globalIdx).padStart(2, "0")}
                      </span>
                    ) : null}
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

                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    {/* Dedicated Dispute Button */}
                    {canSelectAccounts && item.resourceId != null && isDeliveryRowClaimable({
                      resourceStatus: item.resourceStatus,
                      mark,
                      generation: resourceWarrantyGeneration(item.resourceId, caseRecord?.resource_actions),
                    }) && (
                      <button
                        title={t("disputeThisItem")}
                        onClick={() => {
                          onOpenDispute(o.id, {
                            variantName: o.variant_name,
                            initialReason: t("reasonItemPrefix", { n: globalIdx, raw: item.raw }),
                            initialEvidence: { username: item.user || item.raw, issue: t("evidenceIssueItem") },
                            resourceIds: item.resourceId ? [item.resourceId] : undefined,
                          });
                        }}
                        className="rounded-lg px-2 py-1 text-[11px] text-bad hover:bg-bad-soft transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <AlertTriangle size={11} />
                        <span>{mark?.kind === "replacement" ? t("warrantyIssue") : t("itemIssue")}</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleCopySingle(item.id, item.raw)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                        isCopied
                          ? "bg-good text-white"
                          : "bg-surface border border-line text-iris hover:bg-iris hover:text-white"
                      }`}
                    >
                      {isCopied ? <Check size={12} /> : <Copy size={12} />}
                      <span>{isCopied ? t("copiedShort") : tc("copy")}</span>
                    </button>
                  </div>
                </div>

                {/* Monospace text box: never cut off, full wrap */}
                <div className={`rounded-lg bg-canvas border border-line/70 p-2 font-mono text-[12px] break-all select-all ${inactive ? "text-muted line-through" : "text-fg"}`}>
                  {item.raw}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between text-[12px] text-muted pt-1">
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
              disabled={itemPage === totalItemPages}
              onClick={() => setItemPage((p) => Math.min(totalItemPages, p + 1))}
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
                        deliveredData={o.delivered_data}
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
                o.delivered_data ? <DeliveryReceipt text={o.delivered_data} fileName={receiptFileName} /> : pendingState
              )}
            </div>
          )}

          {activeTab === "dispute" && hasCase && (
            <div className="space-y-3">
    <p className="text-[12px] text-muted">{t("disputeTabHint")}</p>
    <OrderDispute
      orderId={o.id}
      refreshKey={disputeRevision}
      layout="panel"
      resourceLabels={deliveryLabels}
      onResourceClick={(resourceId) => {
        const line = items.find((item) => item.resourceId === resourceId)?.id;
        setItemSearch(line ? lineLabel(line) : "");
        setItemPage(1);
        setActiveTab("delivery");
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
            <div className="space-y-4">
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
          <div className="flex items-center justify-between gap-3">
            {canChat ? <OrderChatButton orderId={o.id} /> : <span />}
            <div className="flex items-center gap-2">
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
