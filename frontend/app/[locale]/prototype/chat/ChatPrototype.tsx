"use client";

// PROTOTYPE — throwaway UI only. No API calls, persistence, or production mutations.

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Headphones,
  Inbox,
  LifeBuoy,
  MessageCircle,
  MoreHorizontal,
  Package,
  Paperclip,
  Search,
  Send,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export type PrototypeVariant = "A" | "B" | "C";
export type PrototypeRole = "buyer" | "seller" | "admin";
export type PrototypeFlow = "order" | "support" | "dispute";

type MobilePane = "list" | "thread";
type MessageAuthor = "me" | "other" | "admin" | "system";

type Message = {
  id: string;
  author: MessageAuthor;
  sender?: string;
  body: string;
  time?: string;
  pending?: boolean;
};

type Conversation = {
  id: PrototypeFlow;
  title: string;
  subtitle: string;
  preview: string;
  time: string;
  unread: number;
  tone: "iris" | "warn" | "bad";
};

const VARIANTS: Array<{ id: PrototypeVariant; name: string }> = [
  { id: "A", name: "Inbox Workbench" },
  { id: "B", name: "Focus Mode" },
  { id: "C", name: "Embedded Context" },
];

const FLOW_STEPS: Record<PrototypeFlow, string[]> = {
  order: ["Đơn đã tạo", "Mở chat", "Trao đổi", "Hoàn tất"],
  support: ["Mở yêu cầu", "Vào hàng đợi", "Admin nhận", "Giải quyết"],
  dispute: ["Báo tranh chấp", "Khóa context", "Admin tham gia", "Kết luận"],
};

const FLOW_META: Record<PrototypeFlow, { label: string; description: string; icon: typeof MessageCircle }> = {
  order: {
    label: "Order chat",
    description: "Buyer ↔ seller, chỉ sau khi có order",
    icon: ShoppingBag,
  },
  support: {
    label: "Private support",
    description: "Buyer/seller ↔ admin, bên còn lại không thấy",
    icon: LifeBuoy,
  },
  dispute: {
    label: "Dispute escalation",
    description: "Admin vào cùng transcript của order",
    icon: ShieldAlert,
  },
};

const BASE_MESSAGES: Record<PrototypeFlow, Message[]> = {
  order: [
    {
      id: "o-1",
      author: "system",
      body: "Room được tạo từ đơn #PX-2418 · chỉ buyer và seller của đơn này có quyền truy cập.",
    },
    {
      id: "o-2",
      author: "other",
      sender: "Orbit Store",
      body: "Chào bạn, đơn đã được xác nhận. Mình đang chuẩn bị thông tin bàn giao.",
      time: "10:24",
    },
    {
      id: "o-3",
      author: "me",
      body: "Ok, cho mình biết khi nào dữ liệu sẵn sàng nhé.",
      time: "10:26",
    },
    {
      id: "o-4",
      author: "other",
      sender: "Orbit Store",
      body: "Khoảng 5 phút nữa. Mọi thông tin nhạy cảm vẫn đi qua luồng bàn giao bảo mật của đơn.",
      time: "10:28",
    },
  ],
  support: [
    {
      id: "s-1",
      author: "me",
      body: "Mình cần hỗ trợ kiểm tra trạng thái thanh toán của đơn #PX-2389.",
      time: "09:41",
    },
    {
      id: "s-2",
      author: "system",
      body: "Yêu cầu #SUP-184 đã vào hàng đợi Billing · chỉ bạn và đội hỗ trợ có thể xem.",
    },
    {
      id: "s-3",
      author: "admin",
      sender: "Minh · Support",
      body: "Mình đã nhận case. Thanh toán đã được ghi nhận, mình đang đối soát bước cập nhật order.",
      time: "09:46",
    },
  ],
  dispute: [
    {
      id: "d-1",
      author: "other",
      sender: "Orbit Store",
      body: "Mình đã gửi đúng gói tài nguyên theo mô tả ban đầu.",
      time: "14:08",
    },
    {
      id: "d-2",
      author: "me",
      body: "Một phần dữ liệu không hoạt động, mình đã đính kèm bằng chứng trong dispute.",
      time: "14:11",
    },
    {
      id: "d-3",
      author: "system",
      body: "Dispute #DP-024 được mở. Lịch sử order chat được giữ nguyên và admin đã được thêm vào room.",
    },
    {
      id: "d-4",
      author: "admin",
      sender: "An · Resolution",
      body: "Mình đã xem toàn bộ lịch sử. Hai bên vui lòng không gửi credential trực tiếp trong chat.",
      time: "14:16",
    },
  ],
};

function conversationsFor(role: PrototypeRole): Conversation[] {
  const counterpart = role === "seller" ? "Buyer #8421" : role === "admin" ? "Buyer #8421 · Orbit Store" : "Orbit Store";
  return [
    {
      id: "order",
      title: counterpart,
      subtitle: "Đơn #PX-2418 · Social bundle",
      preview: "Khoảng 5 phút nữa. Mọi thông tin…",
      time: "10:28",
      unread: role === "seller" ? 1 : 0,
      tone: "iris",
    },
    {
      id: "support",
      title: role === "admin" ? "Buyer #8421" : "GMMO Support",
      subtitle: "Support #SUP-184 · Billing",
      preview: role === "admin" ? "Mình cần hỗ trợ kiểm tra trạng thái…" : "Mình đã nhận case. Thanh toán đã…",
      time: "09:46",
      unread: role === "admin" ? 3 : 1,
      tone: "warn",
    },
    {
      id: "dispute",
      title: role === "admin" ? "Buyer #8421 · Orbit Store" : "Dispute Resolution",
      subtitle: "Tranh chấp #DP-024 · Đơn #PX-2397",
      preview: "Mình đã xem toàn bộ lịch sử…",
      time: "Hôm qua",
      unread: role === "admin" ? 4 : 0,
      tone: "bad",
    },
  ];
}

function roleLabel(role: PrototypeRole) {
  if (role === "buyer") return "Buyer";
  if (role === "seller") return "Seller";
  return "Admin";
}

function flowBadgeClass(flow: PrototypeFlow) {
  if (flow === "support") return "border-warn/25 bg-warn-soft text-warn";
  if (flow === "dispute") return "border-bad/25 bg-bad-soft text-bad";
  return "border-iris/25 bg-iris-soft text-iris-hi";
}

function ReviewControls({
  role,
  flow,
  step,
  onRole,
  onFlow,
  onStep,
}: {
  role: PrototypeRole;
  flow: PrototypeFlow;
  step: number;
  onRole: (role: PrototypeRole) => void;
  onFlow: (flow: PrototypeFlow) => void;
  onStep: (step: number) => void;
}) {
  const steps = FLOW_STEPS[flow];
  return (
    <section className="border-b border-line bg-surface">
      <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="min-w-[220px]">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-warn">
                Prototype
              </span>
              <span className="text-[11px] text-faint">Mock data · không gọi API</span>
            </div>
            <h1 className="mt-1 font-serif text-[22px] font-semibold tracking-tight">Chat workspace skeleton</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Góc nhìn</span>
            {(["buyer", "seller", "admin"] as PrototypeRole[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onRole(item)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors",
                  role === item ? "border-iris bg-iris text-white" : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
                )}
              >
                {roleLabel(item)}
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:justify-end">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Luồng</span>
            {(Object.keys(FLOW_META) as PrototypeFlow[]).map((item) => {
              const Icon = FLOW_META[item].icon;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onFlow(item)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors",
                    flow === item ? flowBadgeClass(item) : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
                  )}
                >
                  <Icon size={14} />
                  {FLOW_META[item].label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
          {steps.map((item, index) => (
            <button
              key={item}
              type="button"
              onClick={() => onStep(index)}
              className="group flex shrink-0 items-center gap-2"
              aria-current={step === index ? "step" : undefined}
            >
              <span
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full border font-mono text-[10px] font-bold transition-colors",
                  index < step && "border-good bg-good text-white",
                  index === step && "border-iris bg-iris text-white",
                  index > step && "border-line-2 bg-raised text-faint",
                )}
              >
                {index < step ? <Check size={12} /> : index + 1}
              </span>
              <span className={cn("text-[11.5px] font-medium", index === step ? "text-fg" : "text-faint")}>{item}</span>
              {index < steps.length - 1 && <ArrowRight size={13} className="mx-1 text-line-2" />}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onStep(Math.min(step + 1, steps.length - 1))}
            disabled={step === steps.length - 1}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-ink-panel px-3 py-2 text-[11.5px] font-semibold text-white disabled:opacity-35"
          >
            State tiếp theo <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

function Avatar({ flow, compact = false }: { flow: PrototypeFlow; compact?: boolean }) {
  const Icon = FLOW_META[flow].icon;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-xl border",
        flowBadgeClass(flow),
        compact ? "h-9 w-9" : "h-11 w-11",
      )}
    >
      <Icon size={compact ? 16 : 18} />
    </span>
  );
}

function ConversationList({
  role,
  flow,
  onSelect,
  className,
}: {
  role: PrototypeRole;
  flow: PrototypeFlow;
  onSelect: (flow: PrototypeFlow) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const items = useMemo(
    () => conversationsFor(role).filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase())),
    [query, role],
  );

  return (
    <aside className={cn("min-w-0 bg-surface", className)}>
      <div className="border-b border-line p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-iris-hi">{roleLabel(role)} inbox</div>
            <div className="mt-0.5 font-serif text-[20px] font-semibold">Tin nhắn</div>
          </div>
          <button type="button" aria-label="Tạo support case" className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-raised text-muted hover:text-fg">
            <LifeBuoy size={16} />
          </button>
        </div>
        <label className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-line bg-base px-3 text-muted focus-within:border-iris/50">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Order ID, subject, product…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-faint"
          />
        </label>
        <div className="mt-3 flex gap-1.5 overflow-x-auto">
          {['Tất cả', 'Đơn hàng', 'Hỗ trợ', 'Tranh chấp'].map((label, index) => (
            <span key={label} className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold", index === 0 ? "bg-ink-panel text-white" : "bg-raised text-faint")}>{label}</span>
          ))}
        </div>
      </div>

      <div className="p-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "mb-1 flex w-full gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
              flow === item.id ? "border-iris/20 bg-iris-soft" : "border-transparent hover:border-line hover:bg-raised/65",
            )}
          >
            <Avatar flow={item.id} compact />
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{item.title}</span>
                <span className="shrink-0 font-mono text-[9.5px] text-faint">{item.time}</span>
              </span>
              <span className="mt-0.5 block truncate font-mono text-[9.5px] uppercase text-faint">{item.subtitle}</span>
              <span className="mt-1 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{item.preview}</span>
                {item.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-iris px-1 text-[9px] font-bold text-white">{item.unread}</span>}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ThreadHeader({ role, flow, onBack }: { role: PrototypeRole; flow: PrototypeFlow; onBack: () => void }) {
  const conversation = conversationsFor(role).find((item) => item.id === flow)!;
  return (
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-5">
      <button type="button" onClick={onBack} aria-label="Quay lại inbox" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted md:hidden">
        <ArrowLeft size={16} />
      </button>
      <Avatar flow={flow} compact />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[13.5px] font-semibold">{conversation.title}</h2>
          <span className={cn("hidden rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide sm:inline", flowBadgeClass(flow))}>
            {FLOW_META[flow].label}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[10px] text-faint">{conversation.subtitle}</p>
      </div>
      <button type="button" aria-label="Tùy chọn hội thoại" className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-muted hover:text-fg">
        <MoreHorizontal size={17} />
      </button>
    </header>
  );
}

function visibleMessages(flow: PrototypeFlow, step: number) {
  const messages = BASE_MESSAGES[flow];
  if (flow === "support") return step < 2 ? messages.slice(0, 2) : messages;
  if (flow === "dispute") return step < 2 ? messages.slice(0, 2) : step === 2 ? messages.slice(0, 3) : messages;
  return step < 1 ? messages.slice(0, 1) : step === 1 ? messages.slice(0, 2) : messages;
}

function MessageThread({
  role,
  flow,
  step,
  sentMessages,
  composer,
  onComposer,
  onSend,
  onBack,
  className,
}: {
  role: PrototypeRole;
  flow: PrototypeFlow;
  step: number;
  sentMessages: Message[];
  composer: string;
  onComposer: (value: string) => void;
  onSend: () => void;
  onBack: () => void;
  className?: string;
}) {
  const messages = [...visibleMessages(flow, step), ...sentMessages];
  return (
    <section className={cn("min-h-0 min-w-0 flex-col bg-base", className)}>
      <ThreadHeader role={role} flow={flow} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          <div className="mb-2 text-center">
            <span className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[9.5px] uppercase text-faint">Hôm nay</span>
          </div>
          {messages.map((message) => {
            if (message.author === "system") {
              return (
                <div key={message.id} className="my-1 flex justify-center">
                  <p className="max-w-[560px] rounded-lg border border-line bg-raised/70 px-3 py-2 text-center text-[10.5px] leading-relaxed text-faint">
                    {message.body}
                  </p>
                </div>
              );
            }
            const mine = message.author === "me";
            const admin = message.author === "admin";
            return (
              <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[78%]", mine && "text-right")}>
                  {!mine && <div className={cn("mb-1 text-[10px] font-semibold", admin ? "text-warn" : "text-faint")}>{message.sender}</div>}
                  <div
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-left text-[12.5px] leading-relaxed shadow-[0_1px_2px_rgba(16,18,28,0.05)]",
                      mine ? "rounded-br-[5px] bg-iris text-white" : admin ? "rounded-bl-[5px] border border-warn/20 bg-warn-soft text-fg" : "rounded-bl-[5px] border border-line bg-surface text-fg",
                      message.pending && "opacity-65",
                    )}
                  >
                    {message.body}
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-1 font-mono text-[9px] text-faint">
                    {message.time ?? "vừa xong"} {message.pending ? <Clock3 size={9} /> : mine ? <Check size={9} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-surface p-3 sm:p-4">
        <div className="mx-auto flex max-w-[760px] items-end gap-2 rounded-xl border border-line-2 bg-base p-2 focus-within:border-iris/55">
          <button type="button" aria-label="Đính kèm" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg">
            <Paperclip size={16} />
          </button>
          <textarea
            value={composer}
            onChange={(event) => onComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder={step === 3 && flow !== "order" ? "Case đã đóng — prototype read-only" : "Nhập tin nhắn…"}
            disabled={step === 3 && flow !== "order"}
            className="max-h-28 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[12.5px] leading-5 text-fg outline-none placeholder:text-faint disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!composer.trim() || (step === 3 && flow !== "order")}
            className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-iris px-3.5 text-[12px] font-semibold text-white disabled:opacity-35"
          >
            <Send size={14} /> <span className="hidden sm:inline">Gửi</span>
          </button>
        </div>
        <p className="mt-1.5 text-center text-[9.5px] text-faint">Enter để gửi · Shift + Enter để xuống dòng · Không gửi credential trong chat</p>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-base px-3 py-2.5">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className={cn("mt-1 text-[12px] font-semibold", tone === "good" && "text-good", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</div>
    </div>
  );
}

function ContextPanel({ role, flow, step, onAdvance, className }: { role: PrototypeRole; flow: PrototypeFlow; step: number; onAdvance: () => void; className?: string }) {
  const meta = FLOW_META[flow];
  const Icon = meta.icon;
  const isAdmin = role === "admin";
  return (
    <aside className={cn("min-w-0 overflow-y-auto bg-surface p-4", className)}>
      <div className="flex items-start gap-3 border-b border-line pb-4">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border", flowBadgeClass(flow))}><Icon size={17} /></span>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Context</div>
          <div className="mt-0.5 text-[13px] font-semibold">{flow === "support" ? "Support #SUP-184" : flow === "dispute" ? "Dispute #DP-024" : "Order #PX-2418"}</div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted">{meta.description}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Trạng thái" value={FLOW_STEPS[flow][step]} tone={flow === "dispute" ? "bad" : step === 3 ? "good" : "warn"} />
        <Stat label="Cập nhật" value="2 phút trước" />
        <Stat label="Giá trị đơn" value="$128.00" />
        <Stat label="Escrow" value={flow === "dispute" ? "Đang giữ" : "An toàn"} tone={flow === "dispute" ? "warn" : "good"} />
      </div>

      <div className="mt-4 rounded-xl border border-line bg-base p-3.5">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Participants</div>
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-iris-soft text-[10px] font-bold text-iris">B8</span>
            <div className="min-w-0 flex-1"><div className="text-[11.5px] font-semibold">Buyer #8421</div><div className="text-[9.5px] text-faint">Order participant</div></div>
          </div>
          {flow !== "support" && (
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-good-soft text-[10px] font-bold text-good">OS</span>
              <div className="min-w-0 flex-1"><div className="text-[11.5px] font-semibold">Orbit Store</div><div className="text-[9.5px] text-faint">Verified seller</div></div>
            </div>
          )}
          {(flow === "support" || (flow === "dispute" && step >= 2)) && (
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-warn-soft text-[10px] font-bold text-warn">AD</span>
              <div className="min-w-0 flex-1"><div className="text-[11.5px] font-semibold">{step >= 2 ? "Minh · Support" : "Admin queue"}</div><div className="text-[9.5px] text-faint">{step >= 2 ? "Assigned" : "Unassigned"}</div></div>
            </div>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-3.5 shadow-card">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Admin actions</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={onAdvance} className="rounded-lg bg-iris px-3 py-2 text-[11px] font-semibold text-white">{step < 2 ? "Nhận case" : step < 3 ? "Giải quyết" : "Đã đóng"}</button>
            <button type="button" className="rounded-lg border border-line-2 bg-surface px-3 py-2 text-[11px] font-semibold text-muted">Chuyển queue</button>
          </div>
        </div>
      )}

      <button type="button" className="mt-4 flex w-full items-center justify-between rounded-xl border border-line bg-base px-3.5 py-3 text-left">
        <span><span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-faint">Linked resource</span><span className="mt-1 block text-[11.5px] font-semibold">Mở chi tiết đơn hàng</span></span>
        <ArrowRight size={15} className="text-faint" />
      </button>
    </aside>
  );
}

type VariantProps = {
  role: PrototypeRole;
  flow: PrototypeFlow;
  step: number;
  mobilePane: MobilePane;
  sentMessages: Message[];
  composer: string;
  onFlow: (flow: PrototypeFlow) => void;
  onMobilePane: (pane: MobilePane) => void;
  onComposer: (value: string) => void;
  onSend: () => void;
  onAdvance: () => void;
};

function VariantA(props: VariantProps) {
  return (
    <div className="mx-auto h-[720px] max-w-[1440px] overflow-hidden border-x border-b border-line bg-surface shadow-card md:rounded-b-xl">
      <div className="grid h-full min-h-0 md:grid-cols-[310px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_290px]">
        <ConversationList
          role={props.role}
          flow={props.flow}
          onSelect={(flow) => { props.onFlow(flow); props.onMobilePane("thread"); }}
          className={cn("border-r border-line", props.mobilePane === "thread" ? "hidden md:block" : "block")}
        />
        <MessageThread
          {...props}
          onBack={() => props.onMobilePane("list")}
          className={cn(props.mobilePane === "list" ? "hidden md:flex" : "flex")}
        />
        <ContextPanel role={props.role} flow={props.flow} step={props.step} onAdvance={props.onAdvance} className="hidden border-l border-line xl:block" />
      </div>
    </div>
  );
}

function VariantB(props: VariantProps) {
  const conversations = conversationsFor(props.role);
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-iris-hi">Conversation focus</div>
          <h2 className="mt-1 font-serif text-[26px] font-semibold tracking-tight">Một việc tại một thời điểm.</h2>
        </div>
        <button type="button" className="hidden items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] font-semibold sm:flex"><Search size={14} /> Tìm conversation</button>
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {conversations.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => { props.onFlow(item.id); props.onMobilePane("thread"); }}
            className={cn(
              "flex min-w-[240px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left",
              props.flow === item.id ? "border-iris/30 bg-iris-soft" : "border-line bg-surface",
            )}
          >
            <Avatar flow={item.id} compact />
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold">{item.title}</span><span className="mt-0.5 block truncate font-mono text-[9.5px] text-faint">{item.subtitle}</span></span>
            {item.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-iris px-1 text-[9px] font-bold text-white">{item.unread}</span>}
          </button>
        ))}
      </div>

      <div className="grid h-[650px] min-h-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card-lg lg:grid-cols-[minmax(0,1fr)_320px]">
        <MessageThread {...props} onBack={() => props.onMobilePane("list")} className="flex" />
        <div className="hidden min-h-0 border-l border-line lg:flex lg:flex-col">
          <div className="border-b border-line bg-ink-panel px-5 py-4 text-white">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/50">Focus brief</div>
            <div className="mt-1 font-serif text-[19px]">{FLOW_META[props.flow].label}</div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-white/65">{FLOW_META[props.flow].description}</p>
          </div>
          <ContextPanel role={props.role} flow={props.flow} step={props.step} onAdvance={props.onAdvance} className="flex-1" />
        </div>
      </div>
    </div>
  );
}

function CaseDossier({ role, flow, step, onOpenChat }: { role: PrototypeRole; flow: PrototypeFlow; step: number; onOpenChat: () => void }) {
  const meta = FLOW_META[flow];
  const Icon = meta.icon;
  return (
    <section className="min-w-0 overflow-y-auto p-5 sm:p-7">
      <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl border", flowBadgeClass(flow))}><Icon size={19} /></span>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{flow === "support" ? "SUP-184" : flow === "dispute" ? "DP-024 · PX-2397" : "PX-2418"}</div>
            <h2 className="mt-1 font-serif text-[25px] font-semibold tracking-tight">{flow === "support" ? "Kiểm tra trạng thái thanh toán" : flow === "dispute" ? "Tài nguyên không đúng mô tả" : "Social bundle · 90 ngày"}</h2>
            <p className="mt-1 text-[11.5px] text-muted">Đang xem với quyền {roleLabel(role)} · {meta.description}</p>
          </div>
        </div>
        <button type="button" onClick={onOpenChat} className="flex items-center justify-center gap-2 rounded-lg bg-iris px-4 py-2.5 text-[12px] font-semibold text-white md:hidden"><MessageCircle size={15} /> Mở chat</button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Trạng thái" value={FLOW_STEPS[flow][step]} tone={flow === "dispute" ? "bad" : "warn"} />
        <Stat label="Giá trị" value="$128.00" />
        <Stat label="Escrow" value={flow === "dispute" ? "Đang giữ" : "An toàn"} tone={flow === "dispute" ? "warn" : "good"} />
        <Stat label="SLA" value={flow === "support" ? "42 phút" : "Không áp dụng"} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center gap-2"><Package size={15} className="text-iris" /><h3 className="text-[12px] font-semibold">Order snapshot</h3></div>
          <dl className="mt-4 space-y-3 text-[11.5px]">
            <div className="flex justify-between gap-4"><dt className="text-faint">Sản phẩm</dt><dd className="text-right font-medium">Social Growth Bundle</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-faint">Seller</dt><dd className="text-right font-medium">Orbit Store</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-faint">Buyer</dt><dd className="text-right font-medium">Buyer #8421</dd></div>
            <div className="flex justify-between gap-4 border-t border-line pt-3"><dt className="text-faint">Tạo lúc</dt><dd className="font-mono text-[10px]">20/08/2026 · 09:18</dd></div>
          </dl>
        </div>
        <div className="rounded-xl border border-line bg-raised/60 p-4">
          <div className="flex items-center gap-2"><CircleDot size={14} className="text-good" /><h3 className="text-[12px] font-semibold">Case timeline</h3></div>
          <div className="mt-4 space-y-4 border-l border-line-2 pl-4">
            {FLOW_STEPS[flow].map((label, index) => (
              <div key={label} className="relative">
                <span className={cn("absolute -left-[21px] top-0.5 h-2.5 w-2.5 rounded-full border-2 border-raised", index <= step ? "bg-iris" : "bg-line-2")} />
                <div className={cn("text-[11px] font-semibold", index <= step ? "text-fg" : "text-faint")}>{label}</div>
                <div className="mt-0.5 text-[9.5px] text-faint">{index <= step ? `${9 + index}:2${index}` : "Đang chờ"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between"><h3 className="text-[12px] font-semibold">Bằng chứng & ghi chú</h3><span className="font-mono text-[9.5px] text-faint">2 ITEMS</span></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-base px-3 py-3 text-[10.5px] text-muted">delivery-check.txt · 12 KB</div>
          <div className="rounded-lg border border-line bg-base px-3 py-3 text-[10.5px] text-muted">Ảnh kiểm tra tài nguyên · 284 KB</div>
        </div>
      </div>
    </section>
  );
}

function VariantC(props: VariantProps) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-iris-hi">Context-first workspace</div>
          <h2 className="mt-1 font-serif text-[24px] font-semibold">Chat sống ngay trong order hoặc support case.</h2>
        </div>
        <div className="hidden items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-faint sm:flex"><UsersRound size={14} /> {roleLabel(props.role)} view</div>
      </div>
      <div className="grid h-[680px] min-h-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card md:grid-cols-[minmax(0,1fr)_390px]">
        <CaseDossier role={props.role} flow={props.flow} step={props.step} onOpenChat={() => props.onMobilePane("thread")} />
        <MessageThread
          {...props}
          onBack={() => props.onMobilePane("list")}
          className={cn("border-l border-line", props.mobilePane === "list" ? "hidden md:flex" : "flex fixed inset-0 z-50 md:static")}
        />
      </div>
    </div>
  );
}

function PrototypeSwitcher({ variant, onVariant }: { variant: PrototypeVariant; onVariant: (variant: PrototypeVariant) => void }) {
  if (process.env.NODE_ENV === "production") return null;
  const currentIndex = VARIANTS.findIndex((item) => item.id === variant);
  const cycle = (delta: number) => onVariant(VARIANTS[(currentIndex + delta + VARIANTS.length) % VARIANTS.length].id);
  return (
    <div className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-ink-panel p-1.5 text-white shadow-card-lg">
      <button type="button" onClick={() => cycle(-1)} aria-label="Variant trước" className="grid h-9 w-9 place-items-center rounded-full text-white/65 hover:bg-white/10 hover:text-white"><ChevronLeft size={17} /></button>
      <div className="min-w-[174px] px-2 text-center">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/45">← → để chuyển</div>
        <div className="mt-0.5 text-[11.5px] font-semibold">{variant} — {VARIANTS[currentIndex].name}</div>
      </div>
      <button type="button" onClick={() => cycle(1)} aria-label="Variant tiếp theo" className="grid h-9 w-9 place-items-center rounded-full text-white/65 hover:bg-white/10 hover:text-white"><ChevronRight size={17} /></button>
    </div>
  );
}

export default function ChatPrototype({
  initialVariant,
  initialRole,
  initialFlow,
}: {
  initialVariant: PrototypeVariant;
  initialRole: PrototypeRole;
  initialFlow: PrototypeFlow;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [variant, setVariant] = useState<PrototypeVariant>(initialVariant);
  const [role, setRole] = useState<PrototypeRole>(initialRole);
  const [flow, setFlow] = useState<PrototypeFlow>(initialFlow);
  const [step, setStep] = useState(2);
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [composer, setComposer] = useState("");
  const [sentMessages, setSentMessages] = useState<Message[]>([]);

  const syncUrl = (next: { variant?: PrototypeVariant; role?: PrototypeRole; flow?: PrototypeFlow }) => {
    const params = new URLSearchParams(window.location.search);
    params.set("variant", next.variant ?? variant);
    params.set("role", next.role ?? role);
    params.set("flow", next.flow ?? flow);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const changeVariant = (next: PrototypeVariant) => {
    setVariant(next);
    syncUrl({ variant: next });
  };

  const changeRole = (next: PrototypeRole) => {
    setRole(next);
    setSentMessages([]);
    setMobilePane("list");
    syncUrl({ role: next });
  };

  const changeFlow = (next: PrototypeFlow) => {
    setFlow(next);
    setStep(next === "order" ? 2 : 1);
    setSentMessages([]);
    syncUrl({ flow: next });
  };

  const sendMessage = () => {
    const body = composer.trim();
    if (!body) return;
    const id = `prototype-${Date.now()}`;
    setComposer("");
    setSentMessages((current) => [...current, { id, author: "me", body, pending: true }]);
    window.setTimeout(() => {
      setSentMessages((current) => current.map((message) => message.id === id ? { ...message, pending: false } : message));
    }, 650);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = VARIANTS.findIndex((item) => item.id === variant);
      const delta = event.key === "ArrowRight" ? 1 : -1;
      changeVariant(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const props: VariantProps = {
    role,
    flow,
    step,
    mobilePane,
    sentMessages,
    composer,
    onFlow: changeFlow,
    onMobilePane: setMobilePane,
    onComposer: setComposer,
    onSend: sendMessage,
    onAdvance: () => setStep((current) => Math.min(current + 1, FLOW_STEPS[flow].length - 1)),
  };

  return (
    <div className="min-h-full bg-base pb-24">
      <ReviewControls role={role} flow={flow} step={step} onRole={changeRole} onFlow={changeFlow} onStep={setStep} />
      {variant === "A" && <VariantA {...props} />}
      {variant === "B" && <VariantB {...props} />}
      {variant === "C" && <VariantC {...props} />}
      <PrototypeSwitcher variant={variant} onVariant={changeVariant} />
    </div>
  );
}
