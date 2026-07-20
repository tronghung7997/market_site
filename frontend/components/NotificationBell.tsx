"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ActionItem } from "@/lib/types";
import { Bell, X } from "./Icons";

const ENDPOINTS = {
  buyer: api.buyerActionItems,
  seller: api.sellerActionItems,
  admin: api.adminActionItems,
} as const;

const DISMISS = {
  buyer: null,
  seller: api.dismissSellerAlert,
  admin: api.dismissAlert,
} as const;

const DOT_TONE: Record<ActionItem["severity"], string> = {
  critical: "bg-bad",
  warning: "bg-warn",
  info: "bg-iris",
};

const POLL_MS = 60_000;

export default function NotificationBell({ endpoint }: { endpoint: keyof typeof ENDPOINTS }) {
  const pathname = usePathname();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);

  const load = () => {
    ENDPOINTS[endpoint]()
      .then((data) => { if (mounted.current) setItems(data); })
      .catch(() => { if (mounted.current) setItems([]); });
  };

  useEffect(() => {
    mounted.current = true;
    load();
    const interval = setInterval(load, POLL_MS);
    return () => { mounted.current = false; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, endpoint]);

  const total = items.reduce((sum, i) => sum + i.count, 0);
  const dismiss = DISMISS[endpoint];

  const handleDismiss = async (alertId: number) => {
    if (!dismiss) return;
    try {
      await dismiss(alertId);
      load();
    } catch {
      // giữ nguyên danh sách nếu dismiss thất bại — không âm thầm xoá khỏi UI
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Thông báo"
        aria-label="Thông báo"
        aria-expanded={open}
        className="relative grid place-items-center h-9 w-9 rounded-lg border border-line bg-surface text-muted hover:text-fg hover:border-line-2 transition-colors"
      >
        <Bell size={16} />
        {total > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[10px] font-bold leading-none">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 z-50 rounded-xl border border-line bg-surface shadow-card-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-line bg-raised/50">
              <div className="text-[13px] font-semibold text-fg">Việc cần xử lý</div>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-6 text-center text-[13px] text-muted">
                  Không có việc gì cần xử lý
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 border-b border-line last:border-0 hover:bg-raised/50 transition-colors">
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex-1 min-w-0 flex items-start gap-2.5 px-4 py-3"
                    >
                      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${DOT_TONE[item.severity]}`} />
                      <span className="text-[13px] text-fg leading-snug">{item.label}</span>
                    </Link>
                    {item.dismissible && item.alert_id !== null && (
                      <button
                        onClick={() => handleDismiss(item.alert_id as number)}
                        title="Bỏ qua"
                        aria-label="Bỏ qua"
                        className="shrink-0 grid place-items-center h-7 w-7 mr-2 rounded-md text-faint hover:text-fg hover:bg-raised transition-colors"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
