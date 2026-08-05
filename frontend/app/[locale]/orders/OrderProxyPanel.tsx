"use client";

/** Panel proxy gắn trên đơn đã giao: tấm địa chỉ cố định (key xoay), IP đang
 *  ra, đổi IP có cooldown, whitelist IP, và biên nhận bàn giao gốc thu gọn.
 *  Tự hỏi backend đơn này có proxy-state không — đơn thường thì render null.
 *  Interface: { orderId, deliveredData?, onDelivered?, onPlate? }. */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { timeLeftLabel } from "@/lib/time";
import type { ProxyState } from "@/lib/types";
import { Button, CopyButton, Disclosure, Input } from "@/components/ui";
import { Check, Info, Plug } from "@/components/Icons";

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

export default function OrderProxyPanel({ orderId, deliveredData, onDelivered, onPlate }: {
  orderId: number;
  deliveredData?: string | null;
  onDelivered?: (orderId: number, deliveredData: string) => void;
  onPlate?: (orderId: number) => void;
}) {
  const t = useTranslations("orders");
  const locale = useLocale();
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
      setError(e instanceof Error ? e.message : t("proxyRotateFail"));
    } finally {
      setRotating(false);
    }
  };

  const hasPlate = Boolean(state?.gateway_host && state?.gateway_port);
  useEffect(() => { if (hasPlate) onPlate?.(orderId); }, [hasPlate, orderId, onPlate]);

  if (!applicable || !state) return null;

  const left = timeLeftLabel(state.expires_at, locale);
  const expiresLabel = new Date(state.expires_at).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
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
              <Plug size={12} /> {t("proxyPlate")}
            </span>
            <CopyButton text={`${state.gateway_host}:${state.gateway_port}`} />
          </div>
          <p className="font-mono text-[17px] leading-snug mt-1.5 break-all">
            {state.gateway_host}
            <span className="text-faint">:</span>
            <span className="text-iris-hi font-semibold">{state.gateway_port}</span>
          </p>
          <p className="text-[11.5px] text-muted mt-1">
            {t("proxyPlateHint")}
          </p>
        </div>
      )}

      <div className={cn("px-3.5 py-2.5 flex items-start justify-between gap-2 flex-wrap", hasPlate && "border-t border-line")}>
        <div className="min-w-0">
          {state.public_ip ? (
            <p className="flex items-baseline gap-2">
              <span className="text-[10.5px] text-faint uppercase tracking-wider">{t("proxyCurrentIp")}</span>
              <span className="font-mono text-[13px]">{state.public_ip}</span>
            </p>
          ) : (
            <p className="text-[10.5px] text-faint uppercase tracking-wider">{t("proxyStatus")}</p>
          )}
          <p className="text-[11px] text-faint mt-0.5">
            {left ? t("proxyLeft", { left, date: expiresLabel }) : t("proxyExpired", { date: expiresLabel })}
            {hasPlate && t("proxyIpTtl")}
          </p>
          {state.status === "offline" && (
            <p className="text-[11px] text-warn mt-0.5 max-w-[260px]">
              {t("proxyOffline")}
            </p>
          )}
          {error && <p className="text-[12px] text-bad mt-1">{error}</p>}
        </div>
        {state.rotation_available && (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="secondary" onClick={handleRotate} disabled={rotating || cooldown > 0}>
              {rotating ? t("proxyRotating") : cooldown > 0 ? t("proxyRotateCooldown", { s: cooldown }) : t("proxyRotate")}
            </Button>
            {!hasPlate && (
              <span title={t("proxyRotateExplain")} className="text-faint cursor-help shrink-0">
                <Info size={13} />
              </span>
            )}
          </div>
        )}
      </div>

      {state.whitelist_supported && (
        <ProxyWhitelistBox orderId={orderId} state={state} onSaved={(s) => setState(s)} onDelivered={onDelivered} />
      )}

      {hasPlate && deliveredData && (
        <div className="px-3.5 pb-3">
          <Disclosure label={t("proxyRaw")} labelOpen={t("proxyRawHide")} open={showRaw} onToggle={() => setShowRaw((v) => !v)}>
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
  const t = useTranslations("orders");
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
        ? { text: t("proxyWlActive"), tone: "good" }
        : { text: t("proxyWlSaved"), tone: "warn" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : t("proxyWlFail"), tone: "bad" });
    } finally {
      setSaving(false);
    }
  };

  const activated = Boolean(saved);

  return (
    <div className={cn("px-3.5 py-2.5 border-t border-line", !activated && "bg-warn-soft/60")}>
      {activated ? (
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-good mb-1.5">
          <Check size={12} /> {t("proxyWlOpen")} <span className="font-mono">{saved}</span>
        </p>
      ) : (
        <>
          <p className="text-[10.5px] uppercase tracking-wider font-semibold text-warn mb-1">{t("proxyWlPending")}</p>
          <p className="text-[12px] text-warn mb-1.5 leading-relaxed">
            {t("proxyWlHint")}
          </p>
        </>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("proxyWlPh")}
          disabled={saving}
          className="flex-1 font-mono text-[12.5px]"
        />
        <Button size="sm" variant={activated ? "secondary" : "primary"} onClick={handleSave} disabled={saving || value.trim() === saved.trim()}>
          {saving ? t("submitting") : activated ? t("proxyWlUpdate") : t("proxyWlSave")}
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
