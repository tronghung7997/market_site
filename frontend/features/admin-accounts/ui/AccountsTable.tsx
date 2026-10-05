"use client";

/** The directory's data surface: a sortable table on desktop, labelled
 *  stacked records on phones (DESIGN.md §10). Rows open /admin/accounts/{id};
 *  checkbox and the ⋯ menu sit above the row link. */

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { AccountAdminRow } from "@/lib/types";
import { Tag } from "@/components/ui";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, More } from "@/components/Icons";
import { AccountAvatar, AccountFlags, ROLE_LABEL, TIER_VI, relativeTime } from "./shared";
import { ariaSort, lockLine, RISK_FLAG_LABEL, sortState, type AccountsFilters } from "../model";

type SortProps = { filters: Pick<AccountsFilters, "sort" | "dir">; onSort: (key: string) => void };

/** Optional columns the viewer can hide (Tài khoản, checkbox and ⋯ always show). */
export const OPTIONAL_COLUMNS = [
  { key: "created", label: "Ngày tạo" },
  { key: "login", label: "Đăng nhập" },
  { key: "balance", label: "Số dư" },
  { key: "deposited", label: "Đã nạp" },
  { key: "buy", label: "Mua" },
  { key: "sell", label: "Bán" },
  { key: "disputes", label: "Khiếu nại" },
  { key: "risk", label: "Rủi ro" },
] as const;
export type ColumnKey = (typeof OPTIONAL_COLUMNS)[number]["key"];

export interface RowActions {
  onCopyEmail: (row: AccountAdminRow) => void;
  onLock: (row: AccountAdminRow) => void;
  onUnlock: (row: AccountAdminRow) => void;
}

function SortButton({ label, sortKey, filters, onSort, align = "left", title }: SortProps & {
  label: string; sortKey: string; align?: "left" | "right"; title?: string;
}) {
  const state = sortState(filters);
  const on = state.key === sortKey;
  const Icon = !on ? ChevronsUpDown : state.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-0.5 -mx-1 font-medium whitespace-nowrap transition-colors",
        "hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
        align === "right" && "flex-row-reverse",
        on ? "text-fg" : "text-muted",
      )}
    >
      {label}
      <Icon size={12} className={cn("shrink-0", on ? "text-iris-hi" : "text-faint")} aria-hidden />
    </button>
  );
}

function SortTh({ sortKey, label, align = "left", className, ...sort }: SortProps & {
  sortKey: string; label: string; align?: "left" | "right"; className?: string;
}) {
  return (
    <th aria-sort={ariaSort(sort.filters, sortKey)} className={cn("px-3 py-2.5", align === "right" && "text-right", className)}>
      <SortButton label={label} sortKey={sortKey} align={align} {...sort} />
    </th>
  );
}

/** Two sort keys in one header ("Mua": amount · count). aria-sort follows whichever is active. */
function PairTh({ label, money, count, ...sort }: SortProps & { label: string; money: string; count: string }) {
  const active = ariaSort(sort.filters, money) !== "none" ? money : count;
  return (
    <th aria-sort={ariaSort(sort.filters, active)} className="px-3 py-2.5 text-right">
      <span className="inline-flex items-center gap-2">
        <SortButton label={`${label} ₫`} sortKey={money} align="right" title={`Sắp xếp theo tiền ${label.toLowerCase()}`} {...sort} />
        <span className="text-faint" aria-hidden>·</span>
        <SortButton label="đơn" sortKey={count} align="right" title={`Sắp xếp theo số đơn ${label.toLowerCase()}`} {...sort} />
      </span>
    </th>
  );
}

function RowMenu({ row, isSelf, actions }: { row: AccountAdminRow; isSelf: boolean; actions: RowActions }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); ref.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const item = "flex w-full items-center rounded-md px-2.5 py-2 text-left text-[12.5px] text-fg hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline-none";
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} className="relative z-[2]">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Thao tác với ${row.email}`}
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40"
      >
        <More size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-30 w-52 rounded-lg border border-line bg-card p-1 shadow-card">
          <Link role="menuitem" href={`/admin/accounts/${row.id}`} className={item}>Mở hồ sơ</Link>
          <Link role="menuitem" href={`/admin/accounts/${row.id}?tab=orders`} className={item}>Xem đơn hàng</Link>
          <button role="menuitem" type="button" className={item} onClick={run(() => actions.onCopyEmail(row))}>Sao chép email</button>
          <div className="my-1 border-t border-line" />
          {row.is_active ? (
            <button role="menuitem" type="button" disabled={isSelf} className={cn(item, "text-bad disabled:cursor-not-allowed disabled:opacity-50")} onClick={run(() => actions.onLock(row))}>
              {isSelf ? "Không thể tự khóa" : "Khóa tài khoản…"}
            </button>
          ) : (
            <button role="menuitem" type="button" className={item} onClick={run(() => actions.onUnlock(row))}>Mở khóa</button>
          )}
        </div>
      )}
    </div>
  );
}

function Money({ value, muted }: { value: number | undefined; muted?: boolean }) {
  if (!value) return <span className="text-faint">—</span>;
  return <span className={muted ? "text-muted" : "text-fg"}>{vnd(value)}</span>;
}

function RoleTags({ row }: { row: AccountAdminRow }) {
  const roles = row.roles.length === 1 ? row.roles : row.roles.filter((r) => r !== "buyer");
  return (
    <>
      {roles.map((r) => <Tag key={r} tone={r === "admin" ? "iris" : r === "seller" ? "good" : "neutral"}>{ROLE_LABEL[r] ?? r}</Tag>)}
      {row.roles.includes("seller") && (
        <Tag tone={row.seller_tier === "enterprise" || row.seller_tier === "trusted" ? "good" : "neutral"}>{TIER_VI[row.seller_tier] ?? row.seller_tier}</Tag>
      )}
    </>
  );
}

function RiskCell({ row }: { row: AccountAdminRow }) {
  const flags = row.risk_flags ?? [];
  const ip = row.shared_ip_accounts ?? 0;
  const phone = row.shared_phone_accounts ?? 0;
  if (!flags.length && !ip && !phone) return <span className="text-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => <Tag key={f} tone="bad">{RISK_FLAG_LABEL[f] ?? f}</Tag>)}
      {ip > 0 && <Tag tone="warn"><span title="Số tài khoản khác từng dùng chung IP công khai">Chung IP · {ip}</span></Tag>}
      {phone > 0 && !flags.includes("shared_phone") && <Tag tone="warn"><span title="Số tài khoản khác dùng chung SĐT">Chung SĐT · {phone}</span></Tag>}
    </div>
  );
}

function When({ iso, empty }: { iso: string | null | undefined; empty: string }) {
  if (!iso) return <span className="text-faint">{empty}</span>;
  return <time dateTime={iso} title={formatDateTime(iso, "vi")}>{relativeTime(iso)}</time>;
}

function RowLink({ row, className, children }: { row: AccountAdminRow; className?: string; children: React.ReactNode }) {
  // The link's ::after covers the row, so the whole row (or card) opens the account.
  return (
    <Link
      href={`/admin/accounts/${row.id}`}
      className={cn(
        "min-w-0 truncate font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-iris/50",
        row.is_active ? "text-fg" : "text-muted line-through decoration-bad/50",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function AccountsTable({ items, meId, selected, onToggle, allOnPage, onToggleAll, hidden, actions, ...sort }: SortProps & {
  items: AccountAdminRow[];
  meId: number | undefined;
  selected: Set<number>;
  onToggle: (id: number) => void;
  allOnPage: boolean;
  onToggleAll: () => void;
  hidden: Set<ColumnKey>;
  actions: RowActions;
}) {
  const show = (k: ColumnKey) => !hidden.has(k);
  return (
    <>
      {/* Desktop / tablet: one header, aligned rows. */}
      <div className="hidden overflow-x-auto md:block" role="region" aria-label="Bảng tài khoản" tabIndex={0}>
        <table className="w-full min-w-[960px] text-[13px]">
          <thead className="bg-raised/40 text-left text-[12px] text-muted">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" aria-label="Chọn cả trang" className="accent-[var(--color-iris)]" checked={allOnPage} onChange={onToggleAll} />
              </th>
              <SortTh sortKey="email" label="Tài khoản" {...sort} />
              {show("created") && <SortTh sortKey="created" label="Ngày tạo" {...sort} />}
              {show("login") && <SortTh sortKey="last_login" label="Đăng nhập" {...sort} />}
              {show("balance") && <SortTh sortKey="balance" label="Số dư" align="right" {...sort} />}
              {show("deposited") && <SortTh sortKey="deposited" label="Đã nạp" align="right" {...sort} />}
              {show("buy") && <PairTh label="Mua" money="spent" count="orders_bought" {...sort} />}
              {show("sell") && <PairTh label="Bán" money="revenue" count="orders_sold" {...sort} />}
              {show("disputes") && <SortTh sortKey="disputes" label="KN mở" align="right" {...sort} />}
              {show("risk") && <SortTh sortKey="risk" label="Rủi ro" {...sort} />}
              <th className="w-12 px-2 py-2.5"><span className="sr-only">Thao tác</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((row) => {
              const isSelf = meId === row.id;
              const lock = lockLine(row);
              return (
                <tr key={row.id} className={cn("group relative transition-colors hover:bg-raised/40 focus-within:bg-raised/40", !row.is_active && "bg-bad-soft/20", selected.has(row.id) && "bg-iris-soft/40")}>
                  <td className="relative z-[1] px-3 py-2.5 align-top">
                    <input type="checkbox" aria-label={`Chọn ${row.email}`} className="mt-1.5 accent-[var(--color-iris)]" disabled={isSelf} checked={selected.has(row.id)} onChange={() => onToggle(row.id)} />
                  </td>
                  <td className="max-w-[340px] px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <AccountAvatar email={row.email} locked={!row.is_active} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <RowLink row={row}>{row.email}</RowLink>
                          {isSelf && <span className="shrink-0 text-[11px] text-faint">(bạn)</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11.5px] text-faint">
                          <span className="font-mono">#{row.id}</span>
                          {row.shop_name && <span className="max-w-[160px] truncate text-muted" title={row.shop_name}>{row.shop_name}</span>}
                          <RoleTags row={row} />
                          <AccountFlags row={row} />
                        </div>
                        {lock && <div className="mt-0.5 max-w-[300px] truncate text-[11.5px] text-bad" title={lock}>{lock}</div>}
                      </div>
                    </div>
                  </td>
                  {show("created") && <td className="whitespace-nowrap px-3 py-2.5 text-muted"><time dateTime={row.created_at} title={formatDateTime(row.created_at, "vi")}>{formatDate(row.created_at, "vi")}</time></td>}
                  {show("login") && <td className="whitespace-nowrap px-3 py-2.5 text-muted"><When iso={row.last_login_at} empty="Chưa đăng nhập" /></td>}
                  {show("balance") && (
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                      <Money value={row.available_balance} />
                      {(row.locked_balance ?? 0) > 0 && <div className="text-[11px] text-warn" title="Đang khóa chờ rút">khóa {vnd(row.locked_balance ?? 0)}</div>}
                    </td>
                  )}
                  {show("deposited") && <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums"><Money value={row.total_deposited} muted /></td>}
                  {show("buy") && (
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                      <Money value={row.total_spent} />
                      <div className="text-[11px] text-faint">{row.orders_bought ?? 0} đơn</div>
                    </td>
                  )}
                  {show("sell") && (
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                      {row.roles.includes("seller") || (row.orders_sold ?? 0) > 0 ? (
                        <><Money value={row.total_revenue} /><div className="text-[11px] text-faint">{row.orders_sold ?? 0} đơn</div></>
                      ) : <span className="text-faint">—</span>}
                    </td>
                  )}
                  {show("disputes") && (
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                      {(row.open_disputes ?? 0) > 0 ? <span className="font-semibold text-bad">{row.open_disputes}</span> : <span className="text-faint">—</span>}
                    </td>
                  )}
                  {show("risk") && <td className="px-3 py-2.5"><RiskCell row={row} /></td>}
                  <td className="relative z-[1] px-2 py-2.5">
                    <div className="flex items-center justify-end">
                      <RowMenu row={row} isSelf={isSelf} actions={actions} />
                      <ChevronRight size={14} className="hidden text-faint xl:block" aria-hidden />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phones: labelled stacked records. */}
      <ul className="divide-y divide-line md:hidden">
        {items.map((row) => {
          const isSelf = meId === row.id;
          const lock = lockLine(row);
          return (
            <li key={row.id} className={cn("relative px-3 py-3", !row.is_active && "bg-bad-soft/20", selected.has(row.id) && "bg-iris-soft/40")}>
              <div className="flex items-start gap-2.5">
                <label className="relative z-[1] -m-2 grid h-11 w-11 shrink-0 place-items-center">
                  <input type="checkbox" aria-label={`Chọn ${row.email}`} className="h-4 w-4 accent-[var(--color-iris)]" disabled={isSelf} checked={selected.has(row.id)} onChange={() => onToggle(row.id)} />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <RowLink row={row} className="text-[13.5px]">{row.email}</RowLink>
                    {isSelf && <span className="shrink-0 text-[11px] text-faint">(bạn)</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[11.5px] text-faint">
                    <span className="font-mono">#{row.id}</span>
                    {row.shop_name && <span className="truncate text-muted">{row.shop_name}</span>}
                    <RoleTags row={row} />
                    <AccountFlags row={row} />
                  </div>
                  {lock && <div className="mt-0.5 truncate text-[11.5px] text-bad">{lock}</div>}
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                    <dt className="text-muted">Số dư</dt><dd className="text-right font-mono tabular-nums"><Money value={row.available_balance} /></dd>
                    <dt className="text-muted">Mua</dt><dd className="text-right font-mono tabular-nums"><Money value={row.total_spent} /> <span className="text-faint">· {row.orders_bought ?? 0} đơn</span></dd>
                    {(row.roles.includes("seller") || (row.orders_sold ?? 0) > 0) && (
                      <><dt className="text-muted">Bán</dt><dd className="text-right font-mono tabular-nums"><Money value={row.total_revenue} /> <span className="text-faint">· {row.orders_sold ?? 0} đơn</span></dd></>
                    )}
                    <dt className="text-muted">Đăng nhập</dt><dd className="text-right text-muted"><When iso={row.last_login_at} empty="Chưa đăng nhập" /></dd>
                    {(row.open_disputes ?? 0) > 0 && <><dt className="text-muted">Khiếu nại mở</dt><dd className="text-right font-semibold text-bad">{row.open_disputes}</dd></>}
                  </dl>
                  <div className="mt-1.5"><RiskCell row={row} /></div>
                </div>
                <div className="relative z-[1]"><RowMenu row={row} isSelf={isSelf} actions={actions} /></div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
