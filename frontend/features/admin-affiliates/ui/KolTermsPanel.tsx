"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Link } from "@/i18n/navigation";
import { Button, Input, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { AffiliateTerms } from "@/lib/types";

const termsKey = (id: number) => ["admin-affiliate", id, "terms"] as const;

/** Whole numbers or one decimal for %, whole days; "" = follow the default. */
function parsePercent(v: string): number | null | "bad" {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : "bad";
}

function parseDays(v: string): number | null | "bad" {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : "bad";
}

const daysText = (d: number) => (d === 0 ? "trọn đời" : `${d.toLocaleString("vi-VN")} ngày`);

/** Admin › Affiliate › one account: its own commission % of the platform fee
 *  and earning window (a KOL deal). Empty fields follow the programme default. */
export function KolTermsPanel({ accountId }: { accountId: number }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const terms = useQuery({ queryKey: termsKey(accountId), queryFn: () => api.adminAffiliateTerms(accountId) });
  const [percent, setPercent] = React.useState("");
  const [days, setDays] = React.useState("");
  const [note, setNote] = React.useState("");

  const load = React.useCallback((t: AffiliateTerms) => {
    setPercent(t.commission_percent_of_fee == null ? "" : String(t.commission_percent_of_fee));
    setDays(t.earning_days == null ? "" : String(t.earning_days));
    setNote(t.note ?? "");
  }, []);
  React.useEffect(() => { if (terms.data) load(terms.data); }, [terms.data, load]);

  const save = useMutation({
    mutationFn: (body: { commission_percent_of_fee: number | null; earning_days: number | null; note: string | null }) =>
      api.adminSetAffiliateTerms(accountId, body),
    onSuccess: (res) => {
      queryClient.setQueryData(termsKey(accountId), res);
      void queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-affiliate", accountId] });
      toast.success(res.commission_percent_of_fee == null && res.earning_days == null ? "Đã bỏ mức riêng, theo mức chung" : "Đã lưu mức hoa hồng riêng");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Lưu thất bại")),
  });

  if (terms.isPending) return <section className="grid place-items-center rounded-card border border-line bg-card py-10 shadow-card"><Spinner /></section>;
  if (terms.isError || !terms.data) {
    return (
      <section className="rounded-card border border-line bg-card px-5 py-6 text-center text-[13px] text-bad shadow-card">
        Không tải được mức hoa hồng. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void terms.refetch()}>Thử lại</Button>
      </section>
    );
  }

  const t = terms.data;
  const p = parsePercent(percent);
  const d = parseDays(days);
  const invalid = p === "bad" || d === "bad";
  // A note is kept only with a rate or a window (no own terms = no row).
  const noteChanged = (p != null || d != null) && (note.trim() || null) !== (t.note ?? null);
  const dirty = !invalid && (p !== t.commission_percent_of_fee || d !== t.earning_days || noteChanged);
  const custom = t.commission_percent_of_fee != null || t.earning_days != null;

  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold text-fg">Hoa hồng riêng (KOL)</h2>
          <p className="mt-1 text-[12.5px] text-muted">
            Đang áp dụng: <span className="font-medium text-fg">{t.effective_commission_percent_of_fee}% phí sàn · {daysText(t.effective_earning_days)}</span>
            {custom ? " (mức riêng)" : " (theo mức chung)"}. Mức chung: {t.default_commission_percent_of_fee}% · {daysText(t.default_earning_days)}.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[12.5px] font-medium text-fg">Hoa hồng (% phí sàn)</span>
          <div className="relative mt-1.5">
            <Input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder={`Theo mức chung (${t.default_commission_percent_of_fee}%)`}
              aria-invalid={p === "bad" || undefined} className="pr-10 text-right font-mono tabular placeholder:font-sans placeholder:text-left" />
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">%</span>
          </div>
          <span className={p === "bad" ? "mt-1 block text-[11.5px] text-bad" : "mt-1 block text-[11.5px] text-faint"}>
            {p === "bad" ? "Nhập từ 0 đến 100." : "Tính trên phí sàn của đơn, không phải tổng tiền đơn. Thắng mức của sản phẩm/danh mục, trừ khi sản phẩm/danh mục đặt 0%."}
          </span>
        </label>
        <label className="block">
          <span className="block text-[12.5px] font-medium text-fg">Thời gian hưởng (ngày)</span>
          <div className="relative mt-1.5">
            <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} placeholder={`Theo mức chung (${daysText(t.default_earning_days)})`}
              aria-invalid={d === "bad" || undefined} className="pr-14 text-right font-mono tabular placeholder:font-sans placeholder:text-left" />
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">ngày</span>
          </div>
          <span className={d === "bad" ? "mt-1 block text-[11.5px] text-bad" : "mt-1 block text-[11.5px] text-faint"}>
            {d === "bad" ? "Nhập từ 0 đến 3650." : "0 = trọn đời. Tính từ lúc khách được gắn với người này."}
          </span>
        </label>
      </div>
      <label className="mt-3 block">
        <span className="block text-[12.5px] font-medium text-fg">Ghi chú nội bộ</span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="VD: KOL YouTube, hợp đồng 10/2026" className="mt-1.5 min-h-[60px]" />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ commission_percent_of_fee: p as number | null, earning_days: d as number | null, note: note.trim() || null })}>
          Lưu mức riêng
        </Button>
        {custom && (
          <Button size="sm" variant="secondary" disabled={save.isPending}
            onClick={() => save.mutate({ commission_percent_of_fee: null, earning_days: null, note: null })}>
            Bỏ mức riêng
          </Button>
        )}
        {dirty && <Button size="sm" variant="ghost" onClick={() => load(t)} disabled={save.isPending}>Hoàn tác</Button>}
        <Link href={`/admin/promotions/new?kol=${accountId}`} className="ml-auto text-[12.5px] font-medium text-iris-hi hover:underline">Tạo mã giảm giá cho KOL</Link>
      </div>
      <p className="mt-2 text-[11.5px] text-faint">Áp dụng cho hoa hồng tính từ bây giờ; hoa hồng đã trả giữ nguyên. Mọi thay đổi được ghi nhật ký.</p>
    </section>
  );
}
