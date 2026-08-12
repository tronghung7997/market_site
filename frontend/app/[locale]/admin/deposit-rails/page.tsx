"use client";

/**
 * Admin: operational deposit rail config (PayOS / NOWPayments).
 * Secrets stay in env — this page only toggles flags and limits.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DepositRailConfigAdmin } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button, Card, Spinner } from "@/components/ui";

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0 border-b border-line/60 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-fg">{label}</div>
        <p className="mt-0.5 text-[12px] text-muted leading-snug">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 rounded-full border transition-[background-color,border-color] duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
        checked ? "bg-iris border-iris" : "bg-raised border-line",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm",
          "transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

function NumInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      className="h-8 w-28 rounded-md border border-line bg-surface px-2 text-right font-mono text-[13px] tabular-nums"
    />
  );
}

export default function AdminDepositRailsPage() {
  const [cfg, setCfg] = useState<DepositRailConfigAdmin | null>(null);
  const [draft, setDraft] = useState<Partial<DepositRailConfigAdmin>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const c = await api.adminDepositRailConfig();
      setCfg(c);
      setDraft({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không tải được cấu hình nạp");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const v = <K extends keyof DepositRailConfigAdmin>(key: K): DepositRailConfigAdmin[K] => {
    if (draft[key] !== undefined) return draft[key] as DepositRailConfigAdmin[K];
    return cfg![key];
  };

  const set = <K extends keyof DepositRailConfigAdmin>(key: K, value: DepositRailConfigAdmin[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const body: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(draft)) {
        if (val !== undefined) body[k] = val;
      }
      if (Object.keys(body).length === 0) {
        setMsg("Không có thay đổi.");
        setSaving(false);
        return;
      }
      const next = await api.updateDepositRailConfig(body);
      setCfg(next);
      setDraft({});
      setMsg("Đã lưu cấu hình nạp.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  const resetEnv = async () => {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const next = await api.resetDepositRailConfig();
      setCfg(next);
      setDraft({});
      setMsg("Đã reset theo ENV seed.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reset thất bại");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !cfg) {
    return (
      <div className="grid place-items-center py-20">
        {err ? <p className="text-bad text-[13px]">{err}</p> : <Spinner />}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-fg">Cấu hình nạp (rails)</h1>
          <p className="text-[13px] text-muted mt-0.5">
            Bật/tắt PayOS &amp; USDT, hạn mức, cửa sổ local. API key / IPN secret chỉ trong env.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void resetEnv()} disabled={saving}>
            Reset ENV
          </Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Đang lưu…" : "Lưu"}
          </Button>
        </div>
      </div>

      {msg && (
        <p className="text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {msg}
        </p>
      )}
      {err && (
        <p className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {err}
        </p>
      )}

      <Card className="p-5">
        <h2 className="text-[14px] font-semibold mb-1">Trạng thái hiệu lực</h2>
        <p className="text-[12px] text-muted mb-3">
          Effective = cờ admin bật <strong>và</strong> secrets đã cấu hình trên server.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 text-[13px]">
          <div className="rounded-lg border border-line px-3 py-2">
            <div className="text-muted text-[11px] uppercase">PayOS</div>
            <div className="font-medium mt-0.5">
              {cfg.effective_payos_enabled ? "Đang bật" : "Tắt / thiếu secret"}
            </div>
            <div className="text-[11px] text-faint mt-0.5">
              secrets: {cfg.payos_secrets_configured ? "ok" : "missing"}
            </div>
          </div>
          <div className="rounded-lg border border-line px-3 py-2">
            <div className="text-muted text-[11px] uppercase">NOWPayments USDT</div>
            <div className="font-medium mt-0.5">
              {cfg.effective_nowpayments_enabled ? "Đang bật" : "Tắt / thiếu secret"}
            </div>
            <div className="text-[11px] text-faint mt-0.5">
              secrets: {cfg.nowpayments_secrets_configured ? "ok" : "missing"}
            </div>
            <div className="text-[11px] text-faint mt-0.5">
              auto reconcile: {cfg.nowpayments_reconciliation_configured ? "ok" : "missing credentials"}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-0">
        <h2 className="text-[14px] font-semibold mb-2">Cờ bật/tắt</h2>
        <SettingRow label="PayOS (CKNH)" description="Tắt thì ẩn rail bank và chặn tạo lệnh PayOS.">
          <Switch
            checked={Boolean(v("payos_enabled"))}
            onChange={(x) => set("payos_enabled", x)}
            label="PayOS enabled"
            disabled={saving}
          />
        </SettingRow>
        <SettingRow label="NOWPayments (USDT)" description="Tắt thì ẩn rail USDT và chặn tạo lệnh crypto.">
          <Switch
            checked={Boolean(v("nowpayments_enabled"))}
            onChange={(x) => set("nowpayments_enabled", x)}
            label="NOW enabled"
            disabled={saving}
          />
        </SettingRow>
      </Card>

      <Card className="p-5 space-y-0">
        <h2 className="text-[14px] font-semibold mb-2">PayOS — hạn mức / cửa sổ</h2>
        <SettingRow label="Min VND" description="Số tiền nạp tối thiểu (đồng).">
          <NumInput value={Number(v("deposit_min_amount"))} onChange={(n) => set("deposit_min_amount", n)} disabled={saving} />
        </SettingRow>
        <SettingRow label="Max VND" description="Số tiền nạp tối đa mỗi lệnh.">
          <NumInput value={Number(v("deposit_max_amount"))} onChange={(n) => set("deposit_max_amount", n)} disabled={saving} />
        </SettingRow>
        <SettingRow label="Expire (phút)" description="Cửa sổ local pending trước khi chốt expired.">
          <NumInput value={Number(v("deposit_expire_minutes"))} onChange={(n) => set("deposit_expire_minutes", n)} disabled={saving} />
        </SettingRow>
        <SettingRow label="Reconcile retention (giờ)" description="Còn đối soát expired/cancelled trong cửa sổ này.">
          <NumInput
            value={Number(v("deposit_reconcile_retention_hours"))}
            onChange={(n) => set("deposit_reconcile_retention_hours", n)}
            disabled={saving}
          />
        </SettingRow>
      </Card>

      <Card className="p-5 space-y-0">
        <h2 className="text-[14px] font-semibold mb-2">USDT — hạn mức / đối soát</h2>
        <SettingRow label="Min VND (USDT)" description="Target VND tối thiểu khi nạp crypto.">
          <NumInput value={Number(v("deposit_usdt_min_vnd"))} onChange={(n) => set("deposit_usdt_min_vnd", n)} disabled={saving} />
        </SettingRow>
        <SettingRow label="Max VND (USDT)" description="Target VND tối đa mỗi lệnh crypto.">
          <NumInput value={Number(v("deposit_usdt_max_vnd"))} onChange={(n) => set("deposit_usdt_max_vnd", n)} disabled={saving} />
        </SettingRow>
        <SettingRow label="Local window (phút)" description="UI/local expiry — không phải TTL provider.">
          <NumInput
            value={Number(v("deposit_usdt_local_window_minutes"))}
            onChange={(n) => set("deposit_usdt_local_window_minutes", n)}
            disabled={saving}
          />
        </SettingRow>
        <SettingRow label="Reconcile retention (giờ)" description="Cửa sổ an toàn đối soát NOW (thường dài hơn UI window).">
          <NumInput
            value={Number(v("deposit_usdt_reconcile_retention_hours"))}
            onChange={(n) => set("deposit_usdt_reconcile_retention_hours", n)}
            disabled={saving}
          />
        </SettingRow>
        <SettingRow label="USDT allowlist" description="Chỉ credit các mã này từ webhook. Phải khớp Coin settings trên NOWPayments (vd usdtbsc,usdttrc20).">
          <input
            value={String(v("nowpayments_allowed_pay_currencies"))}
            disabled={saving}
            onChange={(e) => set("nowpayments_allowed_pay_currencies", e.target.value.toLowerCase())}
            className="h-8 w-48 rounded-md border border-line bg-surface px-2 font-mono text-[13px]"
          />
        </SettingRow>
      </Card>
    </div>
  );
}
