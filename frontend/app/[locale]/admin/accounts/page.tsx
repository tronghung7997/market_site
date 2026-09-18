"use client";

import * as React from "react";
import { motion } from "motion/react";
import type { AccountAdminRow } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { Button, Card, Input, Spinner, Tag } from "@/components/ui";
import { SearchInput, Pagination, SlidePanel } from "@/components/admin";
import { MoneyInput } from "@/components/MoneyInput";
import { api, vnd } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AdminAccountWallet, LoginEvent, Transaction } from "@/lib/types";
import { cn } from "@/lib/cn";
import { SELLER_TIERS, sellerTierLabel } from "@/lib/seller-tier";

const ROLES: { key: string; label: string }[] = [
  { key: "buyer", label: "Người mua" },
  { key: "seller", label: "Người bán" },
  { key: "admin", label: "Quản trị" },
];

function sameRoles(a: string[], b: string[]) {
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

export default function AdminAccountsPage() {
  const apiErrorMessage = useApiErrorMessage();
  const { account: me } = useAuth();
  const [search, setSearch] = React.useState("");
  const [applied, setApplied] = React.useState("");
  const [page, setPage] = React.useState(1);
  const perPage = 20;

  const [data, setData] = React.useState<{ items: AccountAdminRow[]; total: number } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState<Record<number, string[]>>({});
  const [savingId, setSavingId] = React.useState<number | null>(null);
  const [tierSavingId, setTierSavingId] = React.useState<number | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminAccounts({ search: applied || undefined, page, per_page: perPage });
      setData(res);
      setDraft(Object.fromEntries(res.items.map((u) => [u.id, u.roles])));
    } finally {
      setLoading(false);
    }
  }, [applied, page]);
  React.useEffect(() => { load(); }, [load]);

  const onSearch = (val: string) => { setSearch(val); setApplied(val); setPage(1); };

  const toggle = (row: AccountAdminRow, role: string) => {
    setErr(null);
    setDraft((d) => {
      const cur = d[row.id] ?? row.roles;
      const next = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
      return { ...d, [row.id]: next };
    });
  };

  const save = async (row: AccountAdminRow) => {
    const roles = draft[row.id] ?? row.roles;
    setSavingId(row.id); setErr(null);
    try {
      const updated = await api.adminUpdateRoles(row.id, roles);
      setData((d) => d ? { ...d, items: d.items.map((u) => u.id === row.id ? updated : u) } : d);
      setDraft((dr) => ({ ...dr, [row.id]: updated.roles }));
    } catch (e) {
      setErr(apiErrorMessage(e, "Cập nhật vai trò thất bại"));
      setDraft((dr) => ({ ...dr, [row.id]: row.roles })); // revert
    } finally {
      setSavingId(null);
    }
  };

  // ─── Panel "Ví" — xem số dư + giao dịch của user bất kỳ, topup tay ───
  const [walletFor, setWalletFor] = React.useState<AccountAdminRow | null>(null);
  const [walletInfo, setWalletInfo] = React.useState<AdminAccountWallet | null>(null);
  const [walletTxs, setWalletTxs] = React.useState<Transaction[] | null>(null);
  const [topupAmount, setTopupAmount] = React.useState("");
  const [topupReason, setTopupReason] = React.useState("");
  const [topupBusy, setTopupBusy] = React.useState(false);
  const [walletMsg, setWalletMsg] = React.useState<string | null>(null);

  const openWallet = async (row: AccountAdminRow) => {
    setWalletFor(row);
    setWalletInfo(null); setWalletTxs(null); setWalletMsg(null); setTopupAmount(""); setTopupReason("");
    const [w, t] = await Promise.allSettled([
      api.adminAccountWallet(row.id),
      api.adminAccountTransactions(row.id),
    ]);
    if (w.status === "fulfilled") setWalletInfo(w.value);
    setWalletTxs(t.status === "fulfilled" ? t.value : []);
  };

  const doTopup = async () => {
    if (!walletFor) return;
    const amount = parseInt(topupAmount) || 0;
    const reason = topupReason.trim();
    if (amount <= 0 || reason.length < 3) return;
    setTopupBusy(true); setWalletMsg(null);
    try {
      await api.adminTopup(walletFor.id, amount, reason);
      setTopupAmount(""); setTopupReason("");
      await openWallet(walletFor);
      setWalletMsg(`Đã cộng ${vnd(amount)} vào ví ${walletFor.email}.`);
    } catch (e) {
      setWalletMsg(`Topup thất bại: ${apiErrorMessage(e, "Topup thất bại")}`);
    } finally {
      setTopupBusy(false);
    }
  };

  // ─── Khóa / mở khóa: xác nhận 2 bước ngay trên dòng, không dùng window.confirm ───
  const [lockFor, setLockFor] = React.useState<AccountAdminRow | null>(null);
  const [lockReason, setLockReason] = React.useState("");
  const [lockBusy, setLockBusy] = React.useState(false);

  const setActive = async (row: AccountAdminRow, isActive: boolean) => {
    setLockBusy(true); setErr(null);
    try {
      const updated = await api.adminSetAccountStatus(row.id, isActive, isActive ? undefined : lockReason.trim() || undefined);
      setData((d) => d ? { ...d, items: d.items.map((u) => u.id === row.id ? updated : u) } : d);
      setLockFor(null); setLockReason("");
    } catch (e) {
      setErr(apiErrorMessage(e, isActive ? "Mở khóa thất bại" : "Khóa tài khoản thất bại"));
    } finally {
      setLockBusy(false);
    }
  };

  // ─── Panel "Đăng nhập" — lịch sử IP / thiết bị của một user ───
  const [loginFor, setLoginFor] = React.useState<AccountAdminRow | null>(null);
  const [loginEvents, setLoginEvents] = React.useState<LoginEvent[] | null>(null);
  const openLoginHistory = async (row: AccountAdminRow) => {
    setLoginFor(row); setLoginEvents(null);
    try {
      setLoginEvents(await api.adminLoginEvents(row.id, 100));
    } catch {
      setLoginEvents([]);
    }
  };

  const changeTier = async (row: AccountAdminRow, tier: string) => {
    setTierSavingId(row.id); setErr(null);
    try {
      const updated = await api.adminUpdateSellerTier(row.id, tier);
      setData((d) => d ? { ...d, items: d.items.map((u) => u.id === row.id ? updated : u) } : d);
    } catch (e) {
      setErr(apiErrorMessage(e, "Cập nhật cấp độ thất bại"));
    } finally {
      setTierSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Tài khoản</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Quản lý vai trò người dùng (người mua / người bán / quản trị)</p>
        </div>
        <SearchInput value={search} onChange={onSearch} placeholder="Tìm theo email…" />
      </div>

      {err && <p className="text-[13px] text-red-600">{err}</p>}

      {loading || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-5 py-2.5 font-medium">Email</th>
                    <th className="px-5 py-2.5 font-medium">Vai trò</th>
                    <th className="px-5 py-2.5 font-medium">Cấp độ người bán</th>
                    <th className="px-5 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-5 py-2.5 font-medium w-24" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => {
                    const roles = draft[row.id] ?? row.roles;
                    const dirty = !sameRoles(roles, row.roles);
                    const isSelf = me?.id === row.id;
                    return (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-5 py-3 text-slate-700">
                          {row.email}
                          {isSelf && <span className="ml-2 text-[11px] text-slate-400">(bạn)</span>}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {ROLES.map((r) => {
                              const on = roles.includes(r.key);
                              return (
                                <button
                                  key={r.key}
                                  onClick={() => toggle(row, r.key)}
                                  className={cn(
                                    "px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors",
                                    on
                                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                      : "bg-white border-slate-200 text-slate-400 hover:border-slate-300",
                                  )}
                                >
                                  {r.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {roles.includes("seller") ? (
                            <select
                              value={row.seller_tier}
                              disabled={tierSavingId === row.id}
                              onChange={(e) => changeTier(row, e.target.value)}
                              className="h-8 rounded-lg bg-white border border-slate-200 px-2 text-[12px] text-slate-700 disabled:opacity-50"
                            >
                              {SELLER_TIERS.map((t) => (
                                <option key={t} value={t}>{sellerTierLabel(t)}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {row.is_active ? <Tag tone="good">Hoạt động</Tag> : <Tag tone="bad">Đã khóa</Tag>}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          {lockFor?.id === row.id ? (
                            <div className="flex items-center gap-2 justify-end">
                              <Input
                                value={lockReason}
                                onChange={(e) => setLockReason(e.target.value)}
                                placeholder="Lý do khóa (tuỳ chọn)"
                                className="h-8 w-48 text-[12px]"
                                maxLength={500}
                                autoFocus
                              />
                              <Button size="sm" variant="danger" disabled={lockBusy} onClick={() => setActive(row, false)}>
                                {lockBusy ? "…" : "Xác nhận khóa"}
                              </Button>
                              <Button size="sm" variant="ghost" disabled={lockBusy} onClick={() => { setLockFor(null); setLockReason(""); }}>
                                Hủy
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="secondary" onClick={() => openWallet(row)}>
                                Ví
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => openLoginHistory(row)}>
                                Đăng nhập
                              </Button>
                              {!isSelf && (row.is_active ? (
                                <Button size="sm" variant="ghost" onClick={() => { setLockFor(row); setLockReason(""); }}>
                                  Khóa
                                </Button>
                              ) : (
                                <Button size="sm" variant="secondary" disabled={lockBusy} onClick={() => setActive(row, true)}>
                                  Mở khóa
                                </Button>
                              ))}
                              {dirty && (
                                <Button size="sm" disabled={savingId === row.id} onClick={() => save(row)}>
                                  {savingId === row.id ? "…" : "Lưu"}
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {data.items.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500">Không tìm thấy tài khoản nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Pagination page={page} perPage={perPage} total={data.total} onPageChange={setPage} />
        </motion.div>
      )}

      <SlidePanel
        isOpen={walletFor !== null}
        onClose={() => setWalletFor(null)}
        title={walletFor ? `Ví — ${walletFor.email}` : ""}
        width="lg"
      >
        {walletInfo === null ? (
          <div className="grid place-items-center py-12"><Spinner /></div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-slate-500">Khả dụng</div>
                <div className="font-mono text-[16px] font-semibold tabular-nums mt-1">{vnd(walletInfo.available_balance)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-slate-500">Đang khoá (chờ rút)</div>
                <div className="font-mono text-[16px] font-semibold tabular-nums mt-1">{vnd(walletInfo.locked_balance)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-slate-500">Đang giữ (đã mua, chờ hoàn tất)</div>
                <div className="font-mono text-[16px] font-semibold tabular-nums mt-1">{vnd(walletInfo.escrow_paid)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-slate-500">Chờ nhận (đã bán, chờ hoàn tất)</div>
                <div className="font-mono text-[16px] font-semibold tabular-nums mt-1">{vnd(walletInfo.escrow_incoming)}</div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4 space-y-2">
              <div className="text-[12px] font-semibold text-slate-700">Cộng tiền tay (topup)</div>
              <div className="flex gap-2">
                <MoneyInput value={topupAmount} onValueChange={setTopupAmount} placeholder="Số tiền" className="flex-1" />
                <Button size="sm" disabled={topupBusy || !topupAmount || topupReason.trim().length < 3} onClick={doTopup}>
                  {topupBusy ? "…" : "Cộng ví"}
                </Button>
              </div>
              <Input
                value={topupReason}
                onChange={(e) => setTopupReason(e.target.value)}
                placeholder="Lý do (bắt buộc) — vd: đền bù đơn ORD-…, đối soát nạp ngày …"
                maxLength={500}
                className="h-9 text-[12.5px]"
              />
              <p className="text-[11px] text-slate-400">
                Ghi sổ dạng &quot;Admin topup — lý do&quot; và lưu nhật ký kèm IP người thao tác — chỉ dùng cho đền bù/đối soát, nạp thường đi qua cổng thanh toán.
              </p>
              {walletMsg && <p className="text-[12px] text-emerald-700">{walletMsg}</p>}
            </div>

            <div>
              <div className="text-[12px] font-semibold text-slate-700 mb-2">
                Giao dịch gần đây {walletTxs ? `(${walletTxs.length})` : ""}
              </div>
              {walletTxs === null ? (
                <Spinner />
              ) : walletTxs.length === 0 ? (
                <p className="text-[13px] text-slate-500">Chưa có giao dịch nào.</p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {walletTxs.slice(0, 30).map((t) => (
                    <div key={t.id} className="px-3.5 py-2.5 flex items-center gap-3 text-[12.5px] bg-white">
                      <span className={cn(
                        "shrink-0 grid place-items-center h-6 w-6 rounded text-[12px] font-bold",
                        t.direction === "in" ? "bg-emerald-50 text-emerald-600"
                          : t.direction === "out" ? "bg-red-50 text-red-500" : "bg-slate-100 text-slate-400",
                      )}>
                        {t.direction === "in" ? "+" : t.direction === "out" ? "−" : "•"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-slate-700">{t.description ?? t.type}</div>
                        <div className="text-[11px] text-slate-400 font-mono truncate">
                          {new Date(t.created_at).toLocaleString("vi-VN")}{t.reference_id ? ` · ${t.reference_id}` : ""}
                        </div>
                      </div>
                      <span className={cn(
                        "font-mono font-semibold tabular-nums shrink-0",
                        t.direction === "in" ? "text-emerald-600" : t.direction === "out" ? "text-red-500" : "text-slate-400",
                      )}>
                        {t.direction === "neutral" ? "" : t.direction === "in" ? "+" : "−"}{vnd(t.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SlidePanel>

      <SlidePanel
        isOpen={loginFor !== null}
        onClose={() => setLoginFor(null)}
        title={loginFor ? `Lịch sử đăng nhập — ${loginFor.email}` : ""}
        width="lg"
      >
        {loginEvents === null ? (
          <div className="grid place-items-center py-12"><Spinner /></div>
        ) : loginEvents.length === 0 ? (
          <p className="text-[13px] text-slate-500">Chưa có lượt đăng nhập nào được ghi nhận.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 font-medium">Thời gian</th>
                  <th className="px-3 py-2 font-medium">Sự kiện</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">Thiết bị</th>
                </tr>
              </thead>
              <tbody>
                {loginEvents.map((ev) => (
                  <tr key={ev.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono text-[11.5px] text-slate-500 whitespace-nowrap">{new Date(ev.created_at).toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <LoginEventTag kind={ev.kind} outcome={ev.outcome} actorId={ev.actor_id} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-slate-700">{ev.ip ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-[260px] truncate" title={ev.user_agent ?? undefined}>{ev.user_agent ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SlidePanel>
    </div>
  );
}

function LoginEventTag({ kind, outcome, actorId }: { kind: string; outcome: string; actorId: number | null }) {
  if (kind === "locked") return <Tag tone="bad">Bị khóa{actorId ? ` (admin #${actorId})` : ""}</Tag>;
  if (kind === "unlocked") return <Tag tone="warn">Mở khóa{actorId ? ` (admin #${actorId})` : ""}</Tag>;
  const label = kind === "admin_login" ? "Đăng nhập admin" : "Đăng nhập";
  if (outcome === "success") return <Tag tone="good">{label} ✓</Tag>;
  if (outcome === "inactive") return <Tag tone="neutral">{label} — tài khoản đang khóa</Tag>;
  return <Tag tone="bad">{label} — sai mật khẩu</Tag>;
}
