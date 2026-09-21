"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { FundEntry } from "@/lib/types";
import { Button, Input, Spinner, Tag } from "@/components/ui";
import { SlidePanel } from "@/components/admin";
import { MoneyInput } from "@/components/MoneyInput";
import { useToast } from "@/components/toast";

const KIND: Record<string, { label: string; tone: "good" | "neutral" | "warn" | "iris" }> = {
  topup: { label: "Nạp quỹ", tone: "good" },
  commission: { label: "Trả hoa hồng", tone: "neutral" },
  clawback: { label: "Thu hồi", tone: "warn" },
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cn("mt-1 font-mono text-[16px] font-semibold tabular-nums", tone === "bad" ? "text-bad" : "text-fg")}>{value}</div>
    </div>
  );
}

/** Quỹ hoa hồng: balance, top-up form and the ledger of what went in and out. */
export function FundPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const fund = useQuery({ queryKey: ["admin-affiliate-fund"], queryFn: api.adminFund, enabled: open });
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  React.useEffect(() => { if (!open) { setAmount(""); setNote(""); } }, [open]);

  const topup = useMutation({
    mutationFn: () => api.adminFundTopup(Number(amount), note.trim() || undefined),
    onSuccess: (next) => {
      queryClient.setQueryData(["admin-affiliate-fund"], next);
      toast.success(`Đã nạp ${vnd(Number(amount))} vào quỹ hoa hồng`);
      setAmount(""); setNote("");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Nạp quỹ thất bại")),
  });

  const amountOk = Number(amount) > 0;
  const data = fund.data;
  const negative = (data?.balance ?? 0) < 0;

  return (
    <SlidePanel isOpen={open} onClose={onClose} title="Quỹ hoa hồng" width="lg">
      {!data ? (
        <div className="grid place-items-center py-16"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-[12px] text-muted">Số dư hiện tại</p>
            <p className={cn("mt-1 font-mono text-[30px] font-semibold leading-none tabular-nums", negative ? "text-bad" : "text-fg")}>{vnd(data.balance)}</p>
            {negative && <p className="mt-2 text-[12.5px] text-bad">Quỹ đang âm. Hoa hồng vẫn được cộng cho affiliate — nạp thêm để số dư phản ánh đúng ngân sách.</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Tổng đã nạp" value={vnd(data.total_topped_up)} />
              <Stat label="Tổng đã trả (trừ thu hồi)" value={vnd(data.total_paid_out)} />
            </div>
          </div>

          <section className="rounded-card border border-line bg-card">
            <header className="border-b border-line bg-raised/40 px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-fg">Nạp quỹ</h3>
              <p className="mt-0.5 text-[12px] text-muted">Ghi nhận ngân sách hoa hồng; không chuyển tiền thật.</p>
            </header>
            <div className="space-y-2 p-4">
              <MoneyInput placeholder="Số tiền nạp" value={amount} onValueChange={setAmount} />
              <Input placeholder="Ghi chú (tuỳ chọn), vd: Ngân sách Q4" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <div className="flex justify-end">
                <Button disabled={!amountOk || topup.isPending} onClick={() => topup.mutate()}>{topup.isPending ? "Đang nạp…" : amountOk ? `Nạp ${vnd(Number(amount))}` : "Nạp quỹ"}</Button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-card border border-line bg-card">
            <header className="border-b border-line bg-raised/40 px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-fg">Biến động gần đây</h3>
              <p className="mt-0.5 text-[12px] text-muted">30 dòng mới nhất. Luật trả hoa hồng: <Link href="/admin/display-settings?tab=affiliate" className="text-iris-hi hover:underline">Cài đặt › Affiliate</Link>.</p>
            </header>
            {data.entries.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-muted">Chưa có biến động nào.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.entries.map((e: FundEntry) => {
                  const kind = KIND[e.kind] ?? { label: e.kind, tone: "neutral" as const };
                  return (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <Tag tone={kind.tone}>{kind.label}</Tag>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-fg">{e.note || (e.reference_id ? `Tham chiếu ${e.reference_id}` : "—")}</div>
                        <div className="text-[11.5px] text-faint">{formatDateTime(e.created_at, "vi")}</div>
                      </div>
                      <span className={cn("font-mono font-medium tabular-nums", e.amount >= 0 ? "text-good" : "text-fg")}>{e.amount >= 0 ? "+" : "−"}{vnd(Math.abs(e.amount))}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </SlidePanel>
  );
}
