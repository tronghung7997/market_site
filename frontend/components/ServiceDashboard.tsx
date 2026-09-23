"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { lineLabel } from "@/lib/order-ref";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { DashboardData, DashboardResource, DashboardTask, GatewayCallLogItem, GatewayTryResult, UsageRecordItem } from "@/lib/types";
import { productPath } from "@/lib/routes";
import { cn } from "@/lib/cn";
import { Banner, Button, Card, Spinner, Tag } from "@/components/ui";
import { Info } from "@/components/Icons";

// RapidAPI cảnh báo buyer ở 85% hạn mức thay vì đợi tới lúc hết hẳn — báo
// trước để buyer chủ động mua thêm, không bị chặn giữa chừng lúc đang dùng.
const LOW_BALANCE_THRESHOLD = 0.8;

/* ── Helpers ── */

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function fmtDate(iso: string, locale = "vi") {
  return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "vi-VN");
}

function daysRemaining(expiresAt: string | null, t: (key: "forever" | "expired" | "daysLeft", values?: { count: number }) => string): string {
  if (!expiresAt) return t("forever");
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return t("expired");
  return t("daysLeft", { count: Math.ceil(ms / 86400000) });
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-raised border border-line rounded-lg p-3">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="text-[18px] font-semibold tabular mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-md bg-raised border border-line hover:border-line-2 transition-colors"
    >
      {copied ? t("copiedExclaim") : label ?? tc("copy")}
    </button>
  );
}

function maskSecret(value: string): string {
  return value.length > 8 ? value.slice(0, 4) + "****" + value.slice(-4) : "****";
}

/** `value` là thứ hiển thị/che; `copyValue` là thứ thực sự cần dán đi.
 *  Hai thứ tách nhau vì địa chỉ gọi CHỨA key: che key ở dòng trên rồi in
 *  nguyên nó trong URL dòng dưới thì việc che chỉ là hình thức. Nút Sao chép
 *  vẫn đưa bản đầy đủ nên buyer không mất gì. */
function MaskedValue({ value, display, copyValue }: { value: string; display?: string; copyValue?: string }) {
  const tc = useTranslations("common");
  const [visible, setVisible] = useState(false);
  const masked = display ?? maskSecret(value);
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[12.5px] break-all">
      <span>{visible ? (copyValue ?? value) : masked}</span>
      <button
        onClick={() => setVisible((v) => !v)}
        className="text-[11px] text-iris-hi hover:underline"
      >
        {visible ? tc("hide") : tc("show")}
      </button>
      <CopyButton text={copyValue ?? value} />
    </span>
  );
}

/* ── Proxy Dashboard ── */

// Trạng thái đến từ HAI nguồn: bảng `resources` (đơn kiểu cũ) và
// `proxy_allocations` (đơn mua qua adapter). Gộp nhãn về một chỗ để dashboard
// không hiện ra mã máy như "allocated"/"offline".
const PROXY_ACTIVE_STATUSES = new Set(["assigned", "available", "allocated"]);

function proxyStatusMeta(status: string, t: ReturnType<typeof useTranslations<"orders">>) {
  const map: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
    assigned: { label: t("activeStatus"), tone: "good" },
    available: { label: t("readyStatus"), tone: "neutral" },
    allocated: { label: t("activeStatus"), tone: "good" },
    offline: { label: t("offlineStatus"), tone: "warn" },
    expired: { label: t("expiredStatus"), tone: "warn" },
    released: { label: t("releasedStatus"), tone: "neutral" },
    error: { label: t("errorStatus"), tone: "bad" },
  };
  return map[status] ?? { label: status, tone: "neutral" as const };
}

function ProxyDashboard({ data }: { data: DashboardData }) {
  const t = useTranslations("orders");
  const resources = data.resources ?? [];
  const activeCount = resources.filter((r) => PROXY_ACTIVE_STATUSES.has(r.status)).length;

  // Find earliest expiry for days remaining
  const expiringResource = resources
    .filter((r) => r.expires_at)
    .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime())[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label={t("statusLabel")} value={data.status === "delivered" ? t("activeStatus") : data.status} />
        <StatCard label={t("remaining")} value={daysRemaining(expiringResource?.expires_at ?? null, t)} />
        <StatCard label={t("ipCount")} value={resources.length} sub={t("activeCount", { count: activeCount })} />
        {/* Ô "Uptime 99.9% / 30 ngày qua" đã bị bỏ: đó là chuỗi hardcode, không
            hề đo đạc gì — một con số bịa đặt hiển thị như dữ liệu thật. Không
            có nguồn uptime nào ở backend thì đừng hứa với buyer. */}
      </div>

      {resources.length > 0 && (
        <div>
          <h4 className="text-[12.5px] font-medium text-muted mb-2">{t("ipList")}</h4>
          <div className="space-y-1.5">
            {resources.map((r) => (
              <ResourceRow key={r.id} resource={r} />
            ))}
          </div>
        </div>
      )}

      {/* Chỉ hiện khi thật sự có gì để chép — lọc bỏ binding chưa có IP, không
          thì nút chép ra một chuỗi toàn dòng trống. */}
      {resources.some((r) => r.data) && (
        <div className="flex gap-2">
          <CopyButton
            text={resources.filter((r) => r.data).map((r) => r.data).join("\n")}
            label={t("copyAll")}
          />
        </div>
      )}
    </div>
  );
}

function ResourceRow({ resource }: { resource: DashboardResource }) {
  const t = useTranslations("orders");
  const { label, tone } = proxyStatusMeta(resource.status, t);
  // `data` có thể rỗng: binding key xoay chỉ mang IP hiện hành (và chưa có IP
  // nào trước lần lấy proxy đầu tiên). MaskedValue giả định chuỗi khác rỗng —
  // đưa undefined/"" vào là nổ ngay khi render.
  // Chỉ che thứ thật sự là bí mật. Resource kiểu cũ mang nguyên chuỗi
  // "ip:port:user:pass" — che là đúng. Binding proxy mua qua adapter chỉ mang
  // IP hiện hành, mà IP đó đã hiện nguyên văn ở panel proxy và "Dữ liệu bàn
  // giao" ngay phía trên — che ở đây chỉ tạo ra "160.****6.34" vô nghĩa.
  const isCredential = resource.data.includes(":");

  return (
    <div className="flex items-center gap-3 text-[12.5px] px-3 py-2 rounded-lg bg-surface border border-line">
      {!resource.data ? (
        <span className="font-mono text-faint">{t("noIpYet")}</span>
      ) : isCredential ? (
        <MaskedValue value={resource.data} />
      ) : (
        <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
          <span>{resource.data}</span>
          <CopyButton text={resource.data} />
        </span>
      )}
      <Tag tone={tone}>{label}</Tag>
      <span className="ml-auto text-muted text-[11px]">{daysRemaining(resource.expires_at, t)}</span>
    </div>
  );
}

/* ── Endpoint Dashboard ── */

function usageStatusMeta(status: string, t: ReturnType<typeof useTranslations<"orders">>) {
  const map: Record<string, { label: string; tone: "good" | "bad" | "warn" }> = {
    ok: { label: t("usageOk"), tone: "good" },
    rejected_quota: { label: t("usageRejectedQuota"), tone: "bad" },
    rejected_expired: { label: t("usageRejectedExpired"), tone: "warn" },
  };
  return map[status] ?? { label: status, tone: "neutral" as const };
}

function UsageProgressBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const tone = pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-good";
  return (
    <div className="h-2 rounded-full bg-raised overflow-hidden">
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function UsageRecordRow({ record }: { record: UsageRecordItem }) {
  const t = useTranslations("orders");
  const st = usageStatusMeta(record.status, t);
  return (
    <div className="flex items-center gap-3 text-[12px] px-3 py-1.5 rounded-lg bg-surface border border-line">
      <span className="font-mono text-faint">{fmtDate(record.created_at)}</span>
      <span className="font-medium">{record.endpoint}</span>
      <span className="text-faint">−{record.units}</span>
      <Tag tone={st.tone as "good" | "bad" | "warn"} className="ml-auto">{st.label}</Tag>
    </div>
  );
}

function statusCodeTone(code: number | null): "good" | "bad" | "warn" | "neutral" {
  if (code === null) return "neutral";
  if (code >= 200 && code < 300) return "good";
  if (code === 429 || code === 402) return "warn";
  return "bad";
}

/** Chi tiết 1 lần gọi thật qua gateway — có payload/response nên xổ ra khi
 *  bấm, không hiện sẵn để danh sách không bị dài vô ích. `open`/`onToggle` do
 *  cha điều khiển (accordion — chỉ 1 dòng mở cùng lúc): mở dòng mới tự thu
 *  gọn dòng cũ, tránh nhiều khối JSON dài chồng nhau khó hình dung. */
function GatewayCallRow({
  call, open, onToggle,
}: { call: GatewayCallLogItem; open: boolean; onToggle: () => void }) {
  const t = useTranslations("orders");
  return (
    <div className="rounded-lg bg-surface border border-line overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] px-3 py-1.5 text-left hover:bg-raised transition-colors"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-3">
          <span className="font-mono text-faint">{fmtDate(call.created_at)}</span>
          <span className="font-medium">{call.endpoint}</span>
          <span className="text-faint">{call.latency_ms}ms</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3 whitespace-nowrap">
          <Tag tone={statusCodeTone(call.status_code)}>
            {call.status_code ?? t("connectionError")}
          </Tag>
          {call.units_charged != null && (
            <span className={cn("font-mono text-[11px]", call.units_charged > 0 ? "text-good" : "text-faint")}>
              {call.units_charged > 0 ? `−${call.units_charged}` : t("apiNotCharged")}
            </span>
          )}
          <span className="text-faint text-[11px]">{open ? t("collapse") : t("details")}</span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-2 border-t border-line pt-2">
          {call.request_payload && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-faint">Request</span>
                <CopyButton text={JSON.stringify(call.request_payload, null, 2)} />
              </div>
              <pre className="font-mono text-[11px] bg-base border border-line rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(call.request_payload, null, 2)}
              </pre>
            </div>
          )}
          {call.response_snippet && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-faint">Response</span>
                <CopyButton text={call.response_snippet} />
              </div>
              <pre className="font-mono text-[11px] bg-base border border-line rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                {call.response_snippet}
              </pre>
            </div>
          )}
          {call.error && (
            <div>
              <div className="text-[11px] text-faint mb-1">{t("errorStatus")}</div>
              <p className="text-[11px] text-bad">{call.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Tách bản bàn giao gateway thành (key, URL gọi).
 *
 *  `delivered_data` của đơn gateway là 2 dòng ("Gateway key: gwk_…" +
 *  "Gọi qua: …/<endpoint>"), không phải một chuỗi key trần. Đưa nguyên khối
 *  đó vào MaskedValue cho ra "Gate****int>" — che nhầm cả nhãn lẫn URL và
 *  giấu mất đúng phần buyer cần đọc. Chỉ KEY là bí mật; URL gọi thì không,
 *  nên hiện đầy đủ. */
function parseGatewayDelivery(raw: string | null | undefined): { key: string | null; callUrl: string | null } {
  if (!raw) return { key: null, callUrl: null };
  let key: string | null = null;
  let callUrl: string | null = null;
  for (const line of raw.split("\n")) {
    const keyMatch = line.match(/^\s*(?:Gateway key:\s*|gateway_key=)(\S+)\s*$/);
    if (keyMatch) key = keyMatch[1];
    const urlMatch = line.match(/^\s*(?:Gọi qua:\s*|Call URL:\s*|gateway_url=)(\S+)\s*$/);
    if (urlMatch) callUrl = urlMatch[1];
  }
  // Bàn giao không theo khuôn (đơn cũ, provider khác): coi cả khối là key —
  // giữ nguyên hành vi trước đây thay vì hiện trống.
  if (!key && !callUrl) return { key: raw.trim(), callUrl: null };
  return { key, callUrl };
}

function codeSamples(url: string, method: string, body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    curl: `curl -X ${method} \\\n  '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${json}'`,
    python: `import requests\n\nresp = requests.${method.toLowerCase()}(\n    "${url}",\n    json=${json},\n    timeout=40,\n)\nprint(resp.status_code, resp.json())`,
    javascript: `const resp = await fetch("${url}", {\n  method: "${method}",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${json}),\n});\nconsole.log(resp.status, await resp.json());`,
  };
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function EndpointDashboard({ data, onRefresh, viewerRole }: { data: DashboardData; onRefresh: () => void; viewerRole: "buyer" | "seller" }) {
  const locale = useLocale();
  const t = useTranslations("orders");
  const apiErrorMessage = useApiErrorMessage();
  const numberLocale = locale === "en" ? "en-US" : "vi-VN";
  const balance = data.balance;
  const { key: apiKey, callUrl } = parseGatewayDelivery(data.delivered_data);
  const endpoints = data.api?.endpoints ?? [];
  const [openCallId, setOpenCallId] = useState<number | null>(null);
  const [lang, setLang] = useState<"curl" | "python" | "javascript">("curl");
  const [tryUrl, setTryUrl] = useState(() => {
    const sample = endpoints[0]?.sample_body?.url;
    return typeof sample === "string" ? sample : "";
  });
  const [trying, setTrying] = useState(false);
  const [tryResult, setTryResult] = useState<GatewayTryResult | null>(null);
  const [tryError, setTryError] = useState("");
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [rotateError, setRotateError] = useState("");

  const urlFor = (name: string) => (callUrl ? callUrl.replace("<endpoint>", name) : "");
  const sampleUrl = (name: string) => (apiKey ? urlFor(name).replace(apiKey, "$GMMO_KEY") : urlFor(name));

  const runTry = async (endpoint: string) => {
    setTrying(true);
    setTryError("");
    setTryResult(null);
    try {
      setTryResult(await api.gatewayTry(data.order_id, endpoint, { url: tryUrl.trim() }));
      onRefresh();
    } catch (e) {
      setTryError(apiErrorMessage(e, t("apiTryFailed")));
    } finally {
      setTrying(false);
    }
  };

  const rotate = async () => {
    setRotating(true);
    setRotateError("");
    try {
      const r = await api.rotateGatewayKey(data.order_id);
      setNewKey(r.gateway_key);
      setConfirmRotate(false);
      onRefresh();
    } catch (e) {
      setRotateError(apiErrorMessage(e, t("apiRotateFailed")));
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="space-y-4">
      {data.api?.charge_only_success && (
        <Banner tone="good" icon={<Info size={15} />}>{t("apiChargeOnlySuccess")}</Banner>
      )}

      {(apiKey || callUrl) && (
        <div className="space-y-3 rounded-lg border border-line bg-raised p-3">
          {apiKey && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] text-faint">API Key</span>
                {viewerRole === "buyer" && (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(true)}>{t("apiRotate")}</Button>
                )}
              </div>
              <MaskedValue value={apiKey} />
            </div>
          )}
          {confirmRotate && (
            <div role="alertdialog" aria-labelledby="rotate-title" className="space-y-2 rounded-lg border border-bad/25 bg-bad-soft p-3">
              <p id="rotate-title" className="text-[13px] font-semibold text-bad">{t("apiRotateTitle")}</p>
              <p className="text-[12.5px] text-fg">{t("apiRotateBody")}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={rotate} disabled={rotating}>{rotating ? t("apiRotating") : t("apiRotateConfirm")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)} disabled={rotating}>{t("cancel")}</Button>
              </div>
              {rotateError && <p role="alert" className="text-[12px] text-bad">{rotateError}</p>}
            </div>
          )}
          {newKey && (
            <div role="status" className="space-y-1.5 rounded-lg border border-good/25 bg-good-soft p-3">
              <p className="text-[13px] font-semibold text-good">{t("apiRotated")}</p>
            </div>
          )}
        </div>
      )}

      {!balance ? (
        <Banner tone="warn" icon={<Info size={15} />} title={t("noRequestBalanceTitle")}>
          {t("noRequestBalanceBody")}
        </Banner>
      ) : (
        <>
          <div>
            <div className="mb-1.5 flex items-end justify-between">
              <span className="text-[12px] text-muted">{t("requestBalance")}</span>
              <span className="font-mono text-[13px] font-semibold tabular">
                {t("apiRemainingOf", { left: balance.units_remaining.toLocaleString(numberLocale), total: balance.units_total.toLocaleString(numberLocale) })}
              </span>
            </div>
            <UsageProgressBar used={balance.units_used} total={balance.units_total} />
            {balance.expires_at && (
              <p className="mt-1 text-right text-[11px] text-faint">{t("expiresLabel")} {fmtDate(balance.expires_at, locale)}</p>
            )}
          </div>

          {balance.units_remaining <= 0 ? (
            <Banner
              tone="bad" icon={<Info size={15} />} title={t("outOfCreditTitle")}
              action={data.product_id ? (
                <Link href={productPath({ id: data.product_id })}><Button size="sm" variant="secondary">{t("buyMorePack")}</Button></Link>
              ) : undefined}
            >
              {t("apiOutOfCreditBody")}
            </Banner>
          ) : balance.units_used / balance.units_total >= LOW_BALANCE_THRESHOLD && (
            <Banner
              tone="warn" icon={<Info size={15} />} title={t("lowCreditTitle")}
              action={data.product_id ? (
                <Link href={productPath({ id: data.product_id })}><Button size="sm" variant="secondary">{t("buyMorePack")}</Button></Link>
              ) : undefined}
            >
              {t("lowCreditBody", { count: balance.units_remaining.toLocaleString(numberLocale) })}
            </Banner>
          )}
        </>
      )}

      {endpoints.length > 0 ? endpoints.map((e) => {
        const samples = codeSamples(sampleUrl(e.name), e.method, e.sample_body);
        return (
          <div key={e.name} className="space-y-3 rounded-lg border border-line p-3">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[14px] font-semibold text-fg">{e.name}</span>
              <Tag tone="iris">{e.method}</Tag>
              <span className="text-[12px] text-muted">{t("apiUnitsPerCall", { n: e.units })}</span>
            </p>
            {e.summary && <p className="text-[12.5px] text-muted">{e.summary}</p>}
            {callUrl && (
              <MaskedValue value={urlFor(e.name)} display={apiKey ? urlFor(e.name).replace(apiKey, maskSecret(apiKey)) : urlFor(e.name)} copyValue={urlFor(e.name)} />
            )}
            <div role="tablist" aria-label={t("apiCodeLanguage")} className="flex gap-1.5">
              {(["curl", "python", "javascript"] as const).map((l) => (
                <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)}
                  className={cn("h-8 rounded-lg border px-3 text-[12.5px] font-medium", lang === l ? "border-fg bg-fg text-card" : "border-line-2 bg-card text-muted hover:text-fg")}>
                  {l === "curl" ? "curl" : l === "python" ? "Python" : "JavaScript"}
                </button>
              ))}
            </div>
            <div className="relative">
              <pre className="overflow-x-auto rounded-lg bg-ink-panel px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-white/90">{samples[lang]}</pre>
              <div className="absolute right-2 top-2"><CopyButton text={samples[lang]} /></div>
            </div>
            <ul className="space-y-1 text-[12px]">
              {e.params.map((p) => (
                <li key={p.name}><span className="font-mono font-semibold text-fg">{p.name}</span> <span className="text-muted">· {p.required ? t("apiRequired") : t("apiOptional")} · {p.description}</span></li>
              ))}
            </ul>
            {viewerRole === "buyer" && balance && balance.units_remaining > 0 && (
              <form className="space-y-2 border-t border-line pt-3" onSubmit={(ev) => { ev.preventDefault(); void runTry(e.name); }}>
                <label htmlFor={`try-${e.name}`} className="block text-[12.5px] font-medium text-fg">
                  {t("apiTry")} <span className="font-normal text-muted">· {t("apiTryHint")}</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <input id={`try-${e.name}`} type="url" required value={tryUrl} onChange={(ev) => setTryUrl(ev.target.value)}
                    placeholder="https://www.facebook.com/…"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-line-2 bg-surface px-3 text-[13px] focus:border-iris focus:outline-none" />
                  <Button size="sm" type="submit" disabled={trying || !tryUrl.trim()}>{trying ? t("apiTrying") : t("apiTrySend")}</Button>
                </div>
                {tryError && <p role="alert" className="text-[12px] text-bad">{tryError}</p>}
                {tryResult && (
                  <div className="space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                      <Tag tone={statusCodeTone(tryResult.status_code)}>{tryResult.status_code ?? t("connectionError")}</Tag>
                      {(tryResult.latency_ms / 1000).toFixed(1)}s
                      {tryResult.units_charged !== undefined && <span>· {tryResult.units_charged > 0 ? t("apiCharged", { n: tryResult.units_charged }) : t("apiNotCharged")}</span>}
                      {tryResult.units_remaining !== undefined && <span>· {t("requestsRemaining", { count: tryResult.units_remaining.toLocaleString(numberLocale) })}</span>}
                    </p>
                    <pre className="max-h-72 overflow-auto rounded-lg bg-ink-panel px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-white/90">
                      {prettyJson(tryResult.body)}{tryResult.truncated ? "\n…" : ""}
                    </pre>
                  </div>
                )}
              </form>
            )}
          </div>
        );
      }) : callUrl && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-base p-2 font-mono text-[11px]">
          {`curl -sS "${apiKey ? callUrl.replace(apiKey, "$GMMO_KEY") : callUrl}"`}
        </pre>
      )}

      {balance && balance.gateway_calls && balance.gateway_calls.length > 0 && (
        <div>
          <h4 className="mb-2 text-[12.5px] font-medium text-muted">
            {t("recentGatewayCalls")}
            <span className="ml-1.5 font-normal text-faint">{t("retainedDays")}</span>
          </h4>
          <div className="space-y-1.5">
            {balance.gateway_calls.map((c) => (
              <GatewayCallRow key={c.id} call={c} open={openCallId === c.id}
                onToggle={() => setOpenCallId((id) => (id === c.id ? null : c.id))} />
            ))}
          </div>
        </div>
      )}

      {balance && balance.records.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[12.5px] font-medium text-muted">{t("recentRequestHistory")}</summary>
          <div className="mt-2 space-y-1.5">
            {balance.records.map((r) => <UsageRecordRow key={r.id} record={r} />)}
          </div>
        </details>
      )}
    </div>
  );
}

/* ── Takedown Dashboard ── */

function taskStatusMeta(status: string, t: ReturnType<typeof useTranslations<"orders">>, ts: ReturnType<typeof useTranslations<"status.order">>) {
  const map: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral" }> = {
    pending: { label: ts("pending.label"), tone: "warn" },
    assigned: { label: t("taskAssigned"), tone: "iris" },
    processing: { label: ts("processing.label"), tone: "iris" },
    completed: { label: ts("completed.label"), tone: "good" },
    failed: { label: t("taskFailed"), tone: "bad" },
  };
  return map[status] ?? { label: status, tone: "neutral" as const };
}

function TakedownDashboard({ data }: { data: DashboardData }) {
  const t = useTranslations("orders");
  const tos = useTranslations("status.order");
  const tasks = data.tasks ?? [];
  const completed = tasks.filter((item) => item.status === "completed").length;
  const processing = tasks.filter((item) => item.status === "processing" || item.status === "assigned").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t("totalTasks")} value={tasks.length} />
        <StatCard label={tos("completed.label")} value={completed} />
        <StatCard label={tos("processing.label")} value={processing} />
      </div>

      {tasks.length > 0 && (
        <div>
          <h4 className="text-[12.5px] font-medium text-muted mb-2">{t("taskDetails")}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-3 font-medium text-faint">{t("colId")}</th>
                  <th className="py-2 pr-3 font-medium text-faint">{t("colPlatform")}</th>
                  <th className="py-2 pr-3 font-medium text-faint">{t("colUrl")}</th>
                  <th className="py-2 pr-3 font-medium text-faint">{t("colStatus")}</th>
                  <th className="py-2 pr-3 font-medium text-faint">{t("colAssignee")}</th>
                  <th className="py-2 font-medium text-faint">{t("colCreated")}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, index) => (
                  <TaskRow key={task.id} task={task} index={index + 1} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, index }: { task: DashboardTask; index: number }) {
  const t = useTranslations("orders");
  const tos = useTranslations("status.order");
  const st = taskStatusMeta(task.status, t, tos);
  return (
    <tr className="border-b border-line/50">
      {/* Position in this order's task list — task row ids stay internal. */}
      <td className="py-2 pr-3 font-mono text-faint">{lineLabel(index)}</td>
      <td className="py-2 pr-3">{task.platform}</td>
      <td className="py-2 pr-3 max-w-[200px] truncate">
        <span className="font-mono text-[11px]">{task.target_url}</span>
      </td>
      <td className="py-2 pr-3"><Tag tone={st.tone}>{st.label}</Tag></td>
      <td className="py-2 pr-3 text-muted">{task.assignee ?? t("unassigned")}</td>
      <td className="py-2 text-muted">{fmtDate(task.created_at)}</td>
    </tr>
  );
}

/* ── Default Dashboard ── */

function DefaultDashboard({ data }: { data: DashboardData }) {
  const t = useTranslations("orders");
  return (
    <div>
      {data.delivered_data ? (
        <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-2.5 whitespace-pre-wrap break-all">
          {data.delivered_data}
        </pre>
      ) : (
        <p className="text-[12.5px] text-muted">{t("noDashboardData")}</p>
      )}
    </div>
  );
}

/* ── Main ServiceDashboard ── */

export default function ServiceDashboard({ orderId, viewerRole = "buyer" }: { orderId: number; viewerRole?: "buyer" | "seller" }) {
  const t = useTranslations("orders");
  const apiErrorMessage = useApiErrorMessage();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const d = await api.orderDashboard(orderId);
      setData(d);
    } catch (e) {
      setError(apiErrorMessage(e, t("dashboardLoadFailed")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (loading) return <Spinner label={t("loadingDashboard")} />;
  if (error) return <p className="text-[12px] text-bad py-2">{error}</p>;
  if (!data) return null;

  return (
    <Card className="p-4 mt-3 bg-raised/40">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold">
          {data.product_title ? t("dashboardTitleNamed", { title: data.product_title }) : t("dashboardTitle")}
        </h3>
        <Tag tone={data.status === "delivered" ? "iris" : data.status === "completed" ? "good" : "neutral"}>
          {data.service_type}
        </Tag>
      </div>
      {data.balance ? <EndpointDashboard data={data} onRefresh={load} viewerRole={viewerRole} />
        : (data.tasks && data.tasks.length > 0) ? <TakedownDashboard data={data} />
        : (data.resources && data.resources.length > 0) ? <ProxyDashboard data={data} />
        : data.service_type === "proxy" ? <ProxyDashboard data={data} />
        : data.service_type === "endpoint" ? <EndpointDashboard data={data} onRefresh={load} viewerRole={viewerRole} />
        : data.service_type === "takedown" ? <TakedownDashboard data={data} />
        : <DefaultDashboard data={data} />}
    </Card>
  );
}
