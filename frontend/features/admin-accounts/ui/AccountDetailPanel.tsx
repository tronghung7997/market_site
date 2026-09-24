"use client";

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AccountAdminRow, LoginEvent, SellerTierRule, Transaction } from "@/lib/types";
import { Button, Input, Spinner, Switch, Tag } from "@/components/ui";
import { SlidePanel } from "@/components/admin";
import { MoneyInput } from "@/components/MoneyInput";
import { useToast } from "@/components/toast";
import { AlertTriangle, CheckCircle2 } from "@/components/Icons";
import { AccountAvatar, AccountFlags, ROLE_LABEL, TIER_VI, relativeTime } from "./shared";

const ROLES = ["buyer", "seller", "admin"] as const;
const TIERS = ["new", "verified", "trusted", "enterprise"] as const;
const ROLE_HINT: Record<string, string> = {
  buyer: "Mua hàng, mở khiếu nại, giới thiệu bạn bè.",
  seller: "Đăng bán, quản lý kho, rút tiền theo hạng.",
  admin: "Vào trang quản trị, duyệt tiền, đổi cấu hình.",
};

type TabKey = "overview" | "wallet" | "logins";

function Section({ title, hint, children, danger = false }: { title: string; hint?: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={cn("rounded-card border bg-card", danger ? "border-bad/30" : "border-line")}>
      <header className={cn("border-b px-4 py-2.5", danger ? "border-bad/20 bg-bad-soft/40" : "border-line bg-raised/40")}>
        <h3 className={cn("text-[13px] font-semibold", danger ? "text-bad" : "text-fg")}>{title}</h3>
        {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}

export function AccountDetailPanel({ row, isSelf, onClose, onUpdated }: {
  row: AccountAdminRow | null;
  isSelf: boolean;
  onClose: () => void;
  onUpdated: (updated: AccountAdminRow) => void;
}) {
  const [tab, setTab] = React.useState<TabKey>("overview");
  React.useEffect(() => { setTab("overview"); }, [row?.id]);

  return (
    <SlidePanel isOpen={row !== null} onClose={onClose} title={row ? "Tài khoản" : ""} width="xl">
      {row && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AccountAvatar email={row.email} locked={!row.is_active} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 truncate text-[15px] font-semibold text-fg">{row.email}</h2>
                {isSelf && <span className="text-[11.5px] text-faint">(bạn)</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {row.is_active ? <Tag tone="good">Hoạt động</Tag> : null}
                <AccountFlags row={row} />
                {row.roles.map((r) => <Tag key={r} tone={r === "admin" ? "iris" : "neutral"}>{ROLE_LABEL[r] ?? r}</Tag>)}
              </div>
              <p className="mt-1.5 text-[12px] text-muted">
                <span className="font-mono">#{row.id}</span> · Tạo {formatDateTime(row.created_at, "vi")} · Đăng nhập gần nhất: {relativeTime(row.last_login_at)}
                {" · "}
                <Link href={`/admin/logs?account=${row.id}`} className="font-medium text-iris-hi hover:underline">Nhật ký hoạt động</Link>
              </p>
            </div>
          </div>

          <div className="flex gap-1 border-b border-line" role="tablist">
            {([["overview", "Tổng quan"], ["wallet", "Ví & giao dịch"], ["logins", "Lịch sử đăng nhập"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors", tab === key ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg")}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && <OverviewTab row={row} isSelf={isSelf} onUpdated={onUpdated} />}
          {tab === "wallet" && <WalletTab row={row} />}
          {tab === "logins" && <LoginsTab row={row} />}
        </div>
      )}
    </SlidePanel>
  );
}

/* ---------------------------------------------------------------- Tổng quan */

function OverviewTab({ row, isSelf, onUpdated }: { row: AccountAdminRow; isSelf: boolean; onUpdated: (u: AccountAdminRow) => void }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const [roles, setRoles] = React.useState<string[]>(row.roles);
  React.useEffect(() => { setRoles(row.roles); }, [row.id, row.roles]);
  const rolesDirty = [...roles].sort().join() !== [...row.roles].sort().join();
  const tiers = useQuery({ queryKey: ["public-seller-tiers"], queryFn: api.sellerTiers, staleTime: 60_000 });
  const tierRule = (t: string): SellerTierRule | undefined => tiers.data?.tiers.find((x) => x.tier === t);

  const run = <T,>(fn: () => Promise<T>, ok: string, fail: string, after?: (v: T) => void) =>
    fn().then((v) => { after?.(v); toast.success(ok); }).catch((e) => toast.error(apiErrorMessage(e, fail)));

  const saveRoles = useMutation({ mutationFn: () => run(() => api.adminUpdateRoles(row.id, roles), "Đã cập nhật vai trò", "Cập nhật vai trò thất bại", onUpdated) });
  const saveTier = useMutation({ mutationFn: (tier: string) => run(() => api.adminUpdateSellerTier(row.id, tier), `Đã đổi hạng thành ${TIER_VI[tier] ?? tier}`, "Cập nhật hạng thất bại", onUpdated) });
  const toggleInternal = useMutation({ mutationFn: (v: boolean) => run(() => api.adminUpdateInternal(row.id, v), v ? "Đã đánh dấu seller nội bộ" : "Đã bỏ đánh dấu nội bộ", "Cập nhật thất bại", onUpdated) });
  const verify = useMutation({ mutationFn: () => run(() => api.adminVerifyEmail(row.id), "Đã đánh dấu email xác minh", "Không đánh dấu được", onUpdated) });

  const [lockOpen, setLockOpen] = React.useState(false);
  const [lockReason, setLockReason] = React.useState("");
  React.useEffect(() => { setLockOpen(false); setLockReason(""); }, [row.id]);
  const setActive = useMutation({
    mutationFn: (active: boolean) => run(
      () => api.adminSetAccountStatus(row.id, active, active ? undefined : lockReason.trim() || undefined),
      active ? "Đã mở khóa tài khoản" : "Đã khóa tài khoản và đăng xuất mọi thiết bị",
      active ? "Mở khóa thất bại" : "Khóa tài khoản thất bại",
      (u) => { onUpdated(u); setLockOpen(false); setLockReason(""); },
    ),
  });

  const isSeller = roles.includes("seller");
  const rule = tierRule(row.seller_tier);

  return (
    <div className="space-y-4">
      <Section title="Vai trò" hint="Một tài khoản có thể giữ nhiều vai trò cùng lúc.">
        <div className="grid gap-2 sm:grid-cols-3">
          {ROLES.map((r) => {
            const on = roles.includes(r);
            const lockedSelfAdmin = isSelf && r === "admin";
            return (
              <button
                key={r}
                type="button"
                disabled={lockedSelfAdmin}
                onClick={() => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
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
        {rolesDirty && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn-soft/60 px-3 py-2">
            <span className="text-[12.5px] font-medium text-warn">Vai trò đã đổi, chưa lưu</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRoles(row.roles)} disabled={saveRoles.isPending}>Hủy</Button>
              <Button size="sm" onClick={() => saveRoles.mutate()} disabled={saveRoles.isPending}>{saveRoles.isPending ? "Đang lưu…" : "Lưu vai trò"}</Button>
            </div>
          </div>
        )}
      </Section>

      {isSeller && (
        <Section title="Người bán" hint="Hạng quyết định số sản phẩm được bán, hạn mức rút, giảm phí và thời gian giữ tiền (chỉnh ở Cài đặt › Người bán).">
          <div className="grid gap-2 sm:grid-cols-4">
            {TIERS.map((t) => {
              const on = row.seller_tier === t;
              const r = tierRule(t);
              return (
                <button
                  key={t}
                  type="button"
                  disabled={saveTier.isPending || on}
                  onClick={() => saveTier.mutate(t)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors disabled:cursor-default",
                    on ? "border-good bg-good-soft/60" : "border-line bg-surface hover:border-line-2",
                  )}
                >
                  <span className="block text-[13px] font-semibold text-fg">{TIER_VI[t]}</span>
                  {r && (
                    <span className="mt-1 block text-[11.5px] leading-snug text-muted">
                      {r.max_active_products == null ? "SP không giới hạn" : `Tối đa ${r.max_active_products} SP`}
                      <br />
                      {r.withdraw_limit_per_request == null ? "Rút không giới hạn" : `Rút ≤ ${vnd(r.withdraw_limit_per_request)}/lần`}
                      {r.fee_discount_pp > 0 && <><br />Giảm phí {r.fee_discount_pp} điểm %</>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {rule && <p className="mt-2 text-[12px] text-faint">Đang ở hạng <span className="font-medium text-fg">{TIER_VI[row.seller_tier] ?? row.seller_tier}</span>. Đổi hạng có hiệu lực ngay, không cần seller đăng nhập lại.</p>}
          {!roles.includes("admin") && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
              <div>
                <div className="text-[13px] font-medium text-fg">Seller nội bộ (do sàn vận hành)</div>
                <div className="text-[11.5px] text-muted">Thấy khu Nguồn cung, được giao nguồn hàng, không bị giới hạn số sản phẩm.</div>
              </div>
              <Switch checked={Boolean(row.is_internal)} disabled={toggleInternal.isPending} onChange={(v) => toggleInternal.mutate(v)} label="Seller nội bộ" />
            </div>
          )}
        </Section>
      )}

      <Section title="Bảo mật" hint="Email đã xác minh mới được mua / nạp / rút (nếu đang bật yêu cầu ở Cài đặt › Tài khoản).">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-fg">Email</div>
              <div className="text-[11.5px] text-muted">{row.email_verified ? "Đã xác minh" : "Chưa xác minh — có thể xác nhận tay nếu đã kiểm tra."}</div>
            </div>
            {row.email_verified
              ? <span className="shrink-0 whitespace-nowrap"><Tag tone="good">Đã xác minh</Tag></span>
              : <Button size="sm" variant="secondary" disabled={verify.isPending} onClick={() => verify.mutate()}>{verify.isPending ? "…" : "Xác nhận tay"}</Button>}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-fg">Xác thực 2 lớp (2FA)</div>
              <div className="text-[11.5px] text-muted">Người dùng tự bật ở trang Bảo mật tài khoản.</div>
            </div>
            <span className="shrink-0 whitespace-nowrap">{row.totp_enabled ? <Tag tone="iris">Đang bật</Tag> : <Tag tone="neutral">Chưa bật</Tag>}</span>
          </div>
        </div>
      </Section>

      <Section title={row.is_active ? "Khóa tài khoản" : "Tài khoản đang bị khóa"} hint={row.is_active ? "Khóa là đăng xuất mọi thiết bị ngay lập tức và chặn đăng nhập lại. Lý do được ghi vào nhật ký." : "Mở khóa để người dùng đăng nhập lại."} danger>
        {isSelf ? (
          <p className="text-[12.5px] text-muted">Không thể tự khóa tài khoản của chính bạn.</p>
        ) : row.is_active ? (
          lockOpen ? (
            <div className="space-y-2">
              <Input value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder="Lý do khóa (tuỳ chọn, ghi vào nhật ký) — vd: clone farm, lừa đảo…" maxLength={500} autoFocus className="h-9 text-[12.5px]" />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="danger" disabled={setActive.isPending} onClick={() => setActive.mutate(false)}>
                  <AlertTriangle size={14} className="mr-1.5" />{setActive.isPending ? "Đang khóa…" : "Xác nhận khóa"}
                </Button>
                <Button size="sm" variant="ghost" disabled={setActive.isPending} onClick={() => { setLockOpen(false); setLockReason(""); }}>Hủy</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setLockOpen(true)}>Khóa tài khoản này</Button>
          )
        ) : (
          <Button size="sm" variant="secondary" disabled={setActive.isPending} onClick={() => setActive.mutate(true)}>{setActive.isPending ? "…" : "Mở khóa"}</Button>
        )}
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- Ví */

function WalletTab({ row }: { row: AccountAdminRow }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const wallet = useQuery({ queryKey: ["admin", "account-wallet", row.id], queryFn: () => api.adminAccountWallet(row.id) });
  const txs = useQuery({ queryKey: ["admin", "account-txs", row.id], queryFn: () => api.adminAccountTransactions(row.id) });
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const topup = useMutation({
    mutationFn: () => api.adminTopup(row.id, parseInt(amount) || 0, reason.trim()),
    onSuccess: () => {
      toast.success(`Đã cộng ${vnd(parseInt(amount) || 0)} vào ví ${row.email}`);
      setAmount(""); setReason("");
      void wallet.refetch(); void txs.refetch();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Cộng ví thất bại")),
  });
  const canTopup = (parseInt(amount) || 0) > 0 && reason.trim().length >= 3 && !topup.isPending;

  if (wallet.isPending) return <div className="grid place-items-center py-12"><Spinner /></div>;
  if (wallet.isError || !wallet.data) return <p className="text-[13px] text-bad">Không tải được ví.</p>;
  const w = wallet.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Khả dụng" value={vnd(w.available_balance)} />
        <Stat label="Đang khóa (chờ rút)" value={vnd(w.locked_balance)} />
        <Stat label="Đang giữ (đã mua, chờ hoàn tất)" value={vnd(w.escrow_paid)} />
        <Stat label="Chờ nhận (đã bán, chờ hoàn tất)" value={vnd(w.escrow_incoming)} />
      </div>

      <Section title="Cộng tiền tay" hint="Chỉ dùng để đền bù / đối soát. Ghi sổ kèm lý do và IP người thao tác; nạp thường đi qua cổng thanh toán.">
        <div className="space-y-2">
          <div className="flex gap-2">
            <MoneyInput value={amount} onValueChange={setAmount} placeholder="Số tiền (VND)" className="flex-1" />
            <Button size="sm" disabled={!canTopup} onClick={() => topup.mutate()}>{topup.isPending ? "…" : "Cộng ví"}</Button>
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (bắt buộc, ≥ 3 ký tự) — vd: đền bù đơn ORD-…, đối soát nạp ngày …" maxLength={500} className="h-9 text-[12.5px]" />
        </div>
      </Section>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-fg">Giao dịch gần đây</h3>
          {txs.data && <span className="text-[11.5px] text-faint">{Math.min(txs.data.length, 30)} / {txs.data.length}</span>}
        </div>
        {txs.isPending ? <Spinner /> : !txs.data || txs.data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-muted">Chưa có giao dịch nào.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {txs.data.slice(0, 30).map((t: Transaction) => (
              <div key={t.id} className="flex items-center gap-3 bg-surface px-3.5 py-2.5 text-[12.5px]">
                <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded text-[12px] font-bold",
                  t.direction === "in" ? "bg-good-soft text-good" : t.direction === "out" ? "bg-bad-soft text-bad" : "bg-raised text-faint")}>
                  {t.direction === "in" ? "+" : t.direction === "out" ? "−" : "•"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg">{t.description ?? t.type}</div>
                  <div className="truncate font-mono text-[11px] text-faint">{formatDateTime(t.created_at, "vi")}{t.reference_id ? ` · ${t.reference_id}` : ""}</div>
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

function LoginsTab({ row }: { row: AccountAdminRow }) {
  const events = useQuery({ queryKey: ["admin", "login-events", row.id], queryFn: () => api.adminLoginEvents(row.id, 100) });
  if (events.isPending) return <div className="grid place-items-center py-12"><Spinner /></div>;
  const list = events.data ?? [];
  const ips = new Set(list.filter((e) => e.ip).map((e) => e.ip));
  const failed = list.filter((e) => e.kind !== "locked" && e.kind !== "unlocked" && e.outcome !== "success").length;
  if (list.length === 0) return <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-muted">Chưa có lượt đăng nhập nào được ghi nhận.</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Lượt ghi nhận" value={String(list.length)} />
        <Stat label="IP khác nhau" value={String(ips.size)} />
        <Stat label="Thất bại" value={String(failed)} />
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
