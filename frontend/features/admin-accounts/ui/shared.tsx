"use client";

import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import type { AccountAdminRow } from "@/lib/types";
import { Tag } from "@/components/ui";

export const ROLE_LABEL: Record<string, string> = { buyer: "Người mua", seller: "Người bán", admin: "Quản trị" };
export const TIER_VI: Record<string, string> = { new: "Mới", verified: "Đã xác minh", trusted: "Uy tín", enterprise: "Doanh nghiệp" };

/** "5 phút trước", "3 ngày trước" — for the last-seen column. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "Chưa đăng nhập";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "Vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return formatDate(iso, "vi");
}

export function AccountAvatar({ email, locked, size = "md" }: { email: string; locked?: boolean; size?: "md" | "lg" }) {
  const initial = email.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className={cn(
      "grid shrink-0 place-items-center rounded-full font-semibold",
      size === "lg" ? "h-11 w-11 text-[16px]" : "h-8 w-8 text-[13px]",
      locked ? "bg-bad-soft text-bad" : "bg-iris-soft text-iris-hi",
    )}>
      {initial}
    </span>
  );
}

/** Small status chips reused by the table and the detail header. */
export function AccountFlags({ row, compact = false }: { row: AccountAdminRow; compact?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {!row.is_active && <Tag tone="bad">Đã khóa</Tag>}
      {!row.email_verified && <Tag tone="warn">Chưa xác minh</Tag>}
      {row.totp_enabled && <Tag tone="iris">2FA</Tag>}
      {row.is_internal && <Tag tone="neutral">Nội bộ</Tag>}
      {compact && row.is_active && row.email_verified && !row.totp_enabled && !row.is_internal && (
        <span className="text-[11.5px] text-faint">—</span>
      )}
    </span>
  );
}

