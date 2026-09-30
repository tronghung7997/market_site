"use client";

/** Admin › Tài khoản › one account: header with actions, tabs in `?tab=`,
 *  and an overview with KPIs, timeline, roles and a security/related aside. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import { orderStatus } from "@/lib/order-status";
import { timelineLine } from "../model";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AccountAdminRow, AccountOverview, Dispute, PaginatedDisputes } from "@/lib/types";
import { Button, Spinner, Tag, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DisputeStatusBadge, InternalNotes, OrderStatusBadge, Pagination } from "@/components/admin";
import { useToast } from "@/components/toast";
import { AlertTriangle, ChevronDown, ChevronLeft, ExternalLink } from "@/components/Icons";
import { AccountAvatar, ROLE_LABEL, TIER_VI, relativeTime } from "./shared";
import { LoginsTable, RolesEditor, Section, SellerTierCard, Stat, WalletAdjustDialog, WalletTab } from "./parts";
import { TierTab } from "./TierTab";

type TabKey = "overview" | "seller" | "orders" | "wallet" | "disputes" | "security" | "related" | "logs";
const TAB_LABEL: Record<TabKey, string> = {
  overview: "Tổng quan", seller: "Người bán", orders: "Đơn hàng", wallet: "Ví & giao dịch",
  disputes: "Khiếu nại", security: "Bảo mật & phiên", related: "Tài khoản liên quan", logs: "Nhật ký",
};

const overviewKey = (id: number) => ["admin", "accounts", "overview", id] as const;

export function AccountProfilePage({ id }: { id: number }) {
  const { account: me } = useAuth();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const valid = Number.isInteger(id) && id > 0;
  const overview = useQuery({ queryKey: overviewKey(id), queryFn: () => api.adminAccountOverview(id), enabled: valid });
  const data = overview.data;
  const row = data?.account;
  const isSeller = Boolean(row?.roles.includes("seller"));
  const tabs: TabKey[] = ["overview", ...(isSeller ? ["seller" as const] : []), "orders", "wallet", "disputes", "security", "related", "logs"];
  const requested = searchParams.get("tab") as TabKey | null;
  const tab: TabKey = requested && tabs.includes(requested) ? requested : "overview";
  const setTab = (next: TabKey) => {
    const q = new URLSearchParams(window.location.search);
    if (next === "overview") q.delete("tab"); else q.set("tab", next);
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };

  const onUpdated = React.useCallback((u: AccountAdminRow) => {
    queryClient.setQueryData<AccountOverview>(overviewKey(id), (old) => (old ? { ...old, account: { ...old.account, ...u } } : old));
    void queryClient.invalidateQueries({ queryKey: ["admin", "accounts"] });
  }, [id, queryClient]);
  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: overviewKey(id) });
    void queryClient.invalidateQueries({ queryKey: ["admin", "account-wallet", id] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "account-txs", id] });
  }, [id, queryClient]);

  const [walletOpen, setWalletOpen] = React.useState(false);

  if (!valid) return <NotFound />;
  if (overview.isPending) return <div className="grid place-items-center py-24"><Spinner /></div>;
  if (overview.isError || !data || !row) {
    const status = (overview.error as { status?: number } | null)?.status;
    if (status === 404) return <NotFound />;
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-card border border-line bg-card px-5 py-14 text-center text-[13px] text-bad">
          {status === 403 ? "Bạn không có quyền xem tài khoản này." : "Không tải được tài khoản."}
          {status !== 403 && <Button size="sm" variant="secondary" className="ml-2" onClick={() => void overview.refetch()}>Thử lại</Button>}
        </div>
      </div>
    );
  }
  const isSelf = me?.id === row.id;

  return (
    <div className="space-y-4">
      <BackLink />
      <ProfileHeader data={data} isSelf={isSelf} onUpdated={onUpdated} onRefresh={refresh} onAdjustWallet={() => setWalletOpen(true)} />

      <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Hồ sơ tài khoản">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
              tab === key ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {TAB_LABEL[key]}
            {key === "related" && data.related.length > 0 && <span className="ml-1.5 font-mono text-[11px] text-bad">{data.related.length}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TAB_LABEL[tab]}>
        {tab === "overview" && <OverviewTab data={data} isSelf={isSelf} onUpdated={onUpdated} />}
        {tab === "seller" && isSeller && (
          <div className="space-y-4">
            <ShopCard data={data} />
            <SellerTierCard row={row} onUpdated={onUpdated} />
            <TierTab row={row} onUpdated={onUpdated} />
          </div>
        )}
        {tab === "orders" && <OrdersTab row={row} />}
        {tab === "wallet" && <WalletTab row={row} onAdjust={() => setWalletOpen(true)} />}
        {tab === "disputes" && <DisputesTab id={row.id} />}
        {tab === "security" && <SecurityTab data={data} isSelf={isSelf} onUpdated={onUpdated} onRefresh={refresh} />}
        {tab === "related" && <RelatedList related={data.related} />}
        {tab === "logs" && <LogsTab id={row.id} />}
      </div>

      <WalletAdjustDialog row={row} open={walletOpen} onClose={() => setWalletOpen(false)} onDone={refresh} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/accounts" className="-mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">
      <ChevronLeft size={14} /> Danh sách tài khoản
    </Link>
  );
}

function NotFound() {
  return (
    <div className="space-y-4">
      <BackLink />
      <div className="rounded-card border border-line bg-card px-5 py-14 text-center">
        <p className="text-[13.5px] font-medium text-fg">Không tìm thấy tài khoản.</p>
        <p className="mt-1 text-[12.5px] text-muted">Tài khoản có thể đã bị xoá hoặc đường dẫn sai.</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- header */

function ProfileHeader({ data, isSelf, onUpdated, onRefresh, onAdjustWallet }: {
  data: AccountOverview; isSelf: boolean; onUpdated: (u: AccountAdminRow) => void; onRefresh: () => void; onAdjustWallet: () => void;
}) {
  const row = data.account;
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menuOpen]);

  const [lockOpen, setLockOpen] = React.useState(false);
  const [lockReason, setLockReason] = React.useState("");
  const setActive = useMutation({
    mutationFn: (active: boolean) => api.adminSetAccountStatus(row.id, active, active ? undefined : lockReason.trim() || undefined),
    onSuccess: (u, active) => {
      onUpdated(u); onRefresh(); setLockOpen(false); setLockReason("");
      toast.success(active ? "Đã mở khóa tài khoản" : "Đã khóa tài khoản và đăng xuất mọi thiết bị");
    },
    onError: (e, active) => toast.error(apiErrorMessage(e, active ? "Mở khóa thất bại" : "Khóa tài khoản thất bại")),
  });
  const revoke = useMutation({
    mutationFn: () => api.adminRevokeAccountSessions(row.id),
    onSuccess: (r) => { onRefresh(); toast.success(`Đã đăng xuất ${r.revoked} phiên`); },
    onError: (e) => toast.error(apiErrorMessage(e, "Không đăng xuất được")),
  });
  const reset = useMutation({
    mutationFn: () => api.adminSendPasswordReset(row.id),
    onSuccess: () => toast.success(`Đã gửi link đặt lại mật khẩu tới ${row.email}`),
    onError: (e) => toast.error(apiErrorMessage(e, "Không gửi được link")),
  });
  const verify = useMutation({
    mutationFn: () => api.adminVerifyEmail(row.id),
    onSuccess: (u) => { onUpdated(u); toast.success("Đã đánh dấu email xác minh"); },
    onError: (e) => toast.error(apiErrorMessage(e, "Không đánh dấu được")),
  });
  const internal = useMutation({
    mutationFn: (v: boolean) => api.adminUpdateInternal(row.id, v),
    onSuccess: (u, v) => { onUpdated(u); toast.success(v ? "Đã đánh dấu seller nội bộ" : "Đã bỏ đánh dấu nội bộ"); },
    onError: (e) => toast.error(apiErrorMessage(e, "Cập nhật thất bại")),
  });
  const menuItem = (label: string, run: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <button
      type="button"
      role="menuitem"
      disabled={opts.disabled}
      onClick={() => { setMenuOpen(false); run(); }}
      className={cn("block w-full rounded-md px-3 py-2 text-left text-[12.5px] hover:bg-raised/60 disabled:cursor-not-allowed disabled:opacity-50", opts.danger ? "text-bad" : "text-fg")}
    >
      {label}
    </button>
  );
  const canInternal = row.roles.includes("seller") && !row.roles.includes("admin");

  return (
    <header className="rounded-card border border-line bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start gap-3">
        <AccountAvatar email={row.email} locked={!row.is_active} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-all text-[17px] font-semibold text-fg">{row.email}</h2>
            <span className="font-mono text-[12px] text-faint">#{row.id}</span>
            {isSelf && <span className="text-[11.5px] text-faint">(bạn)</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {row.is_active ? <Tag tone="good">Hoạt động</Tag> : <Tag tone="bad">Đã khóa</Tag>}
            {(row.roles.length === 1 ? row.roles : row.roles.filter((r) => r !== "buyer")).map((r) => <Tag key={r} tone={r === "admin" ? "iris" : r === "seller" ? "good" : "neutral"}>{ROLE_LABEL[r] ?? r}</Tag>)}
            {row.roles.includes("seller") && <Tag>{`Hạng ${TIER_VI[row.seller_tier] ?? row.seller_tier}`}</Tag>}
            {row.totp_enabled ? <Tag tone="iris">2FA</Tag> : <Tag>Chưa bật 2FA</Tag>}
            {!row.email_verified && <Tag tone="warn">Chưa xác minh email</Tag>}
            {row.is_internal && <Tag>Nội bộ</Tag>}
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            Tạo {formatDateTime(row.created_at, "vi")} · Đăng nhập gần nhất: {relativeTime(row.last_login_at)}
            {data.application && <> · <Link href={`/admin/seller-applications?status=${data.application.status}&app=${data.application.id}`} className="font-medium text-iris-hi hover:underline">Đơn đăng ký #{data.application.id}</Link></>}
            {data.shop && <> · <a href={data.shop.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-iris-hi hover:underline">{data.shop.name}<ExternalLink size={11} /></a></>}
          </p>
          {data.lock && !row.is_active && (
            <p className="mt-2 rounded-lg border border-bad/25 bg-bad-soft/50 px-3 py-1.5 text-[12.5px] text-fg">
              <span className="font-medium text-bad">Khóa</span>
              {data.lock.at && ` ${formatDateTime(data.lock.at, "vi")}`}
              {data.lock.by_email && ` bởi ${data.lock.by_email}`}
              {data.lock.reason && <> · {data.lock.reason}</>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onAdjustWallet}>Điều chỉnh ví</Button>
          <div ref={menuRef} className="relative">
            <Button size="sm" variant="secondary" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              Thao tác khác <ChevronDown size={13} />
            </Button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-9 z-20 w-60 rounded-lg border border-line bg-card p-1 shadow-card">
                {menuItem("Đăng xuất mọi thiết bị", () => revoke.mutate(), { disabled: isSelf || revoke.isPending })}
                {menuItem("Gửi link đặt lại mật khẩu", () => reset.mutate(), { disabled: reset.isPending })}
                {!row.email_verified && menuItem("Xác nhận email tay", () => verify.mutate(), { disabled: verify.isPending })}
                {canInternal && menuItem(row.is_internal ? "Bỏ đánh dấu seller nội bộ" : "Đánh dấu seller nội bộ", () => internal.mutate(!row.is_internal), { disabled: internal.isPending })}
              </div>
            )}
          </div>
          {row.is_active ? (
            <Button size="sm" variant="danger" disabled={isSelf} title={isSelf ? "Không thể tự khóa tài khoản của chính bạn" : undefined} onClick={() => setLockOpen(true)}>Khóa</Button>
          ) : (
            <Button size="sm" variant="secondary" loading={setActive.isPending} onClick={() => setActive.mutate(true)}>Mở khóa</Button>
          )}
        </div>
      </div>

      <Dialog open={lockOpen} onOpenChange={(o) => { if (!o) setLockOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-fg">Khóa {row.email}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-muted">Khóa đăng xuất mọi thiết bị ngay và chặn đăng nhập lại. Lý do được ghi vào nhật ký và hiện trên hồ sơ.</DialogDescription>
          </DialogHeader>
          <Textarea value={lockReason} onChange={(e) => setLockReason(e.target.value)} maxLength={500} placeholder="Lý do khóa — vd: clone farm, lừa đảo…" className="min-h-[72px] text-[12.5px]" aria-label="Lý do khóa" autoFocus />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="secondary" onClick={() => setLockOpen(false)} disabled={setActive.isPending}>Huỷ</Button>
            <Button variant="danger" loading={setActive.isPending} onClick={() => setActive.mutate(false)}><AlertTriangle size={14} />Khóa tài khoản</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

/* ---------------------------------------------------------------- overview */

function OverviewTab({ data, isSelf, onUpdated }: { data: AccountOverview; isSelf: boolean; onUpdated: (u: AccountAdminRow) => void }) {
  const k = data.kpis;
  const row = data.account;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Số dư khả dụng" value={vnd(k.available_balance)} />
          <Stat label="Chờ nhận (escrow)" value={vnd(k.escrow_incoming)} />
          <Stat label="Doanh số 30 ngày" value={vnd(k.gmv_30d)} />
          <Stat label="Đơn mua / bán" value={`${k.orders_bought} / ${k.orders_sold}`} />
          <Stat label="Khiếu nại" value={String(k.disputes)} tone={k.disputes > 0 ? "bad" : undefined} />
          <Stat label="Tỉ lệ khiếu nại" value={k.dispute_rate_pct === null ? "—" : `${k.dispute_rate_pct.toFixed(1)}%`} />
        </div>
        <Section title="Dòng thời gian" hint="30 sự kiện gần nhất: đăng nhập, đơn, khiếu nại, đổi hạng, thao tác admin.">
          {data.timeline.length === 0 ? <p className="text-[12.5px] text-faint">Chưa có hoạt động nào.</p> : (
            <ol className="space-y-2.5">
              {data.timeline.map((ev, i) => (
                <li key={`${ev.at}-${i}`} className="flex gap-3 text-[12.5px]">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line-2" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-fg">{ev.href ? <Link href={ev.href} className="hover:text-iris-hi hover:underline">{timelineLine(ev, (st) => orderStatus(st, "vi").label)}</Link> : timelineLine(ev, (st) => orderStatus(st, "vi").label)}</p>
                    <p className="font-mono text-[11px] text-faint">{formatDateTime(ev.at, "vi")}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
        <RolesEditor row={row} isSelf={isSelf} onUpdated={onUpdated} />
      </div>
      <aside className="min-w-0 space-y-4">
        <SecurityCard data={data} />
        <Section title="Tài khoản liên quan" danger={data.related.length > 0}>
          <RelatedList related={data.related} compact />
        </Section>
        <AccountNotes id={row.id} />
      </aside>
    </div>
  );
}

function SecurityCard({ data }: { data: AccountOverview }) {
  const row = data.account;
  const fact = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]"><dt className="text-muted">{label}</dt><dd className="text-right text-fg">{value}</dd></div>
  );
  return (
    <Section title="Bảo mật">
      <dl className="divide-y divide-line">
        {fact("Email", row.email_verified ? <Tag tone="good">Đã xác minh</Tag> : <Tag tone="warn">Chưa xác minh</Tag>)}
        {fact("2FA", row.totp_enabled ? <Tag tone="iris">Đang bật</Tag> : <Tag>Chưa bật</Tag>)}
        {fact("Phiên đang mở", <span className="font-mono">{data.sessions_active}</span>)}
        {fact("Đăng nhập gần nhất", relativeTime(row.last_login_at))}
        {(row.risk_flags ?? []).length > 0 && fact("Cảnh báo", <span className="text-bad">{(row.risk_flags ?? []).length}</span>)}
      </dl>
    </Section>
  );
}

function RelatedList({ related, compact }: { related: AccountOverview["related"]; compact?: boolean }) {
  if (related.length === 0) return <p className={cn("text-[12.5px] text-faint", !compact && "rounded-card border border-dashed border-line bg-card px-4 py-10 text-center")}>Không có tài khoản nào dùng chung SĐT hoặc IP.</p>;
  return (
    <ul className={cn("divide-y divide-line", !compact && "rounded-card border border-line bg-card")}>
      {related.map((r) => (
        <li key={`${r.id}-${r.reason}`} className={cn("flex items-center justify-between gap-2 py-2 text-[12.5px]", !compact && "px-4")}>
          <Link href={`/admin/accounts/${r.id}`} className="min-w-0 truncate font-medium text-fg hover:text-iris-hi hover:underline">{r.email}</Link>
          <span className="flex shrink-0 items-center gap-1">
            <Tag tone="bad">{r.reason === "phone" ? "Trùng SĐT" : "Trùng IP"}</Tag>
            {!r.is_active && <Tag tone="bad">Đã khóa</Tag>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AccountNotes({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: ["admin", "account-notes", id], queryFn: () => api.adminAccountNotes(id) });
  const add = useMutation({
    mutationFn: (body: string) => api.adminAddAccountNote(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "account-notes", id] }),
  });
  return (
    <Section title="Ghi chú nội bộ">
      <InternalNotes notes={notes.data} loading={notes.isPending} error={notes.isError} onRetry={() => void notes.refetch()} onAdd={(b) => add.mutateAsync(b)} adding={add.isPending} />
      {add.isError && <p className="mt-2 text-[12px] text-bad">Không lưu được ghi chú.</p>}
    </Section>
  );
}

function ShopCard({ data }: { data: AccountOverview }) {
  return (
    <Section title="Gian hàng">
      <dl className="grid gap-3 text-[12.5px] sm:grid-cols-3">
        <div><dt className="text-muted">Tên</dt><dd className="mt-0.5 text-fg">{data.shop ? <a href={data.shop.path} target="_blank" rel="noreferrer" className="font-medium text-iris-hi hover:underline">{data.shop.name}</a> : "—"}</dd></div>
        <div><dt className="text-muted">Sản phẩm đang bán</dt><dd className="mt-0.5 font-mono text-fg">{data.active_product_count}</dd></div>
        <div>
          <dt className="text-muted">Đơn đăng ký</dt>
          <dd className="mt-0.5 text-fg">
            {data.application ? <Link href={`/admin/seller-applications?status=${data.application.status}&app=${data.application.id}`} className="font-medium text-iris-hi hover:underline">#{data.application.id}{data.application.reviewed_at ? ` · duyệt ${formatDateTime(data.application.reviewed_at, "vi")}` : ""}</Link> : "—"}
          </dd>
        </div>
      </dl>
    </Section>
  );
}

/* ---------------------------------------------------------------- tabs */

function OrdersTab({ row }: { row: AccountAdminRow }) {
  const [side, setSide] = React.useState<"buyer" | "seller">(() => (!row.orders_bought && row.orders_sold ? "seller" : "buyer"));
  const [page, setPage] = React.useState(1);
  const perPage = 20;
  const params = { [side === "buyer" ? "buyer_id" : "seller_id"]: row.id, page, per_page: perPage, sort: "newest" as const };
  const orders = useQuery({ queryKey: ["admin", "account-orders", row.id, side, page], queryFn: () => api.adminOrders(params), placeholderData: (prev) => prev });
  return (
    <div className="space-y-3">
      <div className="flex rounded-lg border border-line bg-card p-0.5 w-fit" role="radiogroup" aria-label="Vai trò trong đơn">
        {(["buyer", "seller"] as const).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={side === s} onClick={() => { setSide(s); setPage(1); }}
            className={cn("rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", side === s ? "bg-iris text-surface" : "text-muted hover:text-fg")}>
            {s === "buyer" ? `Đã mua (${row.orders_bought ?? "…"})` : `Đã bán (${row.orders_sold ?? "…"})`}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card">
        {orders.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : orders.isError ? (
          <p className="px-4 py-10 text-center text-[13px] text-bad">Không tải được đơn. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void orders.refetch()}>Thử lại</Button></p>
        ) : orders.data.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-muted">Chưa có đơn nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12.5px]">
              <thead className="bg-raised/40 text-left text-[11.5px] text-muted">
                <tr><th className="px-4 py-2 font-medium">Mã đơn</th><th className="px-3 py-2 font-medium">Trạng thái</th><th className="px-3 py-2 text-right font-medium">Giá trị</th><th className="px-3 py-2 font-medium">Tạo lúc</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.data.items.map((o) => (
                  <tr key={o.id} className="hover:bg-raised/40">
                    <td className="px-4 py-2"><Link href={`/admin/orders/${o.id}`} className="font-mono font-medium text-iris-hi hover:underline">{o.order_code}</Link></td>
                    <td className="px-3 py-2"><OrderStatusBadge status={o.status} /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-fg">{vnd(o.total_amount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime(o.created_at, "vi")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {orders.data && orders.data.total > perPage && <Pagination page={page} perPage={perPage} total={orders.data.total} onPageChange={setPage} />}
    </div>
  );
}

function DisputesTab({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["admin", "account-disputes", id], queryFn: () => api.adminAccountDisputes(id) });
  if (q.isPending) return <div className="grid place-items-center py-14"><Spinner /></div>;
  if (q.isError) return <p className="rounded-card border border-line bg-card px-4 py-10 text-center text-[13px] text-bad">Không tải được khiếu nại. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void q.refetch()}>Thử lại</Button></p>;
  const list: Dispute[] = Array.isArray(q.data) ? q.data : (q.data as PaginatedDisputes).items;
  if (list.length === 0) return <p className="rounded-card border border-dashed border-line bg-card px-4 py-10 text-center text-[12.5px] text-muted">Không có khiếu nại nào.</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
      {list.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[12.5px]">
          <Link href={`/admin/disputes/${d.id}`} className="font-mono font-medium text-iris-hi hover:underline">KN #{d.id}</Link>
          <DisputeStatusBadge status={d.status} />
          {d.order_code && <Link href={`/admin/orders/${d.order_id}`} className="font-mono text-muted hover:underline">{d.order_code}</Link>}
          <span className="min-w-0 flex-1 truncate text-fg">{d.product_title ?? d.reason}</span>
          <span className="whitespace-nowrap text-faint">{formatDateTime(d.created_at, "vi")}</span>
        </li>
      ))}
    </ul>
  );
}

function SecurityTab({ data, isSelf, onUpdated, onRefresh }: { data: AccountOverview; isSelf: boolean; onUpdated: (u: AccountAdminRow) => void; onRefresh: () => void }) {
  const row = data.account;
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const verify = useMutation({
    mutationFn: () => api.adminVerifyEmail(row.id),
    onSuccess: (u) => { onUpdated(u); toast.success("Đã đánh dấu email xác minh"); },
    onError: (e) => toast.error(apiErrorMessage(e, "Không đánh dấu được")),
  });
  const revoke = useMutation({
    mutationFn: () => api.adminRevokeAccountSessions(row.id),
    onSuccess: (r) => { onRefresh(); toast.success(`Đã đăng xuất ${r.revoked} phiên`); },
    onError: (e) => toast.error(apiErrorMessage(e, "Không đăng xuất được")),
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2.5">
          <div><div className="text-[13px] font-medium text-fg">Email</div><div className="text-[11.5px] text-muted">{row.email_verified ? "Đã xác minh" : "Chưa xác minh"}</div></div>
          {row.email_verified ? <Tag tone="good">Đã xác minh</Tag> : <Button size="sm" variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>Xác nhận tay</Button>}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2.5">
          <div><div className="text-[13px] font-medium text-fg">2FA</div><div className="text-[11.5px] text-muted">Người dùng tự bật ở trang Bảo mật.</div></div>
          {row.totp_enabled ? <Tag tone="iris">Đang bật</Tag> : <Tag>Chưa bật</Tag>}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2.5">
          <div><div className="text-[13px] font-medium text-fg">Phiên đang mở</div><div className="font-mono text-[11.5px] text-muted">{data.sessions_active}</div></div>
          <Button size="sm" variant="secondary" disabled={isSelf || data.sessions_active === 0} loading={revoke.isPending} onClick={() => revoke.mutate()}>Đăng xuất tất cả</Button>
        </div>
      </div>
      <LoginsTable row={row} />
    </div>
  );
}

function LogsTab({ id }: { id: number }) {
  const logs = useQuery({ queryKey: ["admin", "account-logs", id], queryFn: () => api.adminLogsFor({ account_id: id, limit: 30 }) });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted">30 bản ghi gần nhất liên quan đến tài khoản.</p>
        <Link href={`/admin/logs?account=${id}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">Mở trong Nhật ký <ExternalLink size={12} /></Link>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card">
        {logs.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : logs.isError ? (
          <p className="px-4 py-10 text-center text-[13px] text-bad">Không tải được nhật ký. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void logs.refetch()}>Thử lại</Button></p>
        ) : logs.data.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-muted">Chưa có bản ghi nào.</p>
        ) : (
          <ul className="divide-y divide-line">
            {logs.data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[12.5px]">
                <span className="whitespace-nowrap font-mono text-[11px] text-faint">{formatDateTime(l.created_at, "vi")}</span>
                <Tag tone={l.level === "error" ? "bad" : l.level === "warning" ? "warn" : "neutral"}>{l.level}</Tag>
                <span className="min-w-0 flex-1 break-words text-fg">{l.message}</span>
                {l.actor && <span className="text-muted">{l.actor.label}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
