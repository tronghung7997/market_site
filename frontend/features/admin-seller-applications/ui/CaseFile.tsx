"use client";

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import type { AdminSellerApplicationDetail, AdminSellerApplicationRow } from "@/lib/types";
import { Button, Spinner, Tag } from "@/components/ui";
import { InternalNotes } from "@/components/admin";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Store } from "@/components/Icons";
import { useAddApplicationNote } from "../data";
import {
  diffAnswer, EXPERIENCE_LABEL, HISTORY_LABEL, REFERRAL_LABEL, SELLER_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, submissionNumber,
} from "../model";

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-raised/40 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Answer({ label, current, previous, multiline }: { label: string; current: string; previous: string | null; multiline?: boolean }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr] sm:gap-4">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={cn("min-w-0 break-words text-[13px] text-fg", multiline && "whitespace-pre-line")}>
        {previous !== null ? (
          <>
            <span className="rounded bg-good-soft px-1 text-fg">{current || "—"}</span>
            <span className="mt-1 block text-[12px] text-faint line-through decoration-bad/60">{previous || "(trống)"}</span>
          </>
        ) : current || <span className="text-faint">—</span>}
      </dd>
    </div>
  );
}

export function CaseFile({ row, detail, categoryName, onPrev, onNext, hasPrev, hasNext, onBack }: {
  row: AdminSellerApplicationRow;
  detail: { data?: AdminSellerApplicationDetail; isPending: boolean; isError: boolean; refetch: () => unknown };
  categoryName: (id: number) => string;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onBack: () => void;
}) {
  const d = detail.data?.id === row.id ? detail.data : undefined;
  const app = d ?? row;
  const snapshot = d?.previous_snapshot ?? null;
  const addNote = useAddApplicationNote(row.id);
  const answers: { key: string; label: string; value: unknown; multiline?: boolean; format?: (v: unknown) => string }[] = [
    { key: "business_name", label: "Tên gian hàng", value: app.business_name },
    { key: "seller_type", label: "Loại người bán", value: app.seller_type, format: (v) => (v ? SELLER_TYPE_LABEL[String(v)] ?? String(v) : "") },
    { key: "category_ids", label: "Danh mục", value: app.category_ids },
    { key: "experience", label: "Kinh nghiệm", value: app.experience, format: (v) => (v ? EXPERIENCE_LABEL[String(v)] ?? String(v) : "") },
    { key: "description", label: "Mô tả", value: app.description, multiline: true },
    { key: "warranty_policy", label: "Chính sách bảo hành", value: app.warranty_policy, multiline: true },
    { key: "contact", label: "Liên hệ", value: app.contact },
    { key: "phone", label: "Số điện thoại", value: app.phone },
    { key: "referral_source", label: "Biết đến qua", value: app.referral_source, format: (v) => (v ? REFERRAL_LABEL[String(v)] ?? String(v) : "") },
  ];
  const submittedAt = app.info_responded_at ?? app.created_at;

  return (
    <div className="space-y-4">
      <header className="rounded-card border border-line bg-card p-4">
        <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg lg:hidden">
          <ChevronLeft size={14} /> Danh sách đơn
        </button>
        <div className="flex flex-wrap items-start gap-3">
          {app.logo ? (
            <img src={app.logo.thumb_url || app.logo.url} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover" />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-iris-soft text-iris-hi"><Store size={20} /></span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words text-[16px] font-semibold text-fg">{app.business_name}</h2>
              <Tag tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Tag>
              <span className="font-mono text-[11.5px] text-faint">#{app.id}</span>
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              <Link href={`/admin/accounts/${app.applicant.id}`} className="font-medium text-iris-hi hover:underline">{app.applicant.email}</Link>
              {!app.applicant.email_verified && <span className="ml-1.5"><Tag tone="warn">Chưa xác minh email</Tag></span>}
            </p>
            <p className="mt-1 text-[12px] text-faint">
              Nộp {formatDateTime(app.created_at, "vi")}
              {app.info_responded_at && ` · Bổ sung ${formatDateTime(app.info_responded_at, "vi")}`}
              {app.reviewed_at && ` · Xử lý ${formatDateTime(app.reviewed_at, "vi")}${app.reviewed_by_email ? ` bởi ${app.reviewed_by_email}` : ""}`}
            </p>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" onClick={onPrev} disabled={!hasPrev} aria-label="Đơn trước (K)" title="Đơn trước (K)"><ChevronLeft size={14} /></Button>
            <Button size="sm" variant="secondary" onClick={onNext} disabled={!hasNext} aria-label="Đơn sau (J)" title="Đơn sau (J)"><ChevronRight size={14} /></Button>
          </div>
        </div>
        {app.status === "rejected" && app.reject_reason && (
          <p className="mt-3 whitespace-pre-line rounded-lg border border-bad/25 bg-bad-soft/50 px-3 py-2 text-[12.5px] text-fg">
            <span className="font-medium text-bad">Lý do từ chối: </span>{app.reject_reason}
            {app.resubmit_after && <span className="mt-1 block text-muted">Được nộp lại từ {formatDateTime(app.resubmit_after, "vi")}</span>}
          </p>
        )}
        {app.info_request && (app.status === "needs_info" || app.info_responded_at) && (
          <p className="mt-3 whitespace-pre-line rounded-lg border border-iris/25 bg-iris-soft/40 px-3 py-2 text-[12.5px] text-fg">
            <span className="font-medium text-iris-hi">Đã yêu cầu bổ sung: </span>{app.info_request}
          </p>
        )}
      </header>

      {detail.isError && !d ? (
        <div className="rounded-card border border-line bg-card px-4 py-8 text-center text-[13px] text-bad">
          Không tải được hồ sơ đơn. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void detail.refetch()}>Thử lại</Button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Section title="Nội dung đơn" aside={snapshot ? <span className="text-[11.5px] text-muted"><span className="rounded bg-good-soft px-1">mới</span> so với lần nộp trước</span> : undefined}>
            <dl className="divide-y divide-line">
              {answers.map((a) => {
                const diff = a.key === "category_ids"
                  ? diffAnswer(a.key, a.value, snapshot, categoryName)
                  : diffAnswer(a.key, a.format ? a.format(a.value) : a.value, snapshot && a.format && a.key in snapshot ? { [a.key]: a.format(snapshot[a.key]) } : snapshot);
                return <Answer key={a.key} label={a.label} current={diff.current} previous={diff.previous} multiline={a.multiline} />;
              })}
              <Answer label="Cam kết quy định" current={app.rules_accepted_at ? `Đồng ý ${formatDateTime(app.rules_accepted_at, "vi")}` : ""} previous={null} />
            </dl>
          </Section>

          {app.banner && (
            <Section title="Ảnh bìa">
              <img src={app.banner.url} alt="Ảnh bìa gian hàng" className="max-h-56 w-full rounded-lg border border-line object-cover" />
            </Section>
          )}

          <Section title="Lịch sử đơn">
            {!d ? (detail.isPending ? <Spinner /> : null) : (
              <ol className="space-y-2.5">
                {[...d.history].sort((x, y) => y.at.localeCompare(x.at)).map((h, i) => (
                  <li key={`${h.at}-${i}`} className="flex gap-3 text-[12.5px]">
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", h.kind === "approved" ? "bg-good" : h.kind === "rejected" ? "bg-bad" : h.kind === "info_requested" ? "bg-iris" : "bg-line-2")} />
                    <div className="min-w-0">
                      <p className="text-fg"><span className="font-medium">{HISTORY_LABEL[h.kind] ?? h.kind}</span>{h.actor_email && <span className="text-muted"> · {h.actor_email}</span>}</p>
                      {h.text && <p className="mt-0.5 whitespace-pre-line break-words text-muted">{h.text}</p>}
                      <p className="font-mono text-[11px] text-faint">{formatDateTime(h.at, "vi")}</p>
                    </div>
                  </li>
                ))}
                {d.history.length === 0 && <li className="text-[12.5px] text-faint">Chưa có sự kiện.</li>}
              </ol>
            )}
            {d && d.prior_applications.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-[12px] font-medium text-muted">Đơn trước của tài khoản này ({d.prior_applications.length})</p>
                <ul className="mt-2 space-y-1.5">
                  {d.prior_applications.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                      <Link href={`/admin/seller-applications?status=${p.status}&app=${p.id}`} className="font-mono text-iris-hi hover:underline">#{p.id}</Link>
                      <Tag tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Tag>
                      <span className="text-faint">{formatDateTime(p.created_at, "vi")}</span>
                      {p.reject_reason && <span className="w-full whitespace-pre-line text-muted">{p.reject_reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Tín hiệu rủi ro" aside={<span className="text-[11.5px] text-muted">Lần nộp thứ {submissionNumber(app.prior_rejections, d?.prior_applications.length)}</span>}>
            {!d ? (detail.isPending ? <Spinner /> : <p className="text-[12px] text-faint">—</p>) : <RiskList detail={d} submittedAt={submittedAt} />}
          </Section>
          <Section title="Ghi chú nội bộ">
            <InternalNotes
              notes={d?.notes}
              loading={!d && detail.isPending}
              error={!d && detail.isError}
              onRetry={() => void detail.refetch()}
              onAdd={(body) => addNote.mutateAsync(body)}
              adding={addNote.isPending}
            />
            {addNote.isError && <p className="mt-2 text-[12px] text-bad">Không lưu được ghi chú.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}

function RiskList({ detail, submittedAt }: { detail: AdminSellerApplicationDetail; submittedAt: string }) {
  const r = detail.risk;
  const warn = (text: React.ReactNode, key: string) => (
    <li key={key} className="flex gap-2 text-[12.5px] text-bad"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span className="min-w-0">{text}</span></li>
  );
  const ok = (text: React.ReactNode, key: string) => (
    <li key={key} className="flex gap-2 text-[12.5px] text-muted"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good" /><span className="min-w-0">{text}</span></li>
  );
  const accounts = (list: { id: number; email: string; is_active?: boolean }[]) => (
    <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
      {list.map((a) => (
        <Link key={a.id} href={`/admin/accounts/${a.id}`} className="font-medium underline underline-offset-2 hover:no-underline">
          {a.email}{a.is_active === false ? " (đã khóa)" : ""}
        </Link>
      ))}
    </span>
  );
  const items: React.ReactNode[] = [];
  items.push(r.email_verified ? ok("Email đã xác minh", "email") : warn("Email chưa xác minh", "email"));
  if (r.same_phone_accounts.length) items.push(warn(<>Trùng số điện thoại với {r.same_phone_accounts.length} tài khoản{accounts(r.same_phone_accounts)}</>, "phone"));
  if (r.shared_ip_locked_accounts.length) items.push(warn(<>Dùng chung IP với {r.shared_ip_locked_accounts.length} tài khoản đã khóa{accounts(r.shared_ip_locked_accounts)}</>, "ip"));
  if (detail.prior_rejections > 0) items.push(warn(`Đã bị từ chối ${detail.prior_rejections} lần trước`, "rej"));
  items.push(r.totp_enabled ? ok("Đã bật 2FA", "2fa") : <li key="2fa" className="flex gap-2 text-[12.5px] text-muted"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-2" />Chưa bật 2FA</li>);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">{items}</ul>
      <dl className="grid grid-cols-2 gap-2 border-t border-line pt-3 text-[12px]">
        <div><dt className="text-muted">Tuổi tài khoản</dt><dd className="font-mono text-fg">{r.account_age_days} ngày</dd></div>
        <div><dt className="text-muted">Đơn đã mua</dt><dd className="font-mono text-fg">{r.orders_bought}</dd></div>
        <div><dt className="text-muted">Đã chi</dt><dd className="font-mono text-fg">{vnd(r.spent)}</dd></div>
        <div><dt className="text-muted">Khiếu nại đã mở</dt><dd className="font-mono text-fg">{r.disputes_opened}</dd></div>
      </dl>
      <p className="text-[11px] text-faint">Nộp lần gần nhất {formatDateTime(submittedAt, "vi")}</p>
    </div>
  );
}
