"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAdminAffiliateDetail } from "@/hooks/use-affiliate";
import { Button, Input, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Check, ChevronLeft, Copy, Edit2, X } from "@/components/Icons";
import { AccountAvatar } from "@/features/admin-accounts/ui/shared";
import { ActivityChart, AffiliateFunnel, CommissionsPanel, RangePicker, ReferredUsersPanel, rangeParams, type DateRange, type RangeKey } from "@/features/affiliate";

/** Admin › Affiliate › one account: code, link, funnel for a range, activity and payouts. */
export function AdminAffiliateDetail({ id }: { id: number }) {
  const router = useRouter();
  const locale = useLocale();
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [range, setRange] = React.useState<RangeKey>("30d");
  const [custom, setCustom] = React.useState<DateRange>({});
  const params = React.useMemo(() => rangeParams(range, custom), [range, custom]);
  const stats = useAdminAffiliateDetail(id, params);
  const data = stats.data;

  const [editing, setEditing] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const saveCode = useMutation({
    mutationFn: () => api.adminUpdateAffiliateCode(id, code.trim().toUpperCase()),
    onSuccess: (res) => {
      setEditing(false);
      toast.success(`Đã đổi mã giới thiệu thành ${res.affiliate_code}`);
      void queryClient.invalidateQueries({ queryKey: ["admin-affiliate", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Đổi mã thất bại")),
  });
  const codeOk = /^[A-Z0-9]{4,8}$/.test(code.trim().toUpperCase());
  const copyLink = () => {
    if (!data || typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(data.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {});
  };

  return (
    <div className="space-y-5">
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/${locale}/admin/affiliates`)}><ChevronLeft size={15} /> Danh sách affiliate</Button>
        <RangePicker value={range} custom={custom} onChange={(key, c) => { setRange(key); if (c) setCustom(c); }} />
      </div>

      {stats.isPending || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <section className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-card px-5 py-4 shadow-card">
            <AccountAvatar email={data.email ?? "?"} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold text-fg">{data.email ?? `Tài khoản #${id}`}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-muted">Mã giới thiệu</span>
                {editing ? (
                  <span className="flex items-center gap-1.5">
                    <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="4–8 ký tự A–Z 0–9" autoFocus className="h-8 w-[150px] font-mono text-[13px]" />
                    <Button size="sm" disabled={!codeOk || saveCode.isPending} onClick={() => saveCode.mutate()}><Check size={14} /> Lưu</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saveCode.isPending}><X size={14} /></Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="rounded-md bg-iris-soft px-2 py-0.5 font-mono text-[14px] font-semibold text-iris-hi">{data.code}</span>
                    <button type="button" onClick={() => { setCode(data.code); setEditing(true); }} aria-label="Đổi mã giới thiệu" className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-fg"><Edit2 size={13} /></button>
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="truncate font-mono text-muted">{data.link}</span>
                <button type="button" onClick={copyLink} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium transition-colors", copied ? "text-good" : "text-iris-hi hover:bg-iris-soft")}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Đã sao chép" : "Sao chép"}
                </button>
              </div>
              {editing && <p className="mt-1 text-[12px] text-warn">Đổi mã làm liên kết cũ ngừng hoạt động; khách đã đăng ký vẫn giữ nguyên.</p>}
            </div>
          </section>

          <AffiliateFunnel totals={data.totals} formatMoney={vnd} />
          <ActivityChart series={data.timeseries} formatMoney={vnd} />
          <div className="grid gap-4 xl:grid-cols-2">
            <ReferredUsersPanel users={data.referred_users} formatMoney={vnd} />
            <CommissionsPanel rows={data.commissions} formatMoney={vnd} orderHref={(c) => `/${locale}/admin/orders?order=${c.order_id}`} />
          </div>
        </div>
      )}
    </div>
  );
}
