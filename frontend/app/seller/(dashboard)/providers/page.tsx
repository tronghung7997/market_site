"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sellerTierLabel } from "@/lib/seller-tier";
import type { Provider } from "@/lib/types";
import { Button, Card, Field, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { Check, Clock, Edit2, Plug, Shield, X } from "@/components/Icons";

const MIN_TIER_FOR_PROVIDERS = "trusted";
const MIN_TIER_LABEL = sellerTierLabel(MIN_TIER_FOR_PROVIDERS);

const ADAPTER_OPTIONS: { value: string; label: string; description: string }[] = [
  {
    value: "seller_gateway",
    label: "Gateway (credit — trừ theo từng lần gọi)",
    description: "Buyer gọi qua platform, platform forward tới API của bạn theo từng request — dùng cho sản phẩm chiến lược giá \"Gói credit\".",
  },
  {
    value: "seller_task_webhook",
    label: "Webhook tác vụ (task — bạn tự xử lý rồi báo lại)",
    description: "Platform gửi tác vụ cho backend của bạn, bạn tự xử lý rồi gọi lại webhook báo kết quả — dùng cho sản phẩm chiến lược giá \"Theo tác vụ\".",
  },
];

const REVIEW_TAG: Record<string, { tone: "good" | "warn" | "bad" | "neutral"; label: string; icon: typeof Check }> = {
  approved: { tone: "good", label: "Đã duyệt", icon: Check },
  pending_review: { tone: "warn", label: "Chờ admin duyệt", icon: Clock },
  rejected: { tone: "bad", label: "Bị từ chối", icon: X },
  disabled: { tone: "neutral", label: "Đã tắt", icon: X },
};

function emptyForm() {
  return { name: "", adapter_type: "seller_gateway", base_url: "", api_key: "", webhook_secret: "", endpoint_map: "" };
}

function parseEndpointMap(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("endpoint_map phải là object dạng { \"tên_endpoint\": \"/path/thật\" }");
  }
  return parsed as Record<string, string>;
}

function buildConfig(form: ReturnType<typeof emptyForm>): Record<string, unknown> {
  const config: Record<string, unknown> = { base_url: form.base_url, api_key: form.api_key };
  if (form.adapter_type === "seller_task_webhook") config.webhook_secret = form.webhook_secret;
  const endpointMap = parseEndpointMap(form.endpoint_map);
  if (endpointMap) config.endpoint_map = endpointMap;
  return config;
}

function ProviderCard({ provider, onChanged }: { provider: Provider; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    name: provider.name,
    adapter_type: provider.adapter_type,
    base_url: (provider.config.base_url as string) ?? "",
    api_key: "",
    webhook_secret: "",
    endpoint_map: provider.config.endpoint_map ? JSON.stringify(provider.config.endpoint_map, null, 2) : "",
  }));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ health: Record<string, unknown>; provision_test: Record<string, unknown> | null } | null>(null);
  const [error, setError] = useState("");

  const reviewInfo = REVIEW_TAG[provider.review_status] ?? REVIEW_TAG.pending_review;
  const ReviewIcon = reviewInfo.icon;

  const handleTest = async () => {
    setTesting(true);
    setError("");
    try {
      setTestResult(await api.testSellerProvider(provider.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test thất bại");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const config: Record<string, unknown> = { base_url: form.base_url };
      if (form.api_key) config.api_key = form.api_key; // để trống = giữ nguyên key cũ
      if (provider.adapter_type === "seller_task_webhook" && form.webhook_secret) {
        config.webhook_secret = form.webhook_secret;
      }
      const endpointMap = parseEndpointMap(form.endpoint_map);
      if (endpointMap) config.endpoint_map = endpointMap;
      await api.updateSellerProvider(provider.id, { config });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14.5px] font-semibold">{provider.name}</h3>
            <Tag tone={reviewInfo.tone}><ReviewIcon size={11} />{reviewInfo.label}</Tag>
          </div>
          <p className="text-[12.5px] text-muted mt-0.5">
            {ADAPTER_OPTIONS.find((o) => o.value === provider.adapter_type)?.label ?? provider.adapter_type}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={handleTest} disabled={testing}>
            {testing ? "Đang test…" : "Test kết nối"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            <Edit2 size={13} />{editing ? "Đóng" : "Sửa"}
          </Button>
        </div>
      </div>

      {provider.review_status === "rejected" && provider.review_note && (
        <p className="text-[12.5px] text-bad bg-bad-soft border border-bad/25 rounded-lg px-3 py-2">
          Lý do từ chối: {provider.review_note}
        </p>
      )}
      {provider.review_status === "pending_review" && (
        <p className="text-[12.5px] text-muted">
          Đang chờ admin duyệt — bạn có thể tự bấm &quot;Test kết nối&quot; trước để chắc chắn cấu hình đúng.
        </p>
      )}

      {testResult && (
        <pre className="text-[11px] font-mono bg-raised border border-line rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(testResult, null, 2)}
        </pre>
      )}

      {editing && (
        <div className="space-y-3 border-t border-line pt-4">
          <Field label="Base URL">
            <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.your-backend.com" />
          </Field>
          <Field label="API Key" hint="Để trống nếu không muốn đổi key hiện tại">
            <Input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="••••••••" />
          </Field>
          {provider.adapter_type === "seller_task_webhook" && (
            <Field label="Webhook secret" hint="Để trống nếu không muốn đổi secret hiện tại">
              <Input type="password" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} placeholder="••••••••" />
            </Field>
          )}
          <Field label="Endpoint map (tuỳ chọn)" hint='JSON: {"search": "/v2/search"} — bỏ trống thì platform mặc định gọi /v1/{endpoint}'>
            <Textarea rows={3} value={form.endpoint_map} onChange={(e) => setForm({ ...form, endpoint_map: e.target.value })} className="font-mono text-[12px]" />
          </Field>
          {error && <p className="text-[12.5px] text-bad">{error}</p>}
          <div className="flex items-center gap-2 bg-warn-soft border border-warn/25 rounded-lg px-3 py-2">
            <Shield size={14} className="text-warn shrink-0" />
            <p className="text-[12px] text-warn">Sửa cấu hình sẽ đưa provider về trạng thái &quot;Chờ admin duyệt&quot; lại từ đầu.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Huỷ</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</Button>
          </div>
        </div>
      )}
      {!editing && error && <p className="text-[12.5px] text-bad">{error}</p>}
    </Card>
  );
}

function CreateProviderForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setSaving(true);
    setError("");
    try {
      const config = buildConfig(form);
      await api.createSellerProvider({ name: form.name, adapter_type: form.adapter_type, config });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đăng ký thất bại");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-[14.5px] font-semibold">Đăng ký backend mới</h3>

      <Field label="Tên (chỉ để bạn nhận diện, buyer không thấy)">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Backend scrape TikTok của tôi" />
      </Field>

      <Field label="Loại kết nối">
        <Select value={form.adapter_type} onChange={(e) => setForm({ ...form, adapter_type: e.target.value })}>
          {ADAPTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
      <p className="text-[12px] text-muted -mt-2">
        {ADAPTER_OPTIONS.find((o) => o.value === form.adapter_type)?.description}
      </p>

      <Field label="Base URL">
        <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.your-backend.com" />
      </Field>
      <Field label="API Key">
        <Input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="Key backend của bạn cấp cho platform gọi" />
      </Field>
      {form.adapter_type === "seller_task_webhook" && (
        <Field label="Webhook secret" hint="Dùng để ký/xác thực khi backend của bạn gọi ngược webhook báo kết quả tác vụ">
          <Input type="password" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} placeholder="Chuỗi bí mật tự đặt" />
        </Field>
      )}
      {form.adapter_type === "seller_gateway" && (
        <Field label="Endpoint map (tuỳ chọn)" hint='JSON: {"search": "/v2/search", "scrape": "/scrape-v3/run"} — bỏ trống thì platform mặc định gọi /v1/{endpoint}'>
          <Textarea rows={3} value={form.endpoint_map} onChange={(e) => setForm({ ...form, endpoint_map: e.target.value })} className="font-mono text-[12px]" placeholder='{"search": "/v2/search"}' />
        </Field>
      )}

      {error && <p className="text-[12.5px] text-bad">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Huỷ</Button>
        <Button size="sm" onClick={handleSubmit} disabled={saving || !form.name || !form.base_url}>
          {saving ? "Đang đăng ký…" : "Đăng ký, gửi admin duyệt"}
        </Button>
      </div>
    </Card>
  );
}

export default function SellerProvidersPage() {
  const { account } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const eligible = account?.seller_tier === "trusted" || account?.seller_tier === "enterprise";

  const load = async () => {
    setLoading(true);
    try {
      setProviders(await api.sellerProviders());
    } catch {
      // chưa đủ tier — để danh sách trống, gate UI bên dưới xử lý
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <div className="py-16"><Spinner /></div>;

  if (!eligible) {
    return (
      <Card className="p-8 text-center">
        <Shield size={40} className="mx-auto text-faint mb-3" />
        <h2 className="text-[16px] font-semibold mb-1.5">Cần nâng cấp lên {MIN_TIER_LABEL}</h2>
        <p className="text-[13px] text-muted max-w-md mx-auto">
          Tự đăng ký backend riêng dành cho seller cấp {MIN_TIER_LABEL} trở lên.
          Cấp hiện tại của bạn: <strong>{sellerTierLabel(account?.seller_tier)}</strong>.
          Liên hệ admin để được xét duyệt nâng cấp.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">Backend của tôi</h2>
          <p className="text-[13px] text-muted max-w-2xl">
            Tự đấu nối API thật của bạn để platform đứng giữa gọi thay mặt buyer — buyer chỉ nhận
            một key nền tảng tự cấp, không bao giờ thấy base_url/api_key thật của bạn. Đăng ký xong
            cần admin duyệt trước khi gắn được vào sản phẩm ở tab &quot;Vận hành&quot;.
          </p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>Đăng ký backend mới</Button>}
      </div>

      {creating && (
        <CreateProviderForm
          onCreated={() => { setCreating(false); load(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {providers.length === 0 && !creating ? (
        <Card className="p-8 text-center">
          <Plug size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] text-muted">Bạn chưa đăng ký backend nào</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => <ProviderCard key={p.id} provider={p} onChanged={load} />)}
        </div>
      )}
    </div>
  );
}
