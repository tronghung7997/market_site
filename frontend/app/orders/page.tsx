"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Dispute, Order, OrderStats, ProxyState, Resource } from "@/lib/types";
import { EVIDENCE_TYPES, evidenceFieldLabel, evidenceTypeLabel } from "@/lib/dispute-evidence";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { orderStatus } from "@/lib/order-status";
import { Shield, Star, Check, Info, ChevronRight, Plug, Search, X } from "@/components/Icons";
import ServiceDashboard from "@/components/ServiceDashboard";
import { Button, Card, CopyButton, Input, Monogram, Pagination, Select, Spinner, Tag, Textarea } from "@/components/ui";

const TIMELINE_STEPS = [
  { key: "pending", label: "Đặt hàng" },
  { key: "processing", label: "Xử lý" },
  { key: "delivered", label: "Giao hàng" },
  { key: "completed", label: "Hoàn tất" },
];

function stepIndex(status: string): number {
  return TIMELINE_STEPS.findIndex((s) => s.key === status);
}

function StatusTimeline({ status }: { status: string }) {
  const isBad = ["disputed", "refunded", "cancelled"].includes(status);
  const current = status === "completed" ? 3 : status === "delivered" ? 2 : stepIndex(status);

  if (isBad) return null;

  return (
    <div className="flex items-center mt-4 mb-1 gap-0 px-1">
      {TIMELINE_STEPS.map((step, i) => {
        const done = current >= i;
        return (
          <div key={step.key} className={cn("flex items-center", i > 0 && "flex-1")}>
            {i > 0 && <div className={cn("h-[2px] flex-1 rounded-full transition-colors", done ? "bg-iris" : "bg-line")} />}
            <div className="flex flex-col items-center gap-1.5">
              <div className={cn(
                "w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold shrink-0 transition-colors",
                done ? "bg-iris text-white shadow-[0_0_0_3px_var(--color-iris-soft)]" : "bg-surface border-2 border-line text-faint",
              )}>
                {done ? "✓" : i + 1}
              </div>
              <span className={cn("text-[10.5px] whitespace-nowrap", done ? "text-fg font-medium" : "text-faint")}>{step.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Chỉ order dùng adapter dproxy có state này (backend 404 với order khác) —
// tách hẳn khỏi "Đổi gateway key" (seller_gateway/credit forward) để buyer
// không nhầm hai khái niệm khác nhau: đây là đổi IP của MỘT proxy độc quyền
// đã cấp, không phải cấp lại key truy cập.
// Poll while (and only while) the allocation is offline — a buyer who
// already has /orders open shouldn't have to reload to see reconciliation
// bring it back (review fixes
// docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md P2).
// Stops the moment status leaves "offline" (recovered, expired, or errored).
const OFFLINE_POLL_MS = 20_000;

// Tooltip này chỉ dành cho proxy KHÔNG có cổng vào cố định (DProxy, proxy
// tĩnh): đổi IP có thể kéo theo Host/Port/Username/Password mới nên buyer cần
// đọc lại "Dữ liệu bàn giao". Key xoay có tấm địa chỉ cố định với dòng giải
// thích riêng ngay trên tấm — không cần tooltip.
const ROTATE_EXPLAINER =
  "Đổi IP yêu cầu nhà cung cấp cấp một IP mới. Tuỳ loại proxy, Host/Port/Username/Password có thể " +
  "thay đổi theo — xem lại phần “Dữ liệu bàn giao” sau khi đổi. Giữa hai lần đổi có thời gian chờ.";

/** "còn 23 giờ" — hạn dùng nói theo lịch người đọc. Chuỗi ISO chỉ còn nằm
 *  trong bản bàn giao gốc (biên nhận), không bắt buyer tự dịch UTC nữa. */
function timeLeftLabel(expiresAt: string): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `còn ${Math.max(1, minutes)} phút`;
  if (minutes < 48 * 60) return `còn ${Math.floor(minutes / 60)} giờ`;
  return `còn ${Math.floor(minutes / (24 * 60))} ngày`;
}

function OrderProxyPanel({ orderId, deliveredData, onDelivered, onPlate }: {
  orderId: number;
  /** Bản bàn giao gốc — khi có tấm địa chỉ (key xoay), panel tự trình bày nó
   *  dưới dạng biên nhận thu gọn thay cho khối <pre> to ở ngoài. */
  deliveredData?: string | null;
  onDelivered?: (orderId: number, deliveredData: string) => void;
  /** Báo cho danh sách cha: đơn này có tấm địa chỉ, đừng vẽ khối "Dữ liệu bàn
   *  giao" thô nữa — mọi thứ buyer cần đã nằm trong panel này. */
  onPlate?: (orderId: number) => void;
}) {
  const [state, setState] = useState<ProxyState | null>(null);
  const [applicable, setApplicable] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [showRaw, setShowRaw] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.orderProxyState(orderId);
      setState(s);
      setCooldown(s.cooldown_remaining_seconds);
    } catch {
      setApplicable(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (state?.status !== "offline") return;
    const t = setInterval(load, OFFLINE_POLL_MS);
    return () => clearInterval(t);
  }, [state?.status, load]);

  const handleRotate = async () => {
    setError(null);
    setRotating(true);
    try {
      const result = await api.rotateOrderProxy(orderId);
      setState((prev) => prev ? {
        ...prev, public_ip: result.public_ip, last_rotated_at: result.last_rotated_at,
        cooldown_remaining_seconds: result.cooldown_seconds ?? 0,
      } : prev);
      setCooldown(result.cooldown_seconds ?? 0);
      // Rotate can change more than IP (DProxy may rotate the password too,
      // IP/expiry unchanged) — the rotate response already carries the fresh
      // delivered_data snapshot in the same round trip, so propagate it to
      // the parent's order list instead of leaving "Dữ liệu bàn giao" stale
      // until the next full page load (review fixes
      // docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md P0).
      if (result.delivered_data) onDelivered?.(orderId, result.delivered_data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Đổi IP thất bại, vui lòng thử lại.");
    } finally {
      setRotating(false);
    }
  };

  const hasPlate = Boolean(state?.gateway_host && state?.gateway_port);
  useEffect(() => { if (hasPlate) onPlate?.(orderId); }, [hasPlate, orderId, onPlate]);

  if (!applicable || !state) return null;

  const left = timeLeftLabel(state.expires_at);
  const expiresLabel = new Date(state.expires_at).toLocaleString("vi-VN", {
    hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric",
  });

  return (
    <div className="mt-3 rounded-lg border border-line overflow-hidden">
      {/* Tấm địa chỉ — thứ duy nhất buyer cấu hình, nên nó đứng đầu, to nhất,
          và nút sao chép cho ra đúng chuỗi "host:port" dán được vào tool. */}
      {hasPlate && (
        <div className="px-3.5 py-3 bg-raised">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] text-faint uppercase tracking-wider">
              <Plug size={12} /> Địa chỉ proxy · cố định
            </span>
            <CopyButton text={`${state.gateway_host}:${state.gateway_port}`} />
          </div>
          <p className="font-mono text-[17px] leading-snug mt-1.5 break-all">
            {state.gateway_host}
            <span className="text-faint">:</span>
            <span className="text-iris-hi font-semibold">{state.gateway_port}</span>
          </p>
          <p className="text-[11.5px] text-muted mt-1">
            Cắm vào tool của bạn một lần — không đổi khi đổi IP, không cần user/pass.
          </p>
        </div>
      )}

      <div className={cn("px-3.5 py-2.5 flex items-start justify-between gap-2 flex-wrap", hasPlate && "border-t border-line")}>
        <div className="min-w-0">
          {/* Key xoay không có IP cố định — chỉ vẽ khối IP khi thực sự có. */}
          {state.public_ip ? (
            <p className="flex items-baseline gap-2">
              <span className="text-[10.5px] text-faint uppercase tracking-wider">IP đang ra</span>
              <span className="font-mono text-[13px]">{state.public_ip}</span>
            </p>
          ) : (
            <p className="text-[10.5px] text-faint uppercase tracking-wider">Trạng thái proxy</p>
          )}
          <p className="text-[11px] text-faint mt-0.5">
            {left ? `${left} · hết hạn ${expiresLabel}` : `Đã hết hạn ${expiresLabel}`}
            {hasPlate && " · mỗi IP sống 15–30 phút"}
          </p>
          {state.status === "offline" && (
            <p className="text-[11px] text-warn mt-0.5 max-w-[260px]">
              Proxy đang tạm ngoại tuyến. Hệ thống vẫn giữ nguyên proxy của bạn và đang chờ nhà cung cấp khôi phục.
            </p>
          )}
          {error && <p className="text-[12px] text-bad mt-1">{error}</p>}
        </div>
        {state.rotation_available && (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="secondary" onClick={handleRotate} disabled={rotating || cooldown > 0}>
              {rotating ? "Đang đổi IP…" : cooldown > 0 ? `Đổi IP (${cooldown}s)` : "Đổi IP"}
            </Button>
            {!hasPlate && (
              <span title={ROTATE_EXPLAINER} className="text-faint cursor-help shrink-0">
                <Info size={13} />
              </span>
            )}
          </div>
        )}
      </div>

      {state.whitelist_supported && (
        <ProxyWhitelistBox orderId={orderId} state={state} onSaved={(s) => setState(s)} onDelivered={onDelivered} />
      )}

      {/* Biên nhận: bản bàn giao nguyên văn của backend — nguồn sự thật khi
          cần đối chiếu, nhưng không còn là giao diện chính. */}
      {hasPlate && deliveredData && (
        <div className="px-3.5 pb-3">
          <Disclosure label="Bản bàn giao gốc" labelOpen="Thu gọn bản bàn giao gốc" open={showRaw} onToggle={() => setShowRaw((v) => !v)}>
            <div className="mt-2">
              <div className="flex justify-end mb-1"><CopyButton text={deliveredData} /></div>
              <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-2.5 whitespace-pre-wrap break-all">{deliveredData}</pre>
            </div>
          </Disclosure>
        </div>
      )}
    </div>
  );
}

/** Khai báo IP được phép dùng proxy.
 *
 *  Nhà cung cấp key xoay khoá proxy theo IP: proxy chấp nhận kết nối TCP rồi
 *  IM LẶNG nuốt request nếu IP người dùng không được đăng ký — không một thông
 *  báo lỗi nào, nhìn hệt như "proxy chết". Đây là nguyên nhân hỗ trợ số một
 *  của loại hàng này, nên ô nhập phải nằm ngay cạnh thông tin proxy chứ không
 *  giấu trong trang cài đặt nào đó.
 *
 *  Chỉ render khi backend báo `whitelist_supported` — đơn DProxy không thấy gì. */
function ProxyWhitelistBox({
  orderId, state, onSaved, onDelivered,
}: {
  orderId: number;
  state: ProxyState;
  onSaved: (s: ProxyState) => void;
  onDelivered?: (orderId: number, deliveredData: string) => void;
}) {
  const saved = state.whitelist_ips ?? "";
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "good" | "warn" | "bad" } | null>(null);

  useEffect(() => { setValue(state.whitelist_ips ?? ""); }, [state.whitelist_ips]);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const ips = value.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await api.setOrderProxyWhitelist(orderId, ips);
      onSaved({ ...state, whitelist_ips: res.whitelist_ips, public_ip: res.public_ip });
      if (res.delivered_data) onDelivered?.(orderId, res.delivered_data);
      setMsg(res.applied
        ? { text: "Đã kích hoạt — proxy dùng được ngay từ IP này.", tone: "good" }
        // Lưu rồi nhưng chưa kịp có hiệu lực: nói thẳng bước tiếp theo, đừng
        // để buyer tưởng xong rồi ngồi thắc mắc sao proxy vẫn câm.
        : { text: "Đã lưu IP, nhưng chưa áp dụng được lúc này — bấm “Đổi IP” sau ít phút.", tone: "warn" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Lưu thất bại", tone: "bad" });
    } finally {
      setSaving(false);
    }
  };

  const activated = Boolean(saved);

  return (
    <div className={cn("px-3.5 py-2.5 border-t border-line", !activated && "bg-warn-soft/60")}>
      {activated ? (
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-good mb-1.5">
          <Check size={12} /> Proxy đang mở cho IP <span className="font-mono">{saved}</span>
        </p>
      ) : (
        <>
          <p className="text-[10.5px] uppercase tracking-wider font-semibold text-warn mb-1">Chưa kích hoạt</p>
          <p className="text-[12px] text-warn mb-1.5 leading-relaxed">
            Proxy chỉ trả lời IP bạn khai báo. Nhập IP mạng của thiết bị sẽ dùng proxy
            (xem tại <span className="font-mono">api.ipify.org</span>) rồi bấm Kích hoạt.
          </p>
        </>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="vd 113.161.20.5"
          disabled={saving}
          className="flex-1 font-mono text-[12.5px]"
        />
        <Button size="sm" variant={activated ? "secondary" : "primary"} onClick={handleSave} disabled={saving || value.trim() === saved.trim()}>
          {saving ? "Đang lưu…" : activated ? "Cập nhật" : "Kích hoạt"}
        </Button>
      </div>
      {msg && (
        <p className={cn("text-[11.5px] mt-1.5", msg.tone === "good" ? "text-good" : msg.tone === "warn" ? "text-warn" : "text-bad")}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function Disclosure({ label, labelOpen, open, onToggle, children }: {
  label: string; labelOpen: string; open: boolean; onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-line">
      <button onClick={onToggle} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:text-iris transition-colors">
        <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} />
        {open ? labelOpen : label}
      </button>
      {open && children}
    </div>
  );
}

function DisputeModal({ orderId, onClose, onSuccess }: { orderId: number; onClose: () => void; onSuccess: () => void }) {
  const [reason, setReason] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [evidenceValues, setEvidenceValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fields = evidenceType ? EVIDENCE_TYPES[evidenceType]?.fields ?? [] : [];

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSubmitting(true); setError("");
    try {
      const evidence = Object.fromEntries(
        Object.entries(evidenceValues).filter(([, v]) => v.trim() !== ""),
      );
      await api.openDispute(
        orderId,
        reason.trim(),
        evidenceType || undefined,
        Object.keys(evidence).length > 0 ? evidence : undefined,
      );
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <Card className="w-full max-w-[420px] p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-[16px] font-semibold">Mở khiếu nại — Đơn #{orderId}</h3>
        <Textarea rows={4} placeholder="Mô tả lý do khiếu nại…" value={reason} onChange={(e) => setReason(e.target.value)} />

        <div className="space-y-1">
          <label className="text-[12px] text-faint">Loại bằng chứng (tuỳ chọn)</label>
          <Select
            value={evidenceType}
            onChange={(e) => { setEvidenceType(e.target.value); setEvidenceValues({}); }}
          >
            <option value="">Không có bằng chứng cụ thể</option>
            {Object.entries(EVIDENCE_TYPES).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </Select>
        </div>

        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="text-[12px] text-faint">{f.label}</label>
            <Input
              placeholder={f.placeholder}
              value={evidenceValues[f.key] ?? ""}
              onChange={(e) => setEvidenceValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}

        {error && <p className="text-[12px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button variant="danger" onClick={handleSubmit} disabled={submitting || !reason.trim()}>
            {submitting ? "Đang gửi…" : "Gửi khiếu nại"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function OrderResources({ orderId }: { orderId: number }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!loaded) {
      try { setResources(await api.orderResources(orderId)); } catch { /* ignore */ }
      setLoaded(true);
    }
  };

  const fmtExpiry = (iso: string | null) => {
    if (!iso) return "Vĩnh viễn";
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "Đã hết hạn";
    return `Còn ${Math.ceil(ms / 86400000)} ngày`;
  };
  const tone = (s: string) => s === "assigned" ? "good" : s === "expired" ? "warn" : s === "error" ? "bad" : "neutral";
  const label = (s: string) => ({ assigned: "Đang dùng", expired: "Hết hạn", error: "Lỗi", available: "Sẵn sàng" }[s] ?? s);

  return (
    <Disclosure label="Xem trạng thái tài nguyên" labelOpen="Ẩn tài nguyên" open={open} onToggle={toggle}>
      <div className="mt-2.5 space-y-1.5">
        {loaded && resources.length === 0 && <p className="text-[12px] text-faint">Không có tài nguyên gắn với đơn này.</p>}
        {resources.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-[12.5px] px-3 py-2 rounded-lg bg-raised border border-line">
            <span className="font-mono text-faint">#{r.id}</span>
            <Tag tone={tone(r.status)}>{label(r.status)}</Tag>
            <span className="ml-auto text-muted">{fmtExpiry(r.expires_at)}</span>
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

const DISPUTE_STATUS_INFO: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral" }> = {
  open: { label: "Đang chờ quản trị viên xử lý", tone: "warn" },
  resolved_refund: { label: "Đã hoàn tiền toàn bộ", tone: "bad" },
  resolved_reject: { label: "Đã từ chối — giữ nguyên đơn", tone: "neutral" },
  resolved_partial_refund: { label: "Đã hoàn tiền một phần", tone: "bad" },
  resolved_replace: { label: "Đã đổi sản phẩm mới", tone: "iris" },
  resolved_extend_warranty: { label: "Đã gia hạn bảo hành", tone: "iris" },
};

function OrderDispute({ orderId }: { orderId: number }) {
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!loaded) {
      try { setDispute(await api.orderDispute(orderId)); } catch { /* ignore */ }
      setLoaded(true);
    }
  };

  const info = dispute ? (DISPUTE_STATUS_INFO[dispute.status] ?? { label: dispute.status, tone: "neutral" as const }) : null;

  return (
    <Disclosure label="Xem khiếu nại" labelOpen="Ẩn khiếu nại" open={open} onToggle={toggle}>
      <div className="mt-2.5 space-y-2 text-[12.5px]">
        {loaded && !dispute && <p className="text-faint">Không tải được thông tin khiếu nại.</p>}
        {dispute && info && (
          <>
            <Tag tone={info.tone}>{info.label}</Tag>

            {/* Khiếu nại là một cuộc hội thoại — hiển thị đúng như vậy:
                mỗi bên một vạch màu, đọc từ trên xuống là hết chuyện. */}
            <div className="mt-1 space-y-3">
              <div className="border-l-2 border-iris/40 pl-3">
                <p className="text-[11px] font-semibold text-iris-hi mb-0.5">
                  Bạn <span className="font-normal text-faint">· {new Date(dispute.created_at).toLocaleString("vi-VN")}</span>
                </p>
                <p>{dispute.reason}</p>
                {dispute.evidence && Object.keys(dispute.evidence).length > 0 && (
                  <div className="mt-1.5 space-y-0.5 text-[11.5px]">
                    <p className="text-faint">Bằng chứng — {evidenceTypeLabel(dispute.evidence_type)}</p>
                    {Object.entries(dispute.evidence).map(([key, value]) => (
                      <p key={key} className="text-muted">
                        <span className="text-faint">{evidenceFieldLabel(dispute.evidence_type, key)}: </span>
                        {value}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {dispute.seller_note && (
                <div className="border-l-2 border-line-2 pl-3">
                  <p className="text-[11px] font-semibold text-muted mb-0.5">Người bán</p>
                  <p>{dispute.seller_note}</p>
                </div>
              )}

              {(dispute.admin_note || dispute.resolved_at) && (
                <div className="border-l-2 border-good/50 pl-3">
                  <p className="text-[11px] font-semibold text-good mb-0.5">
                    Quản trị viên
                    {dispute.resolved_at && (
                      <span className="font-normal text-faint"> · {new Date(dispute.resolved_at).toLocaleString("vi-VN")}</span>
                    )}
                  </p>
                  <p>{dispute.admin_note ?? info.label}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Disclosure>
  );
}

/* ─── Tabs ─── */
const TABS = [
  { key: "", label: "Tất cả" },
  { key: "active", label: "Hoạt động" },
  { key: "disputed", label: "Khiếu nại" },
  { key: "deleted", label: "Đã xoá" },
] as const;

const SORT_OPTIONS = [
  { value: "newest", label: "Mới nhất" },
  { value: "oldest", label: "Cũ nhất" },
  { value: "price_desc", label: "Giá cao → thấp" },
  { value: "price_asc", label: "Giá thấp → cao" },
];

const PER_PAGE_OPTIONS = [10, 20, 50];

/** Đơn đã kết thúc (huỷ / hoàn tiền) — nén thành một dòng yên tĩnh: lý do +
 *  xác nhận tiền đã về ví. Sân khấu nhường cho các đơn đang sống. */
function TerminalOrderRow({ order: o }: { order: Order }) {
  const st = orderStatus(o.status);
  return (
    <Card className="px-4 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <Monogram text={o.product_title ?? "??"} className="h-8 w-8 text-[12px] text-faint" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium truncate">{o.product_title ?? `Đơn #${o.id}`}</span>
            <Tag tone={st.tone}>{st.label}</Tag>
          </div>
          <p className="text-[11.5px] text-faint mt-0.5">
            Đơn #{o.id} · {new Date(o.created_at).toLocaleDateString("vi-VN")}
          </p>
          {o.cancel_reason && (
            <p className="text-[11.5px] text-muted mt-0.5 leading-relaxed">{o.cancel_reason}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-[13px] tabular text-muted">{vnd(o.total_amount)}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-good">
            <Check size={11} /> Đã hoàn về ví
          </p>
        </div>
      </div>
      {o.has_dispute && <OrderDispute orderId={o.id} />}
    </Card>
  );
}

export default function OrdersPage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [disputeOrderId, setDisputeOrderId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [reviewOrderId, setReviewOrderId] = useState<number | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewedOrders, setReviewedOrders] = useState<Set<number>>(new Set());
  // Đơn có tấm địa chỉ proxy cố định (key xoay): panel proxy tự trình bày cả
  // bản bàn giao, khối <pre> thô ở ngoài chỉ còn gây trùng lặp nên ẩn đi.
  const [plateOrders, setPlateOrders] = useState<Set<number>>(new Set());
  const handlePlate = useCallback((id: number) => {
    setPlateOrders((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const [dashboardOpen, setDashboardOpen] = useState<Set<number>>(new Set());

  // Bộ lọc — áp tức thì, không có nút "Lọc": search debounce 350ms,
  // ngày/sắp xếp áp ngay khi đổi.
  const [tab, setTab] = useState(() => searchParams.get("status") ?? "");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);

  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch, dateFrom, dateTo, sort, perPage]);

  const fetchOrders = useCallback(async (params: {
    status?: string; search?: string; date_from?: string; date_to?: string;
    sort?: string; page?: number; per_page?: number;
  }) => {
    setLoading(true);
    try {
      const res = await api.orders(params);
      setOrders(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []);

  const filterParams = useCallback(() => ({
    status: tab || undefined,
    search: debouncedSearch.trim() || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    sort,
    page,
    per_page: perPage,
  }), [tab, debouncedSearch, dateFrom, dateTo, sort, page, perPage]);

  useEffect(() => {
    if (authLoading) return;
    if (!account) { router.push("/login"); return; }
    api.orderStats().then(setStats).catch(() => {});
    fetchOrders(filterParams());
  }, [account, authLoading, router, fetchOrders, filterParams]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const hasFilters = search !== "" || dateFrom !== "" || dateTo !== "" || sort !== "newest";

  function clearFilters() {
    setSearch(""); setDateFrom(""); setDateTo(""); setSort("newest");
  }

  async function handleConfirm(orderId: number) {
    setConfirmingId(orderId);
    try {
      const updated = await api.confirmOrder(orderId);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
      showToast("Đã xác nhận nhận hàng thành công!");
      api.orderStats().then(setStats).catch(() => {});
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleReviewSubmit(orderId: number) {
    setReviewSubmitting(true);
    try {
      await api.submitReview(orderId, reviewRating, reviewComment || undefined);
      setReviewedOrders((prev) => new Set(prev).add(orderId));
      setReviewOrderId(null); setReviewRating(5); setReviewComment("");
      showToast("Đánh giá thành công!");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setReviewSubmitting(false);
    }
  }

  function handleDisputeSuccess() {
    setDisputeOrderId(null);
    showToast("Đã gửi khiếu nại thành công!");
    fetchOrders(filterParams());
    api.orderStats().then(setStats).catch(() => {});
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const tabCounts: Record<string, number | undefined> = {
    "": stats?.total,
    active: stats?.active,
    disputed: stats?.disputed,
    deleted: undefined,
  };

  if (authLoading) return <div className="w-full mx-auto max-w-[920px] px-6 py-16"><Spinner /></div>;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-4 py-2.5 rounded-lg text-[13px] font-medium shadow-card-lg bg-good text-white">
          {toast}
        </div>
      )}

      {disputeOrderId !== null && (
        <DisputeModal orderId={disputeOrderId} onClose={() => setDisputeOrderId(null)} onSuccess={handleDisputeSuccess} />
      )}

      <div className="grid lg:grid-cols-[260px_1fr] gap-6 min-w-0">
        {/* ─── Cột trái: tiêu đề, biên lai tổng quan, thư mục trạng thái, bộ lọc ─── */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start space-y-4">
          <div>
            <h2 className="font-serif text-[24px] tracking-tight">Đơn hàng</h2>
            <p className="text-[12.5px] text-muted mt-0.5">Theo dõi và quản lý các đơn đã đặt</p>
          </div>

          {/* Tổng quan kiểu biên lai: nhãn trái, số phải, tổng chi chốt sổ */}
          {stats && (
            <Card className="px-4 py-3.5">
              <dl className="text-[12.5px] space-y-2">
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">Tổng đơn</dt>
                  <dd className="font-semibold tabular">{stats.total}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">Đang hoạt động</dt>
                  <dd className={cn("font-semibold tabular", stats.active > 0 ? "text-iris-hi" : "")}>{stats.active}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">Khiếu nại</dt>
                  <dd className={cn("font-semibold tabular", stats.disputed > 0 ? "text-bad" : "")}>{stats.disputed}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-dashed border-line-2 pt-2.5 mt-2.5">
                  <dt className="text-muted">Đã chi</dt>
                  <dd className="font-mono font-semibold tabular text-[13px]">{vnd(stats.total_spend)}</dd>
                </div>
              </dl>
            </Card>
          )}

          {/* Thư mục trạng thái — kiểu hộp thư, số đếm bên phải */}
          <Card className="p-1.5">
            {TABS.map((t) => {
              const active = tab === t.key;
              const count = tabCounts[t.key];
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors",
                    active ? "bg-iris-soft font-medium text-iris-hi" : "text-muted hover:bg-raised hover:text-fg",
                  )}
                >
                  {t.label}
                  {count != null && (
                    <span className={cn("tabular text-[11.5px]", active ? "font-semibold" : "text-faint")}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </Card>

          {/* Bộ lọc — áp tức thì, không cần nút "Lọc" */}
          <Card className="p-4 space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <input
                type="text"
                placeholder="Tìm theo mã đơn…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-lg bg-surface border border-line pl-8 pr-7 text-[13px] placeholder:text-faint focus:border-iris focus:outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Xóa tìm kiếm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 min-w-0">
              <div className="min-w-0">
                <label className="text-[11px] text-faint block mb-1">Từ ngày</label>
                <input
                  type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 w-full min-w-0 rounded-lg bg-surface border border-line px-2 text-[12px] text-muted focus:border-iris focus:outline-none"
                />
              </div>
              <div className="min-w-0">
                <label className="text-[11px] text-faint block mb-1">Đến ngày</label>
                <input
                  type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 w-full min-w-0 rounded-lg bg-surface border border-line px-2 text-[12px] text-muted focus:border-iris focus:outline-none"
                />
              </div>
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sắp xếp"
              className="h-9 w-full rounded-lg bg-surface border border-line px-2.5 text-[12.5px] text-muted focus:border-iris focus:outline-none cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-raised hover:text-fg"
              >
                <X size={13} />
                Xóa lọc
              </button>
            )}
          </Card>
        </aside>

        {/* ─── Cột phải: danh sách đơn ─── */}
        <div className="min-w-0">
        {loading ? (
          <div className="flex flex-col gap-3.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-5">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 shrink-0 rounded-lg bg-raised animate-shimmer" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-4 w-1/3 rounded bg-raised animate-shimmer" />
                    <div className="h-3 w-1/2 rounded bg-raised animate-shimmer" />
                  </div>
                  <div className="h-5 w-24 rounded bg-raised animate-shimmer" />
                </div>
              </Card>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <Card className="p-8 flex flex-col items-center gap-3 text-center">
            <p className="text-[13px] text-muted">
              {hasFilters || tab !== "" ? "Không có đơn nào khớp bộ lọc hiện tại." : "Bạn chưa có đơn hàng nào."}
            </p>
            {hasFilters ? (
              <Button variant="secondary" size="sm" onClick={clearFilters}>Xóa bộ lọc</Button>
            ) : (
              <Link href="/"><Button size="sm">Khám phá chợ</Button></Link>
            )}
          </Card>
        ) : (
          <div className="flex flex-col gap-3.5">
            {orders.map((o) => {
              // Đơn đã kết thúc thất bại → dòng nén, không banner
              if (o.status === "cancelled" || o.status === "refunded") {
                return <TerminalOrderRow key={o.id} order={o} />;
              }
              const st = orderStatus(o.status);
              return (
                <Card key={o.id} className="p-0 overflow-hidden">
                  {/* Thanh định danh — "biển số" của đơn: mã + ngày trái, trạng thái + tiền phải.
                      Đây là ranh giới thị giác giữa các đơn trong danh sách. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-raised/50 border-b border-line">
                    <span className="font-mono text-[13px] font-semibold">#{o.id}</span>
                    <span className="text-[11.5px] text-faint">{new Date(o.created_at).toLocaleString("vi-VN")}</span>
                    <div className="ml-auto flex items-center gap-2.5">
                      <Tag tone={st.tone}>{st.label}</Tag>
                      <span className="font-mono text-[14px] font-semibold tabular">{vnd(o.total_amount)}</span>
                    </div>
                  </div>

                  <div className="px-4 pb-4 pt-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Monogram text={o.product_title ?? "??"} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[14px] truncate">{o.product_title ?? `Đơn #${o.id}`}</div>
                      <div className="text-[12px] text-muted truncate">
                        {o.variant_name ? `${o.variant_name} · ` : ""}SL {o.quantity}
                      </div>
                    </div>
                    {o.escrow_expires_at && o.status === "delivered" && (
                      <div className="text-[11px] text-faint flex items-center gap-1 shrink-0">
                        <Shield size={11} className="text-good" /> Ký quỹ đến {new Date(o.escrow_expires_at).toLocaleDateString("vi-VN")}
                      </div>
                    )}
                  </div>

                  {st.hint && <p className="text-[12px] text-muted mt-2.5">{st.hint}</p>}

                  {o.has_dispute && <OrderDispute orderId={o.id} />}

                  {!["disputed", "refunded", "cancelled"].includes(o.status) && (
                    <div className="mt-3 rounded-lg bg-raised/60 border border-line/70">
                      <StatusTimeline status={o.status} />
                    </div>
                  )}

                  {o.delivered_data && !plateOrders.has(o.id) && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10.5px] text-faint uppercase tracking-wider">Dữ liệu bàn giao</span>
                        <CopyButton text={o.delivered_data} />
                      </div>
                      <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-2.5 whitespace-pre-wrap break-all">{o.delivered_data}</pre>
                    </div>
                  )}

                  {(o.status === "delivered" || o.status === "completed") && (
                    <OrderProxyPanel
                      orderId={o.id}
                      deliveredData={o.delivered_data}
                      onPlate={handlePlate}
                      onDelivered={(id, deliveredData) =>
                        setOrders((prev) => prev.map((ord) => (ord.id === id ? { ...ord, delivered_data: deliveredData } : ord)))
                      }
                    />
                  )}

                  {o.status === "delivered" && (
                    <div className="flex gap-2 mt-3.5">
                      <Button size="sm" onClick={() => handleConfirm(o.id)} disabled={confirmingId === o.id}>
                        {confirmingId === o.id ? "Đang xác nhận…" : "Xác nhận đã nhận"}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDisputeOrderId(o.id)}>Mở khiếu nại</Button>
                    </div>
                  )}

                  {o.status === "completed" && !o.has_review && !reviewedOrders.has(o.id) && reviewOrderId !== o.id && (
                    <div className="mt-3.5">
                      <Button size="sm" variant="secondary" onClick={() => { setReviewOrderId(o.id); setReviewRating(5); setReviewComment(""); }}>
                        <Star size={13} /> Đánh giá
                      </Button>
                    </div>
                  )}
                  {o.status === "completed" && (o.has_review || reviewedOrders.has(o.id)) && (
                    <p className="flex items-center gap-1.5 text-[12px] mt-2.5 text-good font-medium">
                      <Star size={12} className="fill-good" /> Đã đánh giá
                    </p>
                  )}
                  {reviewOrderId === o.id && (
                    <div className="mt-3 p-3.5 rounded-lg border border-line bg-raised">
                      <div className="flex gap-1 mb-2">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button key={s} onClick={() => setReviewRating(s)} className="p-0.5">
                            <Star size={18} className={s <= reviewRating ? "text-warn fill-warn" : "text-line-2"} />
                          </button>
                        ))}
                      </div>
                      <Textarea rows={3} placeholder="Nhận xét (tuỳ chọn)…" value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} />
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" onClick={() => handleReviewSubmit(o.id)} disabled={reviewSubmitting}>
                          {reviewSubmitting ? "Đang gửi…" : "Gửi đánh giá"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReviewOrderId(null)}>Huỷ</Button>
                      </div>
                    </div>
                  )}

                  {(o.status === "delivered" || o.status === "completed") && (
                    <Disclosure
                      label="Xem dashboard" labelOpen="Ẩn dashboard"
                      open={dashboardOpen.has(o.id)}
                      onToggle={() => setDashboardOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                        return next;
                      })}
                    >
                      <ServiceDashboard orderId={o.id} />
                    </Disclosure>
                  )}
                  {(o.status === "delivered" || o.status === "completed") && <OrderResources orderId={o.id} />}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* ─── Chân trang: khoảng hiển thị + phân trang + cỡ trang ─── */}
        {!loading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
            <span className="text-[12px] text-faint tabular">
              Hiển thị {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} / {total} đơn
            </span>
            <div className="flex items-center gap-2">
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                aria-label="Số đơn mỗi trang"
                className="h-8 rounded-lg bg-surface border border-line px-2 text-[12px] text-muted cursor-pointer focus:outline-none focus:border-iris"
              >
                {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n} / trang</option>)}
              </select>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
