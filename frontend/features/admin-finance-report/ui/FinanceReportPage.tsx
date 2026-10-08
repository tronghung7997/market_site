"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import type { FinanceBalance, FinanceFlows, FinanceReport } from "@/lib/types";
import { Button, Input, Skeleton, Tag, buttonClass } from "@/components/ui";
import { DateInput } from "@/components/ui/DateInput";
import { orderedDateRange } from "@/lib/date-input";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download } from "@/components/Icons";
import { LedgerReconcilePanel } from "@/features/admin-ledger";
import { InfoTip } from "@/components/admin";
import { useClosedPeriods, useFinanceReport } from "../data";
import {
  KINDS, ledgerHref, parsePeriod, percentChange, periodAt, periodEnded, periodLabel, periodRange, periodToParams,
  shift, vnToday, type Period,
} from "../model";
import { CloseDialog } from "./CloseDialog";

const PROVIDER_LABEL: Record<string, string> = { sepay: "Chuyển khoản (SePay)", nowpayments: "USDT (NOWPayments)", payos: "PayOS" };

/**
 * Tài chính › Báo cáo: sàn lãi bao nhiêu trong kỳ, tiền giữ hộ nằm ở đâu,
 * sổ có khớp không — và chốt kỳ / xuất gói cho kế toán.
 */
export function FinanceReportPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const period = React.useMemo(() => parsePeriod(new URLSearchParams(searchParams.toString())), [searchParams]);
  const setPeriod = (p: Period) => router.replace(`${pathname}?${periodToParams(p).toString()}`, { scroll: false });
  const range = React.useMemo(() => periodRange(period), [period]);
  const reportQ = useFinanceReport(range);
  const closesQ = useClosedPeriods();
  const [closing, setClosing] = React.useState(false);
  const data = reportQ.data;

  return (
    <div className="space-y-4">
      <PeriodBar
        period={period}
        setPeriod={setPeriod}
        actions={
          <>
            {data?.closed ? (
              <Tag tone="good"><CheckCircle2 size={12} /> Đã chốt {formatDateTime(data.closed.closed_at, "vi")}</Tag>
            ) : <Tag>Chưa chốt kỳ</Tag>}
            <a href={api.adminFinanceExportUrl(range)} download className={buttonClass({ variant: "secondary", size: "sm" })}>
              <Download size={14} /> Xuất gói kế toán
            </a>
            {!data?.closed && (
              <Button size="sm" onClick={() => setClosing(true)} disabled={!periodEnded(period)} title={periodEnded(period) ? undefined : "Kỳ chưa kết thúc"}>
                Chốt kỳ…
              </Button>
            )}
          </>
        }
      />

      {reportQ.isError ? (
        <div className="space-y-3 rounded-xl border border-line bg-surface px-4 py-10 text-center">
          <p className="text-[13px] text-bad">Không tổng hợp được báo cáo cho kỳ này.</p>
          <Button variant="secondary" size="sm" onClick={() => reportQ.refetch()}>Thử lại</Button>
        </div>
      ) : !data ? (
        <div className="space-y-4"><Skeleton className="h-[96px] rounded-xl" /><Skeleton className="h-[380px] rounded-xl" /></div>
      ) : (
        <div className={cn("space-y-4 transition-opacity", reportQ.isFetching && "opacity-70")} aria-busy={reportQ.isFetching}>
          <Headline cur={data.current} prev={data.previous} />
          <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
            <ProfitTable data={data} period={period} />
            <BalanceCard balance={data.balance} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Channels data={data} period={period} />
            <TopSellers data={data} />
            <Programs data={data} period={period} />
          </div>
        </div>
      )}

      <ClosedPeriods rows={closesQ.data} loading={closesQ.isLoading} error={closesQ.isError} onOpen={(p) => setPeriod(p)} />
      <LedgerReconcilePanel />

      <CloseDialog open={closing} onClose={() => setClosing(false)} period={period} range={range} />
    </div>
  );
}

function PeriodBar({ period, setPeriod, actions }: { period: Period; setPeriod: (p: Period) => void; actions: React.ReactNode }) {
  const today = vnToday();
  const next = shift(period, 1);
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-line-2 bg-surface">
          <button type="button" aria-label="Kỳ trước" onClick={() => setPeriod(shift(period, -1))} className="inline-flex h-9 w-9 items-center justify-center text-muted hover:text-fg">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[150px] px-2 text-center text-[13px] font-semibold tabular-nums text-fg">{periodLabel(period)}</span>
          <button type="button" aria-label="Kỳ sau" disabled={next.from > today} onClick={() => setPeriod(next)} className="inline-flex h-9 w-9 items-center justify-center text-muted hover:text-fg disabled:opacity-40">
            <ChevronRight size={16} />
          </button>
        </div>
        <div role="radiogroup" aria-label="Loại kỳ" className="flex rounded-lg border border-line-2 bg-surface p-0.5">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              role="radio"
              aria-checked={period.kind === k.key}
              onClick={() => setPeriod(k.key === "custom" ? { kind: "custom", from: period.from, to: period.to } : periodAt(k.key, period.from))}
              className={cn("rounded-md px-3 py-1.5 text-[12.5px] font-medium", period.kind === k.key ? "bg-fg text-surface" : "text-muted hover:text-fg")}
            >
              {k.label}
            </button>
          ))}
        </div>
        {period.kind === "custom" && (
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="fin-from">Từ ngày</label>
            <DateInput id="fin-from" value={period.from} max={today} onCommit={(from) => from && setPeriod({ ...period, ...orderedDateRange(from, period.to) })} className="h-9 w-[150px] text-[12.5px]" />
            <span aria-hidden className="text-muted">→</span>
            <label className="sr-only" htmlFor="fin-to">Đến ngày</label>
            <DateInput id="fin-to" value={period.to} onCommit={(to) => to && setPeriod({ ...period, ...orderedDateRange(period.from, to) })} className="h-9 w-[150px] text-[12.5px]" />
          </div>
        )}
        <span className="text-[12px] text-muted">so với kỳ liền trước cùng độ dài</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

function Change({ cur, prev, inverse }: { cur: number; prev: number; inverse?: boolean }) {
  const pct = percentChange(cur, prev);
  if (pct === null) return <span className="text-muted">kỳ trước chưa có</span>;
  const good = inverse ? pct <= 0 : pct >= 0;
  return <span className={good ? "text-good" : "text-bad"}>{pct > 0 ? "▲" : pct < 0 ? "▼" : ""}{Math.abs(pct)}% so kỳ trước</span>;
}

/** Một bề mặt chia ô (DESIGN §10). */
function Headline({ cur, prev }: { cur: FinanceFlows; prev: FinanceFlows }) {
  const cells = [
    { label: "GMV (khách trả)", help: "Tổng tiền khách đã trả cho các đơn đặt trong kỳ (trước hoàn tiền). Đây là doanh số chảy qua sàn, không phải tiền của sàn.", value: cur.gmv, hint: <>{cur.orders.toLocaleString("vi-VN")} đơn · <Change cur={cur.gmv} prev={prev.gmv} /></> },
    { label: "Doanh thu sàn", help: "Phần sàn giữ lại: phí trên đơn đã giải ngân + phí rút tiền của seller trong kỳ.", value: cur.revenue, hint: <Change cur={cur.revenue} prev={prev.revenue} /> },
    { label: "Chi phí sàn", help: "Tiền sàn tự bỏ ra: bù giảm giá mã khuyến mãi, hoa hồng giới thiệu (trừ phần thu hồi), cộng tay trừ đi trừ tay.", value: cur.costs, hint: "Bù KM · hoa hồng · cộng tay" },
    { label: "Lãi ròng sàn", help: "Doanh thu sàn − chi phí sàn. Biên = lãi ròng / GMV.", value: cur.net, hint: cur.gmv ? `Biên ${(Math.round((cur.net / cur.gmv) * 1000) / 10).toLocaleString("vi-VN")}% trên GMV` : "—", strong: true },
    { label: "Hoàn cho khách", help: "Tiền trả lại ví người mua trong kỳ (huỷ đơn, giao thiếu, tranh chấp). Không phải chi phí của sàn: tiền này lấy từ escrow của đơn.", value: cur.refunds, hint: `${cur.refund_count} lần · ${cur.disputes_opened} tranh chấp mở` },
  ];
  return (
    <section aria-label="Tổng quan kỳ" className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface md:grid-cols-5 md:divide-x md:divide-line">
      {cells.map((c) => (
        <div key={c.label} className="border-b border-line px-4 py-3 md:border-b-0">
          <div className="flex items-center text-[11px] font-semibold uppercase tracking-wide text-muted">{c.label}<InfoTip label={c.label} text={c.help} /></div>
          <div className={cn("mt-1 font-mono text-[18px] tabular-nums", c.strong ? "font-semibold text-fg" : "text-fg", c.value < 0 && "text-bad")}>{vnd(c.value)}</div>
          <div className="mt-0.5 text-[11.5px] text-muted">{c.hint}</div>
        </div>
      ))}
    </section>
  );
}

function ProfitTable({ data, period }: { data: FinanceReport; period: Period }) {
  const c = data.current;
  const p = data.previous;
  const rows: { label: string; cur: number; prev: number; level: 0 | 1; types?: string[]; total?: boolean; inverse?: boolean; help?: string }[] = [
    { label: "Doanh thu", cur: c.revenue, prev: p.revenue, level: 0, help: "Phí sàn trên đơn đã giải ngân + phí rút tiền." },
    { label: "Phí sàn trên đơn", cur: c.order_fee, prev: p.order_fee, level: 1, types: ["platform_fee"] },
    { label: "Phí rút tiền", cur: c.withdraw_fee, prev: p.withdraw_fee, level: 1, types: ["platform_fee"] },
    { label: "Chi phí", cur: c.costs, prev: p.costs, level: 0, inverse: true, help: "Tiền sàn bỏ ra: bù khuyến mãi, hoa hồng giới thiệu, cộng tay (trừ đi trừ tay). Không gồm tiền hoàn cho khách." },
    { label: "Bù giảm giá mã khuyến mãi", cur: c.promo_subsidy, prev: p.promo_subsidy, level: 1, types: ["promo_subsidy"], inverse: true },
    { label: "Hoa hồng giới thiệu (trừ thu hồi)", cur: c.affiliate_net, prev: p.affiliate_net, level: 1, types: ["affiliate_commission", "affiliate_clawback"], inverse: true },
    { label: "Cộng / trừ tay (ròng)", cur: c.manual_net, prev: p.manual_net, level: 1, types: ["topup", "adjustment_credit", "adjustment_debit"], inverse: true },
    { label: "Lãi ròng", cur: c.net, prev: p.net, level: 0, total: true, help: "Doanh thu − chi phí." },
  ];
  return (
    <section aria-labelledby="pl-title" className="rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="pl-title" className="flex items-center text-[13.5px] font-semibold text-fg">Kết quả kinh doanh của sàn<InfoTip label="Kết quả kinh doanh" text="Lãi/lỗ của riêng sàn trong kỳ, so với kỳ liền trước. Bấm tên một dòng để xem từng bút toán trong Dòng tiền." /></h2>
        <Link href={ledgerHref(period)} className="text-[12.5px] text-iris-hi hover:underline">Xem bút toán của kỳ</Link>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th scope="col" className="px-4 py-2 text-left font-semibold"><span className="sr-only">Chỉ tiêu</span></th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">Kỳ này</th>
            <th scope="col" className="hidden px-2 py-2 text-right font-semibold sm:table-cell">Kỳ trước</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const delta = r.cur - r.prev;
            const label = r.types ? <Link href={ledgerHref(period, r.types)} className="hover:text-iris-hi hover:underline">{r.label}</Link> : r.label;
            return (
              <tr key={r.label} className={cn("border-t border-line", r.total && "border-t-2 border-fg/70")}>
                <th scope="row" className={cn("px-4 py-2 text-left", r.level === 0 ? "font-semibold text-fg" : "pl-8 font-normal text-muted")}>{label}{r.help && <InfoTip label={r.label} text={r.help} />}</th>
                <td className={cn("px-2 py-2 text-right font-mono tabular-nums", r.level === 0 ? "text-fg" : "text-muted", r.total && "font-semibold")}>{vnd(r.cur)}</td>
                <td className="hidden px-2 py-2 text-right font-mono tabular-nums text-muted sm:table-cell">{vnd(r.prev)}</td>
                <td className={cn("px-4 py-2 text-right font-mono tabular-nums", delta === 0 ? "text-muted" : (r.inverse ? delta < 0 : delta > 0) ? "text-good" : "text-bad")}>
                  {delta > 0 ? "+" : delta < 0 ? "−" : ""}{vnd(Math.abs(delta))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {c.demo_topups > 0 && <p className="border-t border-line px-4 py-2 text-[11.5px] text-muted">Không tính {vnd(c.demo_topups)} nạp thử (demo).</p>}
      {c.seed_writeoffs > 0 && <p className="border-t border-line px-4 py-2 text-[11.5px] text-muted">Không tính {vnd(c.seed_writeoffs)} huỷ tiền tài khoản test/seed (vẫn là tiền ra trong cân đối).</p>}
    </section>
  );
}

function BalanceCard({ balance: b }: { balance: FinanceBalance }) {
  const line = (label: string, value: number, tone?: "in" | "out", help?: string) => (
    <div className="flex items-center justify-between border-t border-line py-2 pl-4 text-[13px]">
      <span className="flex items-center text-muted">{label}{help && <InfoTip label={label} text={help} />}</span>
      <span className={cn("pr-4 font-mono tabular-nums", tone === "in" ? "text-good" : tone === "out" ? "text-bad" : "text-fg")}>
        {tone === "in" ? "+" : tone === "out" ? "−" : ""}{vnd(value)}
      </span>
    </div>
  );
  const parts = [
    { label: "Ví người mua", value: b.buyer_wallets, help: "Số dư khả dụng của mọi ví người mua." },
    { label: "Ví người bán", value: b.seller_wallets, help: "Số dư khả dụng của mọi ví người bán." },
    { label: "Ví sàn", value: b.platform_wallet, help: "Phí sàn đã thu, chưa rút ra." },
    { label: "Escrow", value: b.escrow, help: "Tiền đơn chưa giải ngân cho seller." },
    { label: "Đang khoá chờ rút", value: b.locked, help: "Tiền seller yêu cầu rút, còn khoá tới khi admin chuyển khoản hoặc từ chối." },
  ];
  return (
    <section aria-labelledby="bal-title" className="rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="bal-title" className="flex items-center text-[13.5px] font-semibold text-fg">Cân đối tiền trong hệ thống<InfoTip label="Cân đối tiền" text="Tổng tiền đang nằm trong sàn (mọi ví, escrow, tiền khoá chờ rút). Đầu kỳ + tiền vào − tiền ra phải bằng cuối kỳ, và bằng tổng các phần bên dưới; lệch nghĩa là có số dư thay đổi mà không ghi sổ." /></h2>
        {b.matches ? (
          <Tag tone="good"><CheckCircle2 size={12} /> Khớp</Tag>
        ) : (
          <Tag tone="bad"><AlertTriangle size={12} /> Lệch {vnd(Math.abs(b.delta))}</Tag>
        )}
      </div>
      <div className="flex items-center justify-between py-2 pl-4 text-[13px]">
        <span className="flex items-center font-medium text-fg">Số dư đầu kỳ<InfoTip label="Số dư đầu kỳ" text="Tổng tiền đang nằm trong sàn lúc bắt đầu kỳ: mọi ví (kể cả ví sàn), escrow và tiền khoá chờ rút." /></span>
        <span className="pr-4 font-mono tabular-nums text-fg">{vnd(b.opening)}</span>
      </div>
      {line("Nạp vào (ngân hàng, crypto)", b.deposits, "in")}
      {line("Tiền sàn bơm vào (KM, hoa hồng, cộng tay)", b.injected, "in", "Tiền sàn tự đưa vào ví người dùng: bù mã khuyến mãi, hoa hồng giới thiệu, admin cộng tay.")}
      {line("Chuyển khoản rút tiền", b.withdrawn, "out")}
      {line("Trừ tay, thu hồi hoa hồng", b.removed, "out", "Tiền sàn lấy lại khỏi ví người dùng: admin trừ tay, hoa hồng bị thu hồi khi đơn hoàn.")}
      <div className="flex items-center justify-between border-t-2 border-fg/70 py-2 pl-4 text-[13px]">
        <span className="font-semibold text-fg">Số dư cuối kỳ</span>
        <span className="pr-4 font-mono font-semibold tabular-nums text-fg">{vnd(b.closing)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-5">
        {parts.map((p) => (
          <div key={p.label} className="bg-surface px-3 py-2">
            <dt className="flex items-center text-[11px] text-muted">{p.label}<InfoTip label={p.label} text={p.help} /></dt>
            <dd className="font-mono text-[12.5px] tabular-nums text-fg">{vnd(p.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-muted">
        {b.stored_total !== null
          ? <>Đối chiếu số dư đang lưu: <span className="font-mono tabular-nums text-fg">{vnd(b.stored_total)}</span>. </>
          : "Kỳ đã qua: đối chiếu bằng cách dựng lại từ sổ. "}
        Tiền thật ở ngân hàng + ví crypto phải ≥ số dư cuối kỳ.
      </p>
    </section>
  );
}

function SmallTable({ title, help, empty, children, footer }: { title: string; help: string; empty: boolean; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-line bg-surface">
      <h2 className="flex items-center border-b border-line px-4 py-3 text-[13.5px] font-semibold text-fg">{title}<InfoTip label={title} text={help} /></h2>
      {empty ? <p className="px-4 py-6 text-center text-[12.5px] text-muted">Không có trong kỳ này.</p> : <ul className="divide-y divide-line">{children}</ul>}
      {footer && <div className="border-t border-line px-4 py-2 text-[12.5px]">{footer}</div>}
    </section>
  );
}

function Row({ label, sub, value, tone }: { label: React.ReactNode; sub?: React.ReactNode; value: string; tone?: "warn" }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
      <span className={cn("min-w-0 truncate", tone === "warn" ? "text-warn" : "text-fg")}>{label}{sub && <span className="ml-1.5 text-[11.5px] text-muted">{sub}</span>}</span>
      <span className="shrink-0 font-mono tabular-nums text-fg">{value}</span>
    </li>
  );
}

function Channels({ data, period }: { data: FinanceReport; period: Period }) {
  const ch = data.channels;
  return (
    <SmallTable
      title="Nạp theo kênh"
      help="Lệnh nạp đã thanh toán trong kỳ, theo cổng thanh toán. 'Chưa gán tài khoản' là tiền đã vào ngân hàng nhưng chưa cộng cho ai."
      empty={!ch.providers.length && !ch.unmatched_count}
      footer={<Link href={ledgerHref(period, ["deposit"])} className="text-iris-hi hover:underline">Xem các khoản nạp</Link>}
    >
      {ch.providers.map((c) => <Row key={c.provider} label={PROVIDER_LABEL[c.provider] ?? c.provider} sub={`${c.count} lệnh`} value={vnd(c.amount)} />)}
      {ch.unmatched_count > 0 && (
        <Row tone="warn" label={<Link href="/admin/deposits" className="hover:underline">Chưa gán tài khoản</Link>} sub={`${ch.unmatched_count} khoản`} value={vnd(ch.unmatched_amount)} />
      )}
    </SmallTable>
  );
}

function TopSellers({ data }: { data: FinanceReport }) {
  return (
    <SmallTable title="Seller nhận nhiều nhất" help="Seller được giải ngân nhiều nhất trong kỳ (gồm phần sàn bù khuyến mãi), kèm phí sàn đã thu trên các đơn đó." empty={!data.top_sellers.length}>
      {data.top_sellers.map((s) => (
        <Row
          key={s.account_id}
          label={<Link href={`/admin/ledger?account=${s.account_id}`} className="hover:text-iris-hi hover:underline">{s.email}</Link>}
          sub={`${s.orders} đơn · phí ${vnd(s.fee)}`}
          value={vnd(s.received)}
        />
      ))}
    </SmallTable>
  );
}

function Programs({ data, period }: { data: FinanceReport; period: Period }) {
  const typesFor = { promo: ["promo_subsidy"], affiliate: ["affiliate_commission", "affiliate_clawback"], manual: ["topup", "adjustment_credit", "adjustment_debit"] } as const;
  return (
    <SmallTable title="Chi phí theo chương trình" help="Chi phí sàn tách theo nguồn: từng mã khuyến mãi, chương trình giới thiệu, cộng/trừ tay." empty={!data.programs.length}>
      {data.programs.map((p) => (
        <Row
          key={`${p.kind}-${p.label}`}
          label={<Link href={ledgerHref(period, [...typesFor[p.kind]])} className="hover:text-iris-hi hover:underline">{p.kind === "promo" ? `Mã ${p.label}` : p.label}</Link>}
          sub={`${p.count} lần`}
          value={vnd(p.amount)}
        />
      ))}
    </SmallTable>
  );
}

function ClosedPeriods({ rows, loading, error, onOpen }: {
  rows?: import("@/lib/types").FinancePeriodClose[]; loading: boolean; error: boolean; onOpen: (p: Period) => void;
}) {
  const toPeriod = (r: import("@/lib/types").FinancePeriodClose): Period => {
    const vnDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
    const from = vnDay(r.period_start);
    const to = vnDay(new Date(new Date(r.period_end).getTime() - 1).toISOString());
    return { kind: "custom", from, to };
  };
  return (
    <section aria-labelledby="closes-title" className="rounded-xl border border-line bg-surface">
      <h2 id="closes-title" className="flex items-center border-b border-line px-4 py-3 text-[13.5px] font-semibold text-fg">Các kỳ đã chốt<InfoTip label="Các kỳ đã chốt" text="Kỳ đã khoá số liệu. 'Điều chỉnh sau chốt' báo khi có bút toán ghi vào kỳ đó sau lúc chốt, làm lãi ròng khác với lúc chốt." /></h2>
      {error ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-bad">Không tải được danh sách kỳ đã chốt.</p>
      ) : loading ? (
        <div className="p-4"><Skeleton className="h-16" /></div>
      ) : !rows?.length ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-muted">Chưa chốt kỳ nào.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-2 text-left font-semibold">Kỳ</th>
                <th scope="col" className="px-2 py-2 text-left font-semibold">Chốt bởi</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Lãi ròng khi chốt</th>
                <th scope="col" className="px-2 py-2 text-left font-semibold">Điều chỉnh sau chốt</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">Mở</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const drifted = r.drift && (r.drift.late_rows > 0 || r.drift.net_delta !== 0);
                return (
                  <tr key={r.id} className="border-t border-line">
                    <th scope="row" className="px-4 py-2 text-left font-medium text-fg">{r.label}</th>
                    <td className="px-2 py-2 text-muted">{r.closed_by} · {formatDateTime(r.closed_at, "vi")}{r.note && <span className="block text-[11.5px]">“{r.note}”</span>}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-fg">{r.net !== null ? vnd(r.net) : "—"}</td>
                    <td className={cn("px-2 py-2", drifted ? "text-warn" : "text-muted")}>
                      {drifted ? `${r.drift!.late_rows} bút toán · lãi ròng lệch ${vnd(r.drift!.net_delta)}` : "Không"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => onOpen(toPeriod(r))} className="text-[12.5px] text-iris-hi hover:underline">Xem kỳ</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
