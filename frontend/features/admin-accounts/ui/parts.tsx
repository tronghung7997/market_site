"use client";

/** Building blocks of the account profile page (extracted from the former
 *  slide-over detail panel): roles editor, seller card, wallet, logins. */

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AccountAdminRow, LoginEvent, SellerTierRule, Transaction } from "@/lib/types";
import { Button, Input, Spinner, Switch, Tag } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/MoneyInput";
import { useToast } from "@/components/toast";
import { CheckCircle2 } from "@/components/Icons";
import { ImageUploader, type UploaderImage } from "@/components/media/ImageUploader";
import { ImageStrip } from "@/components/media/ImageStrip";
import { privateImageBase, privateImageSource } from "@/lib/media";
import { ROLE_LABEL, TIER_VI } from "./shared";

const ROLES = ["buyer", "seller", "admin"] as const;
const ROLE_HINT: Record<string, string> = {
  buyer: "Mua hàng, mở khiếu nại, giới thiệu bạn bè.",
  seller: "Đăng bán, quản lý kho, rút tiền theo hạng.",
  admin: "Vào trang quản trị, duyệt tiền, đổi cấu hình.",
};

export function Section({ title, hint, children, danger = false, aside }: {
  title: string; hint?: string; children: React.ReactNode; danger?: boolean; aside?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-card border bg-card", danger ? "border-bad/30" : "border-line")}>
      <header className={cn("flex items-start justify-between gap-2 border-b px-4 py-2.5", danger ? "border-bad/20 bg-bad-soft/40" : "border-line bg-raised/40")}>
        <div>
          <h3 className={cn("text-[13px] font-semibold", danger ? "text-bad" : "text-fg")}>{title}</h3>
          {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
        </div>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cn("mt-1 font-mono text-[16px] font-semibold tabular-nums", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : "text-fg")}>{value}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- Vai trò */

export function RolesEditor({ row, isSelf, onUpdated }: { row: AccountAdminRow; isSelf: boolean; onUpdated: (u: AccountAdminRow) => void }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const [roles, setRoles] = React.useState<string[]>(row.roles);
  React.useEffect(() => { setRoles(row.roles); }, [row.id, row.roles]);
  const dirty = [...roles].sort().join() !== [...row.roles].sort().join();
  const [activity, setActivity] = React.useState<{ active_products: number; escrow_incoming: number } | null>(null);

  const save = useMutation({
    mutationFn: (confirm: boolean) => api.adminUpdateRoles(row.id, roles, confirm),
    onSuccess: (u) => { setActivity(null); onUpdated(u); toast.success("Đã cập nhật vai trò"); },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && e.errorCode === "seller_has_activity") {
        setActivity({ active_products: Number(e.params.active_products ?? 0), escrow_incoming: Number(e.params.escrow_incoming ?? 0) });
        return;
      }
      toast.error(apiErrorMessage(e, "Cập nhật vai trò thất bại"));
    },
  });

  return (
    <Section title="Vai trò" hint="Một tài khoản có thể giữ nhiều vai trò cùng lúc.">
      <div className="grid gap-2 sm:grid-cols-3">
        {ROLES.map((r) => {
          const on = roles.includes(r);
          const lockedSelfAdmin = isSelf && r === "admin";
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              disabled={lockedSelfAdmin}
              onClick={() => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
                on ? "border-iris bg-iris-soft/60" : "border-line bg-surface hover:border-line-2",
              )}
            >
              <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-iris bg-iris text-surface" : "border-line-2 bg-surface")}>
                {on && <CheckCircle2 size={12} />}
              </span>
              <span>
                <span className="block text-[13px] font-medium text-fg">{ROLE_LABEL[r]}</span>
                <span className="block text-[11.5px] leading-snug text-muted">{lockedSelfAdmin ? "Không thể tự bỏ quyền quản trị của chính mình." : ROLE_HINT[r]}</span>
              </span>
            </button>
          );
        })}
      </div>
      {dirty && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn-soft/60 px-3 py-2">
          <span className="text-[12.5px] font-medium text-warn">Vai trò đã đổi, chưa lưu</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRoles(row.roles)} disabled={save.isPending}>Hủy</Button>
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate(false)}>Lưu vai trò</Button>
          </div>
        </div>
      )}
      <Dialog open={activity !== null} onOpenChange={(o) => { if (!o) setActivity(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-fg">Gian hàng vẫn đang hoạt động</DialogTitle>
            <DialogDescription className="text-[12.5px] text-muted">Bỏ vai trò người bán khi gian hàng còn hoạt động có thể làm gián đoạn đơn của người mua.</DialogDescription>
          </DialogHeader>
          {activity && (
            <ul className="space-y-1.5 text-[13px] text-fg">
              <li><span className="font-mono font-semibold">{activity.active_products}</span> sản phẩm đang bán</li>
              <li><span className="font-mono font-semibold">{vnd(activity.escrow_incoming)}</span> đang giữ chờ hoàn tất đơn</li>
            </ul>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="secondary" onClick={() => setActivity(null)} disabled={save.isPending}>Giữ vai trò</Button>
            <Button variant="danger" loading={save.isPending} onClick={() => save.mutate(true)}>Vẫn bỏ vai trò người bán</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

/* ---------------------------------------------------------------- Người bán */

export function SellerTierCard({ row, onUpdated }: { row: AccountAdminRow; onUpdated: (u: AccountAdminRow) => void }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const tiers = useQuery({ queryKey: ["public-seller-tiers"], queryFn: api.sellerTiers, staleTime: 60_000 });
  const rule: SellerTierRule | undefined = tiers.data?.tiers.find((x) => x.tier === row.seller_tier);
  const toggleInternal = useMutation({
    mutationFn: (v: boolean) => api.adminUpdateInternal(row.id, v),
    onSuccess: (u, v) => { onUpdated(u); toast.success(v ? "Đã đánh dấu seller nội bộ" : "Đã bỏ đánh dấu nội bộ"); },
    onError: (e) => toast.error(apiErrorMessage(e, "Cập nhật thất bại")),
  });
  return (
    <Section title="Người bán" hint="Hạng quyết định số sản phẩm được bán, hạn mức rút, giảm phí và thời gian giữ tiền (chỉnh ở Cài đặt › Người bán).">
      <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
        <div className="text-[13px] font-medium text-fg">Hạng {TIER_VI[row.seller_tier] ?? row.seller_tier}</div>
        {rule && (
          <div className="text-[11.5px] text-muted">
            {rule.max_active_products == null ? "SP không giới hạn" : `Tối đa ${rule.max_active_products} SP`}
            {" · "}
            {rule.withdraw_limit_per_request == null ? "Rút không giới hạn" : `Rút ≤ ${vnd(rule.withdraw_limit_per_request)}/lần`}
            {rule.fee_discount_pp > 0 && ` · Giảm phí ${rule.fee_discount_pp} điểm %`}
          </div>
        )}
      </div>
      {!row.roles.includes("admin") && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
          <div>
            <div className="text-[13px] font-medium text-fg">Seller nội bộ (do sàn vận hành)</div>
            <div className="text-[11.5px] text-muted">Thấy khu Nguồn cung, được giao nguồn hàng, không bị giới hạn số sản phẩm.</div>
          </div>
          <Switch checked={Boolean(row.is_internal)} disabled={toggleInternal.isPending} onChange={(v) => toggleInternal.mutate(v)} label="Seller nội bộ" />
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- Ví */

export function WalletAdjustDialog({ row, open, onClose, onDone }: { row: AccountAdminRow; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const [mode, setMode] = React.useState<"credit" | "debit">("credit");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [proof, setProof] = React.useState<UploaderImage[]>([]);
  React.useEffect(() => { if (open) { setMode("credit"); setAmount(""); setReason(""); setProof([]); } }, [open]);
  const value = parseInt(amount) || 0;
  const adjust = useMutation({
    mutationFn: () => (mode === "credit"
      ? api.adminTopup(row.id, value, reason.trim(), proof.map((image) => image.id))
      : api.adminWalletDebit(row.id, value, reason.trim(), proof.map((image) => image.id))),
    onSuccess: () => {
      toast.success(mode === "credit" ? `Đã cộng ${vnd(value)} vào ví ${row.email}` : `Đã trừ ${vnd(value)} khỏi ví ${row.email}`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, mode === "credit" ? "Cộng ví thất bại" : "Trừ ví thất bại")),
  });
  const valid = value > 0 && reason.trim().length >= 3 && reason.length <= 500;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[16px] text-fg">Điều chỉnh ví</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">Chỉ dùng để đền bù / đối soát. Ghi sổ kèm lý do và IP người thao tác.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="radiogroup" aria-label="Loại điều chỉnh">
            {(["credit", "debit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", mode === m ? (m === "credit" ? "bg-good-soft text-good" : "bg-bad-soft text-bad") : "text-muted hover:text-fg")}
              >
                {m === "credit" ? "Cộng tiền" : "Trừ tiền"}
              </button>
            ))}
          </div>
          <MoneyInput value={amount} onValueChange={setAmount} placeholder="Số tiền (VND)" />
          {mode === "debit" && <p className="text-[11.5px] text-muted">Không trừ quá số dư khả dụng.</p>}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (bắt buộc, ≥ 3 ký tự) — vd: đền bù đơn ORD-…" maxLength={500} className="h-9 text-[12.5px]" aria-label="Lý do" />
          <ImageUploader
            purpose="adjustment_proof"
            value={proof}
            onChange={setProof}
            max={3}
            label="Ảnh bằng chứng"
            hint="Sao kê, biên lai, ảnh chụp lỗi… (tối đa 3). Lưu kèm giao dịch, chỉ admin xem được."
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="secondary" onClick={onClose} disabled={adjust.isPending}>Huỷ</Button>
          <Button variant={mode === "debit" ? "danger" : "primary"} disabled={!valid} loading={adjust.isPending} onClick={() => adjust.mutate()}>
            {mode === "credit" ? "Cộng ví" : "Trừ ví"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WalletTab({ row, onAdjust }: { row: AccountAdminRow; onAdjust: () => void }) {
  const wallet = useQuery({ queryKey: ["admin", "account-wallet", row.id], queryFn: () => api.adminAccountWallet(row.id) });
  const txs = useQuery({ queryKey: ["admin", "account-txs", row.id], queryFn: () => api.adminAccountTransactions(row.id) });

  if (wallet.isPending) return <div className="grid place-items-center py-12"><Spinner /></div>;
  if (wallet.isError || !wallet.data) {
    return <p className="text-[13px] text-bad">Không tải được ví. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void wallet.refetch()}>Thử lại</Button></p>;
  }
  const w = wallet.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Khả dụng" value={vnd(w.available_balance)} />
        <Stat label="Đang khóa (chờ rút)" value={vnd(w.locked_balance)} />
        <Stat label="Đang giữ (đã mua, chờ hoàn tất)" value={vnd(w.escrow_paid)} />
        <Stat label="Chờ nhận (đã bán, chờ hoàn tất)" value={vnd(w.escrow_incoming)} />
      </div>
      <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={onAdjust}>Điều chỉnh ví</Button></div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-fg">Giao dịch gần đây</h3>
          {txs.data && <span className="text-[11.5px] text-faint">{Math.min(txs.data.length, 50)} / {txs.data.length}</span>}
        </div>
        {txs.isPending ? <Spinner /> : txs.isError ? (
          <p className="text-[12.5px] text-bad">Không tải được giao dịch. <button type="button" className="font-medium text-fg underline" onClick={() => void txs.refetch()}>Thử lại</button></p>
        ) : !txs.data || txs.data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-muted">Chưa có giao dịch nào.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {txs.data.slice(0, 50).map((t: Transaction) => (
              <div key={t.id} className="flex items-center gap-3 bg-surface px-3.5 py-2.5 text-[12.5px]">
                <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded text-[12px] font-bold",
                  t.direction === "in" ? "bg-good-soft text-good" : t.direction === "out" ? "bg-bad-soft text-bad" : "bg-raised text-faint")}>
                  {t.direction === "in" ? "+" : t.direction === "out" ? "−" : "•"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg">{t.description ?? t.type}</div>
                  <div className="truncate font-mono text-[11px] text-faint">{formatDateTime(t.created_at, "vi")}{t.reference_id ? ` · ${t.reference_id}` : ""}</div>
                  {t.proof_images && t.proof_images.length > 0 && (
                    <ImageStrip
                      size="sm"
                      className="mt-1.5"
                      title="Ảnh bằng chứng điều chỉnh"
                      images={t.proof_images.map((image) => ({ ...privateImageSource(image, privateImageBase.adminTransactionProof(t.id)), id: image.id }))}
                    />
                  )}
                </div>
                <span className={cn("shrink-0 font-mono font-semibold tabular-nums", t.direction === "in" ? "text-good" : t.direction === "out" ? "text-bad" : "text-faint")}>
                  {t.direction === "neutral" ? "" : t.direction === "in" ? "+" : "−"}{vnd(t.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Đăng nhập */

function LoginEventTag({ ev }: { ev: LoginEvent }) {
  if (ev.kind === "locked") return <Tag tone="bad">Bị khóa{ev.actor_id ? ` (admin #${ev.actor_id})` : ""}</Tag>;
  if (ev.kind === "unlocked") return <Tag tone="warn">Mở khóa{ev.actor_id ? ` (admin #${ev.actor_id})` : ""}</Tag>;
  const label = ev.kind === "admin_login" ? "Đăng nhập admin" : "Đăng nhập";
  if (ev.outcome === "success") return <Tag tone="good">{label} ✓</Tag>;
  if (ev.outcome === "inactive") return <Tag tone="neutral">{label} — đang khóa</Tag>;
  return <Tag tone="bad">{label} — sai mật khẩu</Tag>;
}

export function LoginsTable({ row }: { row: AccountAdminRow }) {
  const events = useQuery({ queryKey: ["admin", "login-events", row.id], queryFn: () => api.adminLoginEvents(row.id, 100) });
  if (events.isPending) return <div className="grid place-items-center py-12"><Spinner /></div>;
  if (events.isError) return <p className="text-[12.5px] text-bad">Không tải được lịch sử đăng nhập. <button type="button" className="font-medium text-fg underline" onClick={() => void events.refetch()}>Thử lại</button></p>;
  const list = events.data ?? [];
  const ips = new Set(list.filter((e) => e.ip).map((e) => e.ip));
  const failed = list.filter((e) => e.kind !== "locked" && e.kind !== "unlocked" && e.outcome !== "success").length;
  if (list.length === 0) return <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-muted">Chưa có lượt đăng nhập nào được ghi nhận.</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Lượt ghi nhận" value={String(list.length)} />
        <Stat label="IP khác nhau" value={String(ips.size)} />
        <Stat label="Thất bại" value={String(failed)} tone={failed > 0 ? "bad" : undefined} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[12.5px]">
          <thead className="bg-raised/40 text-left text-[11.5px] text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Thời gian</th>
              <th className="px-3 py-2 font-medium">Sự kiện</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">Thiết bị</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((ev) => (
              <tr key={ev.id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-muted">{formatDateTime(ev.created_at, "vi")}</td>
                <td className="whitespace-nowrap px-3 py-2"><LoginEventTag ev={ev} /></td>
                <td className="px-3 py-2 font-mono text-[12px] text-fg">{ev.ip ?? "—"}</td>
                <td className="max-w-[260px] truncate px-3 py-2 text-muted" title={ev.user_agent ?? undefined}>{ev.user_agent ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
