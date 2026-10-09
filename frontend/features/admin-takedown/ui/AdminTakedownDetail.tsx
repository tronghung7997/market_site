"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/cn";
import { privateImageBase } from "@/lib/media";
import { useMoney } from "@/lib/money";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { TakedownAdminDetail } from "@/lib/types";
import { Banner, Button, Card, CopyButton, InlineNotice, Skeleton, buttonClass } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import { AlertCircle, AlertTriangle, ChevronLeft, ExternalLink, Info, RefreshCw } from "@/components/Icons";
import {
  EvidenceShot, PlatformMark, StatusTag, openableUrl, platformOf, stateSince, useAdminTakedownActions, useAdminTakedownRequest,
  useServiceLabel, useShortTime, useWarrantyLabel,
} from "@/features/takedown";
import { adminStatusLabel, eventView, safeBackSearch, waitedLabel } from "../model";

/** One request in full: the whole link (wrapped, never clipped), buyer, partner state, history, evidence and the next action. */
export function AdminTakedownDetail({ code }: { code: string }) {
  const params = useSearchParams();
  const back = `/admin/takedown${safeBackSearch(params.get("back"))}`;
  const query = useAdminTakedownRequest(code);
  const r = query.data;

  const backLink = (
    <Link href={back} className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
      <ChevronLeft size={15} aria-hidden /> Danh sách gỡ link
    </Link>
  );

  if (query.isPending) {
    return <div className="flex flex-col gap-4">{backLink}<Skeleton className="h-[160px] rounded-card" /><Skeleton className="h-[280px] rounded-card" /></div>;
  }
  if (query.isError || !r) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <Banner tone="bad" icon={<AlertCircle size={15} aria-hidden />} title={missing ? `Không tìm thấy ${code}.` : "Không tải được yêu cầu."}
          action={missing ? undefined : <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Thử lại</Button>} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {backLink}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-[22px] font-semibold tracking-tight text-fg">{r.code}</h1>
        <StatusTag request={r} label={adminStatusLabel} />
        <span className="text-[13px] text-muted">ở trạng thái này {waitedLabel(stateSince(r), Date.now())}</span>
      </div>
      {(r.needs_sync || r.sync_error) && (
        <Banner tone="warn" icon={<AlertTriangle size={15} aria-hidden />} title="Chưa khớp với đối tác">
          {r.sync_error ? <>Lần gọi gần nhất lỗi: <span className="font-mono">{r.sync_error}</span>. </> : null}
          Hệ thống tự đồng bộ lại mỗi 2 phút; bấm “Đồng bộ ngay” để thử luôn.
        </Banner>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <LinkCard r={r} />
          <InfoCard r={r} />
          <HistoryCard r={r} />
          {r.evidence.length > 0 && <EvidenceCard r={r} />}
        </div>
        <ActionCard r={r} />
      </div>
    </div>
  );
}

function LinkCard({ r }: { r: TakedownAdminDetail }) {
  const serviceLabel = useServiceLabel();
  const href = openableUrl(r.url);
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <PlatformMark platform={platformOf(r.url)} className="h-9 w-9" />
        <div className="flex flex-col">
          <h2 className="text-[15px] font-semibold text-fg">Link cần gỡ</h2>
          <span className="text-[12.5px] text-muted">{serviceLabel(r.service)}</span>
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          <CopyButton text={r.url} label="Chép link" copiedLabel="Đã chép" className={buttonClass({ variant: "secondary", size: "sm" })} />
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
              <ExternalLink size={13} aria-hidden /> Mở link
            </a>
          )}
        </div>
      </div>
      {/* The full link, wrapped at any character — admins must see every query parameter. */}
      <p className="select-all break-all rounded-lg border border-line bg-raised/50 px-3 py-2.5 font-mono text-[13.5px] leading-relaxed text-fg">{r.url}</p>
      {r.note && (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-muted">Ghi chú của khách</span>
          <p className="whitespace-pre-line text-[13.5px] text-fg">{r.note}</p>
        </div>
      )}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] text-faint">{label}</dt>
      <dd className="text-[13.5px] text-fg">{children}</dd>
    </div>
  );
}

function InfoCard({ r }: { r: TakedownAdminDetail }) {
  const { formatLedgerMoney } = useMoney();
  const locale = useLocale();
  const time = useShortTime();
  const warranty = useWarrantyLabel();
  const money = (v: number | null) => (v === null ? "—" : formatLedgerMoney(v, locale));
  return (
    <Card className="p-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Fact label="Khách"><span className="break-all font-mono text-[13px]">{r.buyer_email ?? "—"}</span></Fact>
        <Fact label="Gửi lúc"><span className="font-mono">{time(r.created_at)}</span></Fact>
        <Fact label="Bảo hành">{warranty(r.warranty_hours)}{r.warranty_until ? <span className="font-mono text-muted"> · đến {time(r.warranty_until)}</span> : null}</Fact>
        <Fact label="Giá vốn (đối tác)"><span className="font-mono font-semibold">{money(r.partner_price)}</span></Fact>
        <Fact label="Giá bán (khách)"><span className="font-mono font-semibold">{money(r.price)}</span></Fact>
        <Fact label="Đơn hàng"><span className="font-mono">{r.order_code ?? "—"}</span></Fact>
        <Fact label="Đơn đối tác"><span className="font-mono">{r.partner_order_id ? `#${r.partner_order_id}` : "chưa tạo"}</span></Fact>
        <Fact label="Trạng thái đối tác"><span className="font-mono">{r.partner_status ?? "—"}</span></Fact>
        <Fact label="Đồng bộ lần cuối"><span className="font-mono">{time(r.last_synced_at) ?? "—"}</span></Fact>
      </dl>
    </Card>
  );
}

const DOT = { neutral: "bg-line-2", iris: "bg-iris", warn: "bg-warn", good: "bg-good", bad: "bg-bad" } as const;

function HistoryCard({ r }: { r: TakedownAdminDetail }) {
  const time = useShortTime();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-[15px] font-semibold text-fg">Nhật ký</h2>
      {r.events.length === 0 ? <p className="text-[13px] text-muted">Chưa có sự kiện.</p> : (
        <ol className="flex flex-col">
          {r.events.map((e, i, list) => {
            const v = eventView(e);
            return (
              <li key={`${e.created_at}-${i}`} className="grid grid-cols-[14px_minmax(0,1fr)] gap-3">
                <span className="flex flex-col items-center">
                  <span className={cn("mt-1.5 h-2.5 w-2.5 rounded-full", DOT[v.tone])} aria-hidden />
                  {i < list.length - 1 && <span className="mt-1 w-px flex-1 bg-line" aria-hidden />}
                </span>
                <span className="flex flex-col gap-0.5 pb-3">
                  <span className="text-[13.5px] text-fg">{v.label}</span>
                  {e.note && <span className="whitespace-pre-line text-[12.5px] text-muted">“{e.note}”</span>}
                  <span className="font-mono text-[11.5px] text-faint">{time(e.created_at)} · {v.by}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function EvidenceCard({ r }: { r: TakedownAdminDetail }) {
  const base = privateImageBase.adminTakedown(r.code);
  const shots = r.evidence.map((kind) => ({
    key: kind, label: kind === "live" ? "Trước khi gỡ" : "Sau khi gỡ", url: `${base}/${kind}`,
    source: kind === "live" ? r.evidence_live_url : r.evidence_dead_url,
  }));
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-[15px] font-semibold text-fg">Ảnh bằng chứng từ đối tác</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shots.map((s) => (
          <li key={s.key} className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-fg">{s.label}</span>
            <EvidenceShot url={s.url} label={s.label} brokenLabel="Không tải được ảnh từ đối tác — bấm “Đồng bộ ngay” hoặc mở link gốc." className="max-h-[320px]" />
            {s.source && <span className="break-all font-mono text-[11.5px] text-faint" title="Link gốc bên đối tác">{s.source}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActionCard({ r }: { r: TakedownAdminDetail }) {
  const { formatLedgerMoney } = useMoney();
  const locale = useLocale();
  const errorMessage = useApiErrorMessage();
  const { price, sync } = useAdminTakedownActions();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const amount = parseInt(value || "0", 10) || 0;
  const canPrice = r.status === "review" && r.partner_status === "quoted";

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (err) { setError(errorMessage(err, "Không thực hiện được — tải lại trang.")); }
  };

  return (
    <Card className="flex flex-col gap-4 p-5 lg:sticky lg:top-4">
      <h2 className="text-[15px] font-semibold text-fg">Việc cần làm</h2>
      {canPrice ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">Đối tác báo giá vốn <span className="font-mono font-semibold text-fg">{r.partner_price !== null ? formatLedgerMoney(r.partner_price, locale) : "—"}</span>. Nhập giá bán cho khách.</p>
          <MoneyInput label="Giá bán cho khách" value={value} onValueChange={setValue} placeholder="0" />
          {amount > 0 && r.partner_price !== null && amount < r.partner_price && (
            <InlineNotice tone="warn" icon={<AlertTriangle size={13} aria-hidden />}>Giá bán thấp hơn giá vốn.</InlineNotice>
          )}
          <Button size="lg" loading={price.isPending} disabled={amount <= 0} onClick={() => void run(() => price.mutateAsync({ code: r.code, price: amount }))}>
            Gửi báo giá{amount > 0 ? ` ${formatLedgerMoney(amount, locale)}` : ""}
          </Button>
          <p className="text-[12px] text-faint">Khách thấy giá ngay. Chấp nhận thì trừ số dư, hệ thống báo đối tác.</p>
        </div>
      ) : (
        <InlineNotice icon={<Info size={13} aria-hidden />}>{nextStep(r)}</InlineNotice>
      )}
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Button variant="secondary" loading={sync.isPending} onClick={() => void run(() => sync.mutateAsync(r.code))}>
          <RefreshCw size={13} aria-hidden /> Đồng bộ ngay với đối tác
        </Button>
        <p className="text-[12px] text-faint">Trang tự làm mới mỗi 10 giây khi yêu cầu còn mở.</p>
      </div>
      {error && <InlineNotice tone="bad" icon={<AlertCircle size={13} aria-hidden />}>{error}</InlineNotice>}
    </Card>
  );
}

function nextStep(r: TakedownAdminDetail): string {
  if (!r.partner_order_id) return "Chưa tạo được đơn bên đối tác — hệ thống đang thử lại.";
  switch (r.status) {
    case "review": return "Chờ đối tác báo giá vốn.";
    case "quoted": return "Đã gửi giá cho khách, chờ khách chấp nhận. Giá không hết hạn.";
    case "started": return "Khách đã trả tiền. Chờ đối tác xác nhận thanh toán (confirm-payment).";
    case "processing": return "Đối tác đang gỡ. Done/Failed do đối tác cập nhật.";
    case "warranty": return "Đang bảo hành. Hết hạn mà link vẫn die thì đối tác tự chuyển success.";
    case "warranty_claim": return "Khách xin bảo hành, chờ đối tác chấp nhận hoặc từ chối.";
    case "done": return "Hoàn tất. Tiền đã chuyển vào ký quỹ của đơn hàng.";
    case "failed": return "Đối tác báo không gỡ được — đã hoàn tiền cho khách.";
    case "declined": return "Đối tác không nhận link này. Không trừ tiền.";
    case "rejected": return "Khách từ chối giá.";
    case "cancelled": return "Khách đã huỷ.";
  }
}
