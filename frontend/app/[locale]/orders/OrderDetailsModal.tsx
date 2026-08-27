"use client";

import React, { useState, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  X,
  Copy,
  Check,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  MessageSquare,
  Star,
  ExternalLink,
  Shield,
  Layers,
  Terminal,
  Activity,
} from "lucide-react";
import { canOpenDispute, orderStatus } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import { useMoney } from "@/lib/money";
import type { Order } from "@/lib/types";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Button, Tag } from "@/components/ui";
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
  resourceId?: string | null;
  isConfigOrInstruction?: boolean;
}

export default function OrderDetailsModal({
  order: o,
  onClose,
  onConfirm,
  confirming,
  onOpenDispute,
  onOpenReview,
  reviewDone,
  onReviewDone,
  onDelivered,
  onPlate,
}: {
  order: Order;
  onClose: () => void;
  onConfirm: (orderId: number) => void;
  confirming: boolean;
  onOpenDispute: (orderId: number, options?: { variantName?: string | null; initialReason?: string; initialEvidence?: Record<string, string> }) => void;
  onOpenReview: (orderId: number) => void;
  reviewDone?: boolean;
  onReviewDone: (orderId: number, ok: boolean, message: string) => void;
  onDelivered: (orderId: number, deliveredData: string) => void;
  onPlate: (orderId: number) => void;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const tcur = useTranslations("currency");
  const locale = useLocale();
  const { formatOrderHistoryMoney, currency, showFxHints } = useMoney();
  const st = orderStatus(o.status, locale);
  const money = formatOrderHistoryMoney(o.total_amount, o.display_fx_rate_snapshot, { locale });

  // Parsing delivered_data (multi-line accounts/proxies/gateway keys)
  const lines = useMemo(() => {
    if (!o.delivered_data) return [];
    return o.delivered_data
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }, [o.delivered_data]);

  const items: ParsedItem[] = useMemo(() => {
    return lines.map((line, idx) => {
      // Check if line contains a resource ID pattern like: id:123, [123], #123, ID=123, res_123
      const idMatch =
        line.match(/(?:^|[\s|;,])(?:id|resource|res|item)[_:\s#=]+([a-zA-Z0-9_-]+)/i) ||
        line.match(/^\[#?([a-zA-Z0-9_-]+)\]/);
      const customId = idMatch ? idMatch[1] : null;

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

  const isServiceDelivery = useMemo(() => {
    if (items.length === 0) return false;
    const configCount = items.filter((it) => it.isConfigOrInstruction).length;
    return configCount > 0 && configCount >= items.length / 2;
  }, [items]);

  const [activeTab, setActiveTab] = useState<"data" | "proxy" | "service" | "escrow" | "review">("data");
  const [itemSearch, setItemSearch] = useState("");
  const [itemPage, setItemPage] = useState(1);
  const [copyFormat, setCopyFormat] = useState<"raw" | "userpass">("raw");
  const [copiedKey, setCopiedKey] = useState<string | number | null>(null);
  const [askConfirm, setAskConfirm] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const itemsPerPage = 20;

  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return items;
    const q = itemSearch.toLowerCase();
    return items.filter((it) => it.raw.toLowerCase().includes(q));
  }, [items, itemSearch]);

  const paginatedItems = useMemo(() => {
    const start = (itemPage - 1) * itemsPerPage;
    return filteredItems.slice(start, start + itemsPerPage);
  }, [filteredItems, itemPage]);

  const totalItemPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));

  const delivered = o.status === "delivered" || o.status === "completed";
  const mayHaveProxy = delivered && o.product_id != null;
  const isDelivered = o.status === "delivered";
  const canDispute = canOpenDispute(o.status, o.escrow_expires_at);

  const handleCopySingle = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCopyAll = () => {
    let out = "";
    if (copyFormat === "userpass") {
      out = items.map((it) => (it.user && it.pass ? `${it.user}|${it.pass}` : it.raw)).join("\n");
    } else {
      out = items.map((it) => it.raw).join("\n");
    }
    navigator.clipboard.writeText(out);
    setCopiedKey("all");
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleDownload = () => {
    const out = items.map((it) => it.raw).join("\n");
    const blob = new Blob([out], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DonHang_${o.id}_${o.quantity}_tai_khoan.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl border-line bg-surface p-6 gap-0 max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <ProductCover
              coverId={parseCoverId(o)}
              title={o.product_title ?? "??"}
              className="h-11 w-11 rounded-xl shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[17px] font-bold text-fg tracking-tight truncate">
                  {o.product_title ?? tc("orderNumber", { id: o.id })}
                </h2>
                <Tag tone={st.tone}>{st.label}</Tag>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-muted mt-1 flex-wrap">
                <span className="font-mono font-bold text-iris">#{o.id}</span>
                <span>•</span>
                <span>{formatDateTime(o.created_at, locale)}</span>
                {o.variant_name && (
                  <>
                    <span>•</span>
                    <span className="font-medium text-fg bg-raised px-2 py-0.5 rounded-md border border-line">
                      Gói: {o.variant_name}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Highlights Banner */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-line bg-raised/40 p-3 text-center">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">Số lượng bàn giao</div>
            <div className="font-mono text-[16px] font-bold text-iris mt-0.5">
              x{o.quantity.toLocaleString()} {items.length > 0 ? `(${items.length} dòng)` : ""}
            </div>
          </div>

          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">Thanh toán</div>
            <div className="font-mono text-[16px] font-bold text-fg mt-0.5 tabular">
              {money.text}
            </div>
          </div>

          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">Bảo hiểm Escrow</div>
            <div className="text-[12px] font-medium text-good flex items-center justify-center gap-1 mt-1">
              <ShieldCheck size={14} className="text-good" />
              <span>
                {o.escrow_expires_at
                  ? t("escrowUntil", { date: formatDate(o.escrow_expires_at, locale) })
                  : "Bảo hiểm tự động"}
              </span>
            </div>
          </div>

          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">Khiếu nại sản phẩm</div>
            {canDispute && (
              <button
                onClick={() => {
                  onOpenDispute(o.id, {
                    variantName: o.variant_name,
                    initialReason: o.variant_name ? `[Khiếu nại gói: ${o.variant_name}] ` : "",
                    initialEvidence: { issue: "Gặp sự cố với gói sản phẩm này..." },
                  });
                }}
                className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-bad hover:underline cursor-pointer"
              >
                <AlertTriangle size={12} />
                {o.variant_name ? `Khiếu nại gói này` : `Khiếu nại đơn`}
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 border-b border-line pb-2 pt-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab("data")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
              activeTab === "data"
                ? "bg-iris text-white shadow-sm font-semibold"
                : "text-muted hover:text-fg hover:bg-raised"
            }`}
          >
            <Layers size={14} />
            <span>Dữ liệu bàn giao {items.length > 0 ? `(${items.length})` : ""}</span>
          </button>

          {mayHaveProxy && (
            <button
              onClick={() => setActiveTab("proxy")}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
                activeTab === "proxy"
                  ? "bg-iris text-white shadow-sm font-semibold"
                  : "text-muted hover:text-fg hover:bg-raised"
              }`}
            >
              <Activity size={14} />
              <span>Quản lý Proxy / Đổi IP</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab("escrow")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
              activeTab === "escrow"
                ? "bg-iris text-white shadow-sm font-semibold"
                : "text-muted hover:text-fg hover:bg-raised"
            }`}
          >
            <Shield size={14} />
            <span>Bảo hành & Tranh chấp {o.has_dispute ? "⚠️" : ""}</span>
          </button>

          <button
            onClick={() => setActiveTab("review")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
              activeTab === "review"
                ? "bg-iris text-white shadow-sm font-semibold"
                : "text-muted hover:text-fg hover:bg-raised"
            }`}
          >
            <Star size={14} />
            <span>Đánh giá</span>
          </button>
        </div>

        {/* Tab 1: Delivered Accounts / Resource Inspector */}
        {activeTab === "data" && (
          <div className="space-y-3 pt-1">
            {items.length > 0 ? (
              <>
                {/* Search & Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="relative flex-1 min-w-[240px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="text"
                      value={itemSearch}
                      onChange={(e) => {
                        setItemSearch(e.target.value);
                        setItemPage(1);
                      }}
                      placeholder={`Tìm kiếm trong ${items.length.toLocaleString()} tài khoản (email, uid, key)...`}
                      className="w-full rounded-xl border border-line bg-canvas pl-8.5 pr-3 py-2 text-[12.5px] text-fg placeholder:text-faint focus:border-iris focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyAll}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-iris px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-iris/90 transition-colors cursor-pointer"
                    >
                      {copiedKey === "all" ? <Check size={14} /> : <Copy size={14} />}
                      {copiedKey === "all" ? "Đã sao chép tất cả!" : `Sao chép tất cả (${items.length})`}
                    </button>

                    <button
                      onClick={handleDownload}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-[12px] font-semibold text-fg hover:bg-raised transition-colors cursor-pointer"
                    >
                      <Download size={14} /> Tải file .TXT
                    </button>
                  </div>
                </div>

                {/* Paginated Resource Table (Supports up to 10,000 lines without DOM lag) */}
                <div className="max-h-[380px] overflow-y-auto rounded-xl border border-line divide-y divide-line bg-canvas">
                  {paginatedItems.map((item, idx) => {
                    const globalIdx = (itemPage - 1) * itemsPerPage + idx + 1;
                    const isCopied = copiedKey === item.id;
                    const showRowIndex = !item.isConfigOrInstruction && !isServiceDelivery && items.length > 1;
                    return (
                      <div key={item.id} className="flex items-center justify-between p-2.5 hover:bg-raised/50 text-[12px] group">
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          {item.resourceId ? (
                            <span className="font-mono text-[10.5px] font-bold text-iris bg-iris-soft px-1.5 py-0.5 rounded shrink-0">
                              #{item.resourceId}
                            </span>
                          ) : showRowIndex ? (
                            <span className="font-mono text-[10.5px] text-faint w-12 shrink-0">
                              #{String(globalIdx).padStart(4, "0")}
                            </span>
                          ) : null}
                          <span className="font-mono font-medium text-fg break-all select-all">
                            {item.raw}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Dedicated Dispute Button for This Specific Item / Variant */}
                          {canDispute && (
                            <button
                              title="Khiếu nại riêng mục này"
                              onClick={() => {
                                onOpenDispute(o.id, {
                                  variantName: o.variant_name,
                                  initialReason: `[Mục #${globalIdx}] Khiếu nại tài khoản: ${item.raw}`,
                                  initialEvidence: { username: item.user || item.raw, issue: "Tài khoản bị lỗi / sai thông tin" },
                                });
                              }}
                              className="opacity-0 group-hover:opacity-100 rounded-lg px-2 py-1 text-[11px] text-bad hover:bg-bad-soft transition-opacity cursor-pointer flex items-center gap-1"
                            >
                              <AlertTriangle size={11} />
                              <span>Lỗi</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleCopySingle(item.id, item.raw)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                              isCopied
                                ? "bg-good text-white"
                                : "bg-surface border border-line text-iris hover:bg-iris hover:text-white"
                            }`}
                          >
                            {isCopied ? "Đã copy" : "Copy"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center justify-between text-[12px] text-muted pt-1">
                  <span>
                    Hiển thị <span className="font-semibold text-fg">{(itemPage - 1) * itemsPerPage + 1}</span> -{" "}
                    <span className="font-semibold text-fg">{Math.min(itemPage * itemsPerPage, filteredItems.length)}</span> /{" "}
                    <span className="font-bold text-iris">{filteredItems.length.toLocaleString()}</span> mục
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
                <p className="text-[13px]">{st.hint || "Chưa có dữ liệu bàn giao cho đơn hàng này."}</p>
              </div>
            )}

            {/* Service dashboard if dynamic */}
            {o.status !== "pending" && (
              <ServiceDashboard orderId={o.id} viewerRole="buyer" />
            )}
          </div>
        )}

        {/* Tab 2: Proxy Dashboard (OrderProxyPanel) */}
        {activeTab === "proxy" && mayHaveProxy && (
          <div className="pt-1">
            <OrderProxyPanel
              orderId={o.id}
              deliveredData={o.delivered_data}
              onPlate={onPlate}
              onDelivered={onDelivered}
            />
          </div>
        )}

        {/* Tab 3: Escrow, Confirmation & Dispute */}
        {activeTab === "escrow" && (
          <div className="space-y-4 pt-1">
            {/* Timeline */}
            {!["disputed", "refunded", "cancelled"].includes(o.status) && (
              <div className="rounded-xl bg-raised/60 border border-line/70 p-4">
                <div className="text-[12px] font-semibold text-fg mb-2">Tiến trình đơn hàng:</div>
                <StatusTimeline status={o.status} />
              </div>
            )}

            {/* Early Confirmation Release */}
            {o.status === "delivered" && (
              <div className="rounded-xl border border-iris/30 bg-iris-soft/25 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-fg text-[13.5px]">
                    Xác nhận nhận hàng & Giải phóng tiền
                  </div>
                  <ShieldCheck size={18} className="text-good" />
                </div>
                <p className="text-[12px] text-muted">
                  Nếu bạn đã kiểm tra sản phẩm và hài lòng, bạn có thể bấm xác nhận để hệ thống giải phóng tiền sớm cho người bán.
                </p>
                {askConfirm ? (
                  <div className="rounded-lg border border-warn/30 bg-warn-soft p-3 space-y-2 mt-2">
                    <p className="text-[12.5px] font-semibold text-fg">{t("confirmReleaseTitle", { amount: money.text })}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={() => onConfirm(o.id)} disabled={confirming}>
                        {confirming ? t("confirming") : t("confirmReleaseYes")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAskConfirm(false)}>
                        {tc("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setAskConfirm(true)}>
                    Xác nhận đã nhận hàng
                  </Button>
                )}
              </div>
            )}

            {/* Dispute information */}
            {o.has_dispute && (
              <div className="rounded-xl border border-bad/30 bg-bad-soft/20 p-4">
                <OrderDispute orderId={o.id} />
              </div>
            )}

            {!o.has_dispute && canDispute && (
              <div className="rounded-xl border border-line bg-surface p-4 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-fg">Gặp sự cố với đơn hàng?</div>
                  <div className="text-[11.5px] text-muted">
                    {o.variant_name
                      ? `Bạn có thể gửi yêu cầu khiếu nại cho gói "${o.variant_name}" để Admin hỗ trợ hoàn tiền hoặc đổi sản phẩm.`
                      : "Bạn có thể gửi yêu cầu khiếu nại để Admin hỗ trợ hoàn tiền hoặc đổi sản phẩm."}
                  </div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    onOpenDispute(o.id, {
                      variantName: o.variant_name,
                      initialReason: o.variant_name ? `[Khiếu nại gói: ${o.variant_name}] ` : "",
                      initialEvidence: { issue: "Gặp sự cố với gói sản phẩm này..." },
                    });
                  }}
                >
                  <AlertTriangle size={13} className="mr-1" />
                  Khiếu nại {o.variant_name ? `gói này` : `đơn hàng`}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Review & Chat */}
        {activeTab === "review" && (
          <div className="space-y-4 pt-1">
            <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fg text-[13.5px]">Đánh giá người bán</span>
                <Star size={16} className="text-amber-500 fill-amber-500" />
              </div>
              <ReviewForm
                orderId={o.id}
                onDone={(ok, msg) => {
                  onReviewDone(o.id, ok, msg);
                }}
                onCancel={() => setReviewOpen(false)}
              />
            </div>

            {!["cancelled", "refunded"].includes(o.status) && (
              <div className="rounded-xl border border-line bg-surface p-4 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-fg">Trò chuyện với người bán</div>
                  <div className="text-[11.5px] text-muted">Nhắn tin trực tiếp để trao đổi bảo hành hoặc hỗ trợ kỹ thuật.</div>
                </div>
                <OrderChatButton orderId={o.id} perspective="buyer" />
              </div>
            )}
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-line">
          {!["cancelled", "refunded"].includes(o.status) && (
            <OrderChatButton orderId={o.id} perspective="buyer" />
          )}

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="secondary" size="md" onClick={onClose}>
              {tc("close") || "Đóng"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
