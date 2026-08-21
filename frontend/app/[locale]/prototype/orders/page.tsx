"use client";

import React, { useState, useMemo } from "react";
import {
  Eye,
  Download,
  Copy,
  Check,
  MessageSquare,
  Search,
  Calendar,
  ShieldCheck,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";

// Generate 1,000 realistic mock accounts for the bulk order
const generate1000Accounts = () => {
  const list = [];
  for (let i = 1; i <= 1000; i++) {
    const pad = String(i).padStart(4, "0");
    list.push({
      id: i,
      raw: `mmo_vip_${pad}@outlook.com|PassX${pad}!89|2FA_KEY_${pad}ABCD|recovery${pad}@getmail.net`,
      email: `mmo_vip_${pad}@outlook.com`,
      password: `PassX${pad}!89`,
      twoFa: `2FA_KEY_${pad}ABCD`,
      recovery: `recovery${pad}@getmail.net`,
    });
  }
  return list;
};

const MOCK_1000_ITEMS = generate1000Accounts();

const MOCK_ORDERS = [
  {
    id: "ORD-88219",
    product: "Hotmail / Outlook Cổ 2018 - Live Trâu (IP US)",
    variant: "Gói: Full Info · IMAP On · 2FA Backup",
    avatar: "https://upload.wikimedia.org/wikipedia/commons/df/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg",
    quantity: 1000,
    amountVnd: "3.120.000 đ",
    amountUsd: "$120.00",
    status: "delivered",
    statusLabel: "Đã giao hàng",
    escrowTime: "Còn 47h 30m bảo hiểm",
    createdAt: "10 phút trước (21/08/2026 11:25)",
    items: MOCK_1000_ITEMS,
  },
  {
    id: "ORD-88102",
    product: "Proxy Dân Cư IPv6 Xoay Tĩnh 30 Ngày",
    variant: "Gói: HTTP/SOCKS5 · Băng thông 50GB",
    avatar: "🌐",
    quantity: 5,
    amountVnd: "650.000 đ",
    amountUsd: "$25.00",
    status: "delivered",
    statusLabel: "Đã giao hàng",
    escrowTime: "Còn 23h 15m bảo hiểm",
    createdAt: "2 giờ trước (21/08/2026 09:10)",
    items: [
      { id: 1, raw: "103.145.2.14:8080:user_01:pass_01", email: "103.145.2.14:8080", password: "user_01:pass_01" },
      { id: 2, raw: "103.145.2.15:8080:user_02:pass_02", email: "103.145.2.15:8080", password: "user_02:pass_02" },
      { id: 3, raw: "103.145.2.16:8080:user_03:pass_03", email: "103.145.2.16:8080", password: "user_03:pass_03" },
      { id: 4, raw: "103.145.2.17:8080:user_04:pass_04", email: "103.145.2.17:8080", password: "user_04:pass_04" },
      { id: 5, raw: "103.145.2.18:8080:user_05:pass_05", email: "103.145.2.18:8080", password: "user_05:pass_05" },
    ],
  },
  {
    id: "ORD-88050",
    product: "Tài khoản ChatGPT Plus 1 Tháng (Chính chủ)",
    variant: "Gói: Tài khoản riêng · Bảo hành 1 đổi 1",
    avatar: "🤖",
    quantity: 1,
    amountVnd: "480.000 đ",
    amountUsd: "$18.50",
    status: "disputed",
    statusLabel: "Đang khiếu nại",
    escrowTime: "Hệ thống đang tạm giữ tiền",
    createdAt: "Hôm qua (20/08/2026 16:40)",
    items: [{ id: 1, raw: "chatgpt_vip_user@gmail.com|OpenAI@2026!", email: "chatgpt_vip_user@gmail.com", password: "OpenAI@2026!" }],
  },
  {
    id: "ORD-87990",
    product: "Kênh TikTok US Beta 10k Follower - Bật Kiếm Tiền",
    variant: "Gói: Email gốc + Số điện thoại ảo",
    avatar: "🎵",
    quantity: 2,
    amountVnd: "1.170.000 đ",
    amountUsd: "$45.00",
    status: "completed",
    statusLabel: "Đã hoàn tất",
    escrowTime: "Hết hạn bảo hiểm",
    createdAt: "3 ngày trước (18/08/2026 14:15)",
    items: [
      { id: 1, raw: "tiktok_acc_10k_a|PassTk2026!|mail_goc_a@gmail.com", email: "tiktok_acc_10k_a", password: "PassTk2026!" },
      { id: 2, raw: "tiktok_acc_10k_b|PassTk2026!|mail_goc_b@gmail.com", email: "tiktok_acc_10k_b", password: "PassTk2026!" },
    ],
  },
];

export default function OrderRedesignPrototype() {
  const [activeTabOption, setActiveTabOption] = useState<"option1" | "option2" | "option3">("option1");
  const [selectedOrder, setSelectedOrder] = useState<typeof MOCK_ORDERS[0] | null>(MOCK_ORDERS[0]);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const [copyFormat, setCopyFormat] = useState<"raw" | "userpass" | "email">("raw");
  const [itemSearch, setItemSearch] = useState("");
  const [itemPage, setItemPage] = useState(1);
  const [activeStatusTab, setActiveStatusTab] = useState("all");
  const itemsPerPage = 20;

  const currentItems = selectedOrder?.items || [];
  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return currentItems;
    const q = itemSearch.toLowerCase();
    return currentItems.filter((it) => it.raw.toLowerCase().includes(q));
  }, [currentItems, itemSearch]);

  const paginatedItems = useMemo(() => {
    const start = (itemPage - 1) * itemsPerPage;
    return filteredItems.slice(start, start + itemsPerPage);
  }, [filteredItems, itemPage]);

  const totalItemPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));

  const handleCopy = (id: string | number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAll = () => {
    let exportText = "";
    if (copyFormat === "userpass") {
      exportText = currentItems.map((it) => `${it.email}|${it.password}`).join("\n");
    } else if (copyFormat === "email") {
      exportText = currentItems.map((it) => it.email).join("\n");
    } else {
      exportText = currentItems.map((it) => it.raw).join("\n");
    }
    navigator.clipboard.writeText(exportText);
    setCopiedId("all");
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleDownload = () => {
    const text = currentItems.map((it) => it.raw).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DonHang_${selectedOrder?.id}_${currentItems.length}_tai_khoan.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-canvas text-fg pb-20 font-sans">
      {/* Top Prototype Option Switcher */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md px-6 py-3.5 shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-iris text-white font-bold text-sm shadow-sm">
              <Sparkles size={16} />
            </span>
            <div>
              <h1 className="text-[15px] font-bold text-fg leading-tight">Redesign Prototype: Lịch sử đơn hàng</h1>
              <p className="text-[11.5px] text-muted">Xử lý tối ưu đơn 1.000 số lượng · Công nghệ TanStack Table từ Admin/Products</p>
            </div>
          </div>

          {/* Option Selector Pills */}
          <div className="flex items-center gap-1.5 rounded-xl border border-line bg-raised/70 p-1">
            <button
              onClick={() => {
                setActiveTabOption("option1");
                setModalOpen(false);
                setDrawerOpen(false);
              }}
              className={`rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-all ${
                activeTabOption === "option1"
                  ? "bg-iris text-white shadow-sm"
                  : "text-muted hover:text-fg hover:bg-surface"
              }`}
            >
              Option 1: Bảng + Quick-View Modal (Khuyên dùng)
            </button>
            <button
              onClick={() => {
                setActiveTabOption("option2");
                setModalOpen(false);
                setDrawerOpen(false);
              }}
              className={`rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-all ${
                activeTabOption === "option2"
                  ? "bg-iris text-white shadow-sm"
                  : "text-muted hover:text-fg hover:bg-surface"
              }`}
            >
              Option 2: Split-Pane Master-Detail
            </button>
            <button
              onClick={() => {
                setActiveTabOption("option3");
                setModalOpen(false);
                setDrawerOpen(false);
              }}
              className={`rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-all ${
                activeTabOption === "option3"
                  ? "bg-iris text-white shadow-sm"
                  : "text-muted hover:text-fg hover:bg-surface"
              }`}
            >
              Option 3: Bảng + Slide-over Drawer
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pt-6 space-y-6">
        {/* TOP KPI STATS SUMMARY (Kế thừa từ admin/products) */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-iris-soft text-iris font-semibold text-xl">
              📦
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Tổng đơn đã mua</div>
              <div className="font-mono text-[22px] font-bold text-fg">28 <span className="text-[12px] font-normal text-muted">đơn</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-good-soft text-good font-semibold text-xl">
              ✓
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Đang hoạt động / Bảo hiểm</div>
              <div className="font-mono text-[22px] font-bold text-good">26 <span className="text-[12px] font-normal text-muted">đơn</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bad-soft text-bad font-semibold text-xl">
              ⚠️
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Đang khiếu nại</div>
              <div className="font-mono text-[22px] font-bold text-bad">1 <span className="text-[12px] font-normal text-muted">đơn</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-raised text-iris font-semibold text-xl">
              💳
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Tổng tiền đã chi</div>
              <div className="font-mono text-[22px] font-bold text-fg">$1,420.50</div>
            </div>
          </div>
        </div>

        {/* STATUS TABS & FILTER BAR */}
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: "all", label: "Tất cả", count: 28 },
                { id: "active", label: "Hoạt động (Còn bảo hiểm)", count: 26 },
                { id: "disputed", label: "Khiếu nại", count: 1 },
                { id: "completed", label: "Đã hoàn tất", count: 25 },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveStatusTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
                    activeStatusTab === tab.id
                      ? "bg-iris text-white shadow-sm font-semibold"
                      : "text-muted hover:text-fg hover:bg-raised/60"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10.5px] font-mono ${
                      activeStatusTab === tab.id ? "bg-white/25 text-white" : "bg-raised text-muted"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="text-[12px] text-muted">
              Hiển thị <span className="font-semibold text-fg">4</span> / 28 đơn hàng
            </div>
          </div>

          {/* SEARCH & FILTER CONTROLS */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <div className="relative lg:col-span-5">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Tìm theo mã đơn (#ORD-...), tên sản phẩm, gói..."
                className="w-full rounded-xl border border-line bg-canvas pl-9 pr-3.5 py-2 text-[13px] text-fg placeholder:text-faint focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/20"
              />
            </div>

            <div className="relative lg:col-span-4">
              <Calendar size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Từ ngày - Đến ngày"
                className="w-full rounded-xl border border-line bg-canvas pl-9 pr-3.5 py-2 text-[13px] text-fg placeholder:text-faint focus:border-iris focus:outline-none"
              />
            </div>

            <div className="flex gap-2 lg:col-span-3">
              <select className="flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-[12.5px] text-fg focus:border-iris focus:outline-none">
                <option>Mới nhất trước</option>
                <option>Cũ nhất trước</option>
                <option>Giá cao nhất</option>
                <option>Số lượng nhiều nhất</option>
              </select>
              <button className="rounded-xl border border-line bg-raised px-3.5 py-2 text-[12.5px] font-semibold text-fg hover:bg-line transition-colors">
                Lọc
              </button>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* VIEW 1: OPTION 1 & OPTION 3 MAIN DATA TABLE */}
        {/* ------------------------------------------------------------- */}
        {activeTabOption !== "option2" && (
          <div className="rounded-2xl border border-line bg-surface shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-raised/70 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-3.5 pl-4 pr-2 w-10">
                      <input type="checkbox" className="rounded border-line" />
                    </th>
                    <th className="py-3.5 px-3 w-40">Thao tác nhanh</th>
                    <th className="py-3.5 px-3 w-36">Mã đơn & Thời gian</th>
                    <th className="py-3.5 px-3">Sản phẩm & Gói</th>
                    <th className="py-3.5 px-3 text-center w-24">Số lượng</th>
                    <th className="py-3.5 px-3 text-right w-36">Thanh toán</th>
                    <th className="py-3.5 px-4 text-right w-44">Trạng thái & Bảo hiểm</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {MOCK_ORDERS.map((ord) => (
                    <tr
                      key={ord.id}
                      className="hover:bg-iris-soft/15 transition-colors group cursor-pointer"
                      onClick={() => {
                        setSelectedOrder(ord);
                        if (activeTabOption === "option3") setDrawerOpen(true);
                      }}
                    >
                      <td className="py-4 pl-4 pr-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="rounded border-line" />
                      </td>

                      {/* QUICK ACTION ICONS */}
                      <td className="py-4 px-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button
                            title="Xem nhanh tài khoản"
                            onClick={() => {
                              setSelectedOrder(ord);
                              if (activeTabOption === "option1") setModalOpen(true);
                              if (activeTabOption === "option3") setDrawerOpen(true);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-iris-soft text-iris hover:bg-iris hover:text-white transition-colors cursor-pointer"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            title="Tải về file .txt"
                            onClick={() => {
                              setSelectedOrder(ord);
                              handleDownload();
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-muted hover:bg-line hover:text-fg transition-colors cursor-pointer"
                          >
                            <Download size={14} />
                          </button>
                          <button
                            title="Sao chép toàn bộ dữ liệu"
                            onClick={() => {
                              setSelectedOrder(ord);
                              handleCopyAll();
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-muted hover:bg-line hover:text-fg transition-colors cursor-pointer"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            title="Nhắn tin với người bán"
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-muted hover:bg-line hover:text-fg transition-colors cursor-pointer"
                          >
                            <MessageSquare size={14} />
                          </button>
                        </div>
                      </td>

                      {/* ORDER ID & DATE */}
                      <td className="py-4 px-3">
                        <div className="font-mono font-bold text-iris text-[13.5px]">#{ord.id}</div>
                        <div className="text-[11.5px] text-muted mt-0.5">{ord.createdAt}</div>
                      </td>

                      {/* PRODUCT & VARIANT */}
                      <td className="py-4 px-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-raised text-lg border border-line">
                            {typeof ord.avatar === "string" && ord.avatar.startsWith("http") ? (
                              <img src={ord.avatar} alt="" className="h-6 w-6 object-contain" />
                            ) : (
                              ord.avatar
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-fg group-hover:text-iris transition-colors truncate">
                              {ord.product}
                            </div>
                            <div className="text-[11.5px] text-muted truncate mt-0.5">
                              {ord.variant}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* QUANTITY */}
                      <td className="py-4 px-3 text-center">
                        <span className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 font-mono text-[12px] font-bold ${
                          ord.quantity >= 1000
                            ? "bg-iris-soft text-iris border border-iris/30"
                            : "bg-raised text-fg"
                        }`}>
                          x{ord.quantity.toLocaleString()}
                        </span>
                      </td>

                      {/* AMOUNT */}
                      <td className="py-4 px-3 text-right">
                        <div className="font-mono font-bold text-[14px] text-fg tabular">
                          {ord.amountUsd}
                        </div>
                        <div className="text-[11px] text-muted tabular">{ord.amountVnd}</div>
                      </td>

                      {/* STATUS & ESCROW */}
                      <td className="py-4 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                              ord.status === "delivered"
                                ? "bg-good-soft text-good"
                                : ord.status === "disputed"
                                ? "bg-bad-soft text-bad"
                                : "bg-raised text-muted"
                            }`}
                          >
                            {ord.statusLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-iris-hi flex items-center justify-end gap-1 mt-1 font-medium">
                          <ShieldCheck size={12} className="text-good" />
                          <span>{ord.escrowTime}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* VIEW 2: OPTION 2 - SPLIT-PANE MASTER-DETAIL */}
        {/* ------------------------------------------------------------- */}
        {activeTabOption === "option2" && selectedOrder && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Column (40%): Order Master List */}
            <div className="lg:col-span-5 space-y-3">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-muted px-1">
                Danh sách đơn hàng (Chọn để xem tài khoản)
              </div>
              <div className="space-y-2.5">
                {MOCK_ORDERS.map((ord) => {
                  const isSelected = selectedOrder?.id === ord.id;
                  return (
                    <div
                      key={ord.id}
                      onClick={() => setSelectedOrder(ord)}
                      className={`rounded-2xl border p-4 transition-all cursor-pointer ${
                        isSelected
                          ? "border-iris bg-iris-soft/20 shadow-md ring-1 ring-iris"
                          : "border-line bg-surface hover:border-iris/40 hover:bg-raised/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-iris text-[13px]">#{ord.id}</span>
                        <span className="text-[11px] text-muted">{ord.createdAt}</span>
                      </div>
                      <div className="font-semibold text-fg text-[13.5px] mt-1.5 line-clamp-1">
                        {ord.product}
                      </div>
                      <div className="flex items-center justify-between pt-2 mt-2 border-t border-line/60">
                        <span className="font-mono text-[12px] font-bold text-iris">
                          SL: x{ord.quantity.toLocaleString()}
                        </span>
                        <span className="font-mono font-bold text-fg text-[13.5px]">
                          {ord.amountUsd}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column (60%): Live 1000-Item Resource Inspector */}
            <div className="lg:col-span-7">
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4 sticky top-20">
                {/* Header info */}
                <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-iris text-[15px]">#{selectedOrder.id}</span>
                      <span className="rounded-md bg-good-soft px-2 py-0.5 text-[11px] font-semibold text-good">
                        {selectedOrder.statusLabel}
                      </span>
                    </div>
                    <h3 className="text-[15px] font-bold text-fg mt-1">{selectedOrder.product}</h3>
                    <p className="text-[12px] text-muted">{selectedOrder.variant}</p>
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-[18px] font-bold text-fg">{selectedOrder.amountUsd}</div>
                    <div className="text-[11px] text-good flex items-center justify-end gap-1 mt-0.5">
                      <ShieldCheck size={12} /> {selectedOrder.escrowTime}
                    </div>
                  </div>
                </div>

                {/* Bulk Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyAll}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-iris px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-iris/90 transition-colors cursor-pointer"
                    >
                      {copiedId === "all" ? <Check size={14} /> : <Copy size={14} />}
                      {copiedId === "all" ? "Đã sao chép 1,000 mục!" : `Sao chép tất cả (${selectedOrder.quantity})`}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-[12px] font-semibold text-fg hover:bg-raised transition-colors cursor-pointer"
                    >
                      <Download size={14} /> Tải file .TXT
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    <span>Định dạng:</span>
                    <select
                      value={copyFormat}
                      onChange={(e: any) => setCopyFormat(e.target.value)}
                      className="rounded-lg border border-line bg-canvas px-2 py-1 text-[11.5px] text-fg"
                    >
                      <option value="raw">Đầy đủ (Gốc)</option>
                      <option value="userpass">Chỉ User|Pass</option>
                      <option value="email">Chỉ Email</option>
                    </select>
                  </div>
                </div>

                {/* Search within 1000 items */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    value={itemSearch}
                    onChange={(e) => {
                      setItemSearch(e.target.value);
                      setItemPage(1);
                    }}
                    placeholder={`Tìm kiếm trong ${selectedOrder.quantity.toLocaleString()} tài khoản (email, uid, key)...`}
                    className="w-full rounded-xl border border-line bg-canvas pl-8.5 pr-3 py-2 text-[12.5px] text-fg placeholder:text-faint focus:border-iris focus:outline-none"
                  />
                </div>

                {/* Paginated Resource Table (Scales to 1000+ items smoothly) */}
                <div className="max-h-[380px] overflow-y-auto rounded-xl border border-line divide-y divide-line bg-canvas">
                  {paginatedItems.map((item, idx) => {
                    const globalIdx = (itemPage - 1) * itemsPerPage + idx + 1;
                    const isCopied = copiedId === item.id;
                    return (
                      <div key={item.id} className="flex items-center justify-between p-2.5 hover:bg-raised/50 text-[12px]">
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="font-mono text-[10.5px] text-faint w-11 shrink-0">
                            #{String(globalIdx).padStart(4, "0")}
                          </span>
                          <span className="font-mono font-medium text-fg break-all select-all">
                            {item.raw}
                          </span>
                        </div>
                        <button
                          onClick={() => handleCopy(item.id, item.raw)}
                          className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                            isCopied
                              ? "bg-good text-white"
                              : "bg-surface border border-line text-iris hover:bg-iris hover:text-white"
                          }`}
                        >
                          {isCopied ? "Đã copy" : "Copy"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination footer */}
                <div className="flex items-center justify-between text-[12px] text-muted pt-1">
                  <span>
                    Hiển thị <span className="font-semibold text-fg">{(itemPage - 1) * itemsPerPage + 1}</span> -{" "}
                    <span className="font-semibold text-fg">{Math.min(itemPage * itemsPerPage, filteredItems.length)}</span> /{" "}
                    <span className="font-bold text-iris">{filteredItems.length.toLocaleString()}</span> tài khoản
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
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------- */}
      {/* OPTION 1: QUICK-VIEW MODAL (BẬT LÊN KHI CLICK [👁] TRÊN BẢNG) */}
      {/* ------------------------------------------------------------- */}
      {modalOpen && selectedOrder && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in-0 duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className="relative w-full max-w-3xl rounded-2xl border border-line bg-surface p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-iris-soft text-iris font-bold">
                  👁️
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[16px] font-bold text-fg">Xem dữ liệu đơn hàng #{selectedOrder.id}</h3>
                    <span className="rounded-md bg-good-soft px-2 py-0.5 text-[11px] font-semibold text-good">
                      {selectedOrder.statusLabel}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted mt-0.5">{selectedOrder.product} · {selectedOrder.variant}</p>
                </div>
              </div>

              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-fg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-line bg-raised/40 p-3 text-center">
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">Số lượng bàn giao</div>
                <div className="font-mono text-[16px] font-bold text-iris mt-0.5">
                  {selectedOrder.quantity.toLocaleString()} tài khoản
                </div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">Tổng tiền</div>
                <div className="font-mono text-[16px] font-bold text-fg mt-0.5">
                  {selectedOrder.amountUsd}
                </div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium">Bảo hiểm Escrow</div>
                <div className="text-[12.5px] font-semibold text-good mt-0.5">
                  {selectedOrder.escrowTime}
                </div>
              </div>
            </div>

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
                  placeholder={`Tìm kiếm trong ${selectedOrder.quantity.toLocaleString()} tài khoản...`}
                  className="w-full rounded-xl border border-line bg-canvas pl-8.5 pr-3 py-2 text-[12.5px] text-fg placeholder:text-faint focus:border-iris focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyAll}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-iris px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-iris/90 transition-colors"
                >
                  {copiedId === "all" ? <Check size={14} /> : <Copy size={14} />}
                  {copiedId === "all" ? "Đã sao chép 1,000 mục!" : "Sao chép tất cả (1,000)"}
                </button>

                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-[12px] font-semibold text-fg hover:bg-raised transition-colors"
                >
                  <Download size={14} /> Tải file .TXT
                </button>
              </div>
            </div>

            {/* Paginated Resource Table (Scales to 1000 items) */}
            <div className="max-h-[340px] overflow-y-auto rounded-xl border border-line divide-y divide-line bg-canvas">
              {paginatedItems.map((item, idx) => {
                const globalIdx = (itemPage - 1) * itemsPerPage + idx + 1;
                const isCopied = copiedId === item.id;
                return (
                  <div key={item.id} className="flex items-center justify-between p-2.5 hover:bg-raised/50 text-[12px]">
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <span className="font-mono text-[10.5px] text-faint w-12 shrink-0">
                        #{String(globalIdx).padStart(4, "0")}
                      </span>
                      <span className="font-mono font-medium text-fg break-all select-all">
                        {item.raw}
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopy(item.id, item.raw)}
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        isCopied
                          ? "bg-good text-white"
                          : "bg-surface border border-line text-iris hover:bg-iris hover:text-white"
                      }`}
                    >
                      {isCopied ? "Đã copy" : "Copy"}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between text-[12px] text-muted pt-1 border-t border-line">
              <span>
                Hiển thị <span className="font-semibold text-fg">{(itemPage - 1) * itemsPerPage + 1}</span> -{" "}
                <span className="font-semibold text-fg">{Math.min(itemPage * itemsPerPage, filteredItems.length)}</span> /{" "}
                <span className="font-bold text-iris">{filteredItems.length.toLocaleString()}</span> tài khoản
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
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* OPTION 3: SLIDE-OVER DRAWER (TRƯỢT TỪ MÉP PHẢI) */}
      {/* ------------------------------------------------------------- */}
      {drawerOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-200">
          <div className="h-full w-full max-w-md border-l border-line bg-surface p-6 shadow-2xl space-y-4 animate-in slide-in-from-right duration-200 overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <span className="font-mono font-bold text-iris text-[14px]">#{selectedOrder.id}</span>
                <h3 className="text-[15px] font-bold text-fg">{selectedOrder.product}</h3>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-muted hover:bg-raised"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted">Số lượng:</span>
                <span className="font-mono font-bold text-iris">x{selectedOrder.quantity.toLocaleString()} tài khoản</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted">Tổng tiền:</span>
                <span className="font-mono font-bold text-fg">{selectedOrder.amountUsd}</span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleCopyAll}
                  className="flex-1 rounded-xl bg-iris py-2 text-[12px] font-semibold text-white text-center shadow-sm"
                >
                  Copy tất cả
                </button>
                <button
                  onClick={handleDownload}
                  className="flex-1 rounded-xl border border-line bg-surface py-2 text-[12px] font-semibold text-fg text-center hover:bg-raised"
                >
                  Tải .TXT
                </button>
              </div>

              {/* 1000 items in Drawer */}
              <div className="max-h-[420px] overflow-y-auto rounded-xl border border-line divide-y divide-line bg-canvas">
                {paginatedItems.map((item, idx) => (
                  <div key={item.id} className="p-2 text-[11.5px] font-mono break-all flex items-center justify-between">
                    <span className="select-all">{item.raw}</span>
                    <button
                      onClick={() => handleCopy(item.id, item.raw)}
                      className="shrink-0 ml-2 text-iris hover:underline"
                    >
                      {copiedId === item.id ? "✓" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
