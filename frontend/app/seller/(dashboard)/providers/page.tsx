"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sellerTierLabel } from "@/lib/seller-tier";
import type { Provider } from "@/lib/types";
import { Button, Card, Field, Input, Spinner, Tag } from "@/components/ui";
import { ArrowRight, Check, Clock, Edit2, Info, Plug, Shield, X } from "@/components/Icons";

const MIN_TIER_FOR_PROVIDERS = "trusted";
const MIN_TIER_LABEL = sellerTierLabel(MIN_TIER_FOR_PROVIDERS);

const ADAPTER_OPTIONS: { value: string; label: string; description: string }[] = [
  {
    value: "seller_gateway",
    label: "Trả kết quả ngay",
    description: "Mỗi đơn gọi thẳng vào API của bạn và nhận kết quả trong cùng một lượt. Hợp với API chạy nhanh, tính giá theo credit.",
  },
  {
    value: "seller_task_webhook",
    label: "Xử lý nền rồi báo xong",
    description: "Backend nhận tác vụ, tự xử lý và báo kết quả sau. Hợp với job lâu, tính giá theo từng tác vụ.",
  },
];

const REVIEW_TAG: Record<string, { tone: "good" | "warn" | "bad" | "neutral"; label: string; icon: typeof Check }> = {
  approved: { tone: "good", label: "Đã duyệt", icon: Check },
  pending_review: { tone: "warn", label: "Chờ admin duyệt", icon: Clock },
  rejected: { tone: "bad", label: "Bị từ chối", icon: X },
  disabled: { tone: "neutral", label: "Đã tắt", icon: X },
};

type EndpointEntry = { name: string; path: string };

function emptyForm() {
  return { name: "", adapter_type: "seller_gateway", base_url: "", api_key: "", webhook_secret: "", endpoint_map: [] as EndpointEntry[] };
}

function endpointEntries(map: unknown): EndpointEntry[] {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  return Object.entries(map as Record<string, unknown>).flatMap(([name, path]) =>
    typeof path === "string" ? [{ name, path }] : [],
  );
}

function buildEndpointMap(entries: EndpointEntry[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const name = entry.name.trim();
    const path = entry.path.trim();
    if (!name && !path) continue;
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
      throw new Error("Tên endpoint chỉ dùng chữ, số và dấu gạch dưới.");
    }
    if (!path.startsWith("/")) {
      throw new Error(`Path của endpoint \"${name}\" phải bắt đầu bằng /.`);
    }
    if (result[name]) throw new Error(`Endpoint \"${name}\" đang bị khai báo hai lần.`);
    result[name] = path;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildConfig(form: ReturnType<typeof emptyForm>): Record<string, unknown> {
  const config: Record<string, unknown> = { base_url: form.base_url, api_key: form.api_key };
  if (form.adapter_type === "seller_task_webhook") config.webhook_secret = form.webhook_secret;
  const endpointMap = buildEndpointMap(form.endpoint_map);
  if (endpointMap) config.endpoint_map = endpointMap;
  return config;
}

function reviewMessage(note: string) {
  const jsonStart = note.indexOf("{");
  if (jsonStart < 0) return note;

  try {
    const details = JSON.parse(note.slice(jsonStart)) as { health?: { status?: string; message?: string }; provision_test?: { error?: string } | null };
    const reason = details.health?.message ?? details.provision_test?.error;
    if (reason) return `Kết nối chưa đạt: ${reason}. Kiểm tra lại địa chỉ API, quyền truy cập và endpoint rồi lưu cấu hình để gửi duyệt lại.`;
  } catch {
    // Giữ lại ghi chú do admin viết tay nếu nó không phải JSON hợp lệ.
  }
  return "Admin cần bạn cập nhật cấu hình và chạy lại kiểm tra kết nối trước khi gửi duyệt lại.";
}

function EndpointMapEditor({ entries, onChange }: { entries: EndpointEntry[]; onChange: (entries: EndpointEntry[]) => void }) {
  const update = (index: number, key: keyof EndpointEntry, value: string) => {
    onChange(entries.map((entry, i) => i === index ? { ...entry, [key]: value } : entry));
  };

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">Chỉ dùng khi path thật của backend khác chuẩn. Bỏ trống toàn bộ nếu backend dùng <code>/v1/&lt;tên_endpoint&gt;</code>.</p>
      {entries.map((entry, index) => (
        <div key={`${index}-${entry.name}`} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
          <Input value={entry.name} onChange={(e) => update(index, "name", e.target.value)} placeholder="search" aria-label="Tên endpoint" />
          <Input value={entry.path} onChange={(e) => update(index, "path", e.target.value)} placeholder="/v2/search" aria-label="Path upstream" />
          <Button size="sm" variant="ghost" onClick={() => onChange(entries.filter((_, i) => i !== index))}>Xoá</Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...entries, { name: "", path: "" }])}>+ Thêm endpoint</Button>
    </div>
  );
}

function TestSummary({ result }: { result: { health: Record<string, unknown>; provision_test: Record<string, unknown> | null; provision_test_skipped_reason?: string | null } }) {
  const health = result.health ?? {};
  const healthy = health.status === "healthy";
  const probeSkipped = health.probe === "skipped";
  const provisionSucceeded = result.provision_test?.success === true;
  return (
    <div className="space-y-2 text-[12.5px]">
      <p className={healthy ? "text-good" : "text-bad"}>{healthy ? "✓ Cấu hình hợp lệ" : "× Không kết nối được"}</p>
      {probeSkipped ? <p className="text-warn">Chưa xác minh kết nối upstream: {String(health.message)}</p> : health.message ? <p className="text-muted">{String(health.message)}</p> : null}
      {result.provision_test ? <p className={provisionSucceeded ? "text-good" : "text-bad"}>{provisionSucceeded ? "✓ Đã thử cấp phát thành công" : `× Cấp phát thử thất bại: ${String(result.provision_test.error ?? "Không rõ lỗi")}`}</p> : null}
      {result.provision_test_skipped_reason && <p className="text-muted">Cấp phát thử chưa chạy: {result.provision_test_skipped_reason}</p>}
    </div>
  );
}

function ProviderCard({ provider, onChanged }: { provider: Provider; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    name: provider.name,
    adapter_type: provider.adapter_type,
    base_url: (provider.config.base_url as string) ?? "",
    api_key: "",
    webhook_secret: "",
    endpoint_map: endpointEntries(provider.config.endpoint_map),
  }));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    health: Record<string, unknown>;
    provision_test: Record<string, unknown> | null;
    provision_test_skipped_reason?: string | null;
  } | null>(null);
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
      const endpointMap = buildEndpointMap(form.endpoint_map);
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
          <strong>Cần sửa trước khi gửi lại: </strong>{reviewMessage(provider.review_note)}
        </p>
      )}
      {provider.review_status === "pending_review" && (
        <p className="text-[12.5px] text-muted">
          Đang chờ admin duyệt — bạn có thể tự bấm &quot;Test kết nối&quot; trước để chắc chắn cấu hình đúng.
        </p>
      )}
      {provider.review_status === "approved" && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-good-soft border border-good/25 px-3 py-2">
          <p className="text-[12.5px] text-good">Sẵn sàng gắn vào sản phẩm và thiết lập gói giá.</p>
          <Link href="/seller/products" className="text-[12.5px] font-medium text-iris-hi underline">Đi tới sản phẩm</Link>
        </div>
      )}

      {testResult && <div className="bg-raised border border-line rounded-lg p-3"><TestSummary result={testResult} /></div>}

      {editing && (
        <div className="space-y-3 border-t border-line pt-4">
          <Field label="Địa chỉ API (Base URL)">
            <Input autoComplete="url" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.your-backend.com" />
          </Field>
          <Field label="API key để marketplace xác thực" hint="Để trống nếu không muốn đổi key hiện tại">
            <Input type="password" autoComplete="new-password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="••••••••" />
          </Field>
          {provider.adapter_type === "seller_task_webhook" && (
            <Field label="Secret để xác thực kết quả trả về" hint="Để trống nếu không muốn đổi secret hiện tại">
              <Input type="password" autoComplete="new-password" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} placeholder="••••••••" />
            </Field>
          )}
          <Field label="Endpoint khác chuẩn (tuỳ chọn)">
            <EndpointMapEditor entries={form.endpoint_map} onChange={(endpoint_map) => setForm({ ...form, endpoint_map })} />
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
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="p-5 sm:p-6 space-y-6">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-iris-hi">Kết nối mới</p>
            <h3 className="mt-1 text-[19px] font-semibold tracking-tight">Kết nối backend của bạn</h3>
            <p className="mt-1.5 text-[13px] leading-5 text-muted max-w-xl">
              Chỉ cần địa chỉ API và key để marketplace gọi được backend. Thông tin này không hiển thị cho buyer.
            </p>
          </div>

          <section className="space-y-3" aria-labelledby="connection-name">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-faint">Bước 1</p>
              <h4 id="connection-name" className="text-[14px] font-semibold">Đặt tên để bạn quản lý</h4>
            </div>
            <Field label="Tên kết nối" hint="Chỉ seller và admin thấy tên này">
              <Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ví dụ: API scrape TikTok — production" />
            </Field>
          </section>

          <section className="space-y-3 border-t border-line pt-5" aria-labelledby="connection-mode">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-faint">Bước 2</p>
              <h4 id="connection-mode" className="text-[14px] font-semibold">Chọn cách backend hoàn thành đơn</h4>
              <p className="mt-0.5 text-[12px] text-muted">Chọn theo thời gian xử lý thực tế, không theo tên công nghệ.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Cách backend hoàn thành đơn">
              {ADAPTER_OPTIONS.map((option) => {
                const selected = form.adapter_type === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setForm({ ...form, adapter_type: option.value })}
                    className={`min-w-0 rounded-xl border p-4 text-left transition-colors ${selected ? "border-iris bg-iris-soft shadow-sm" : "border-line bg-surface hover:border-line-2 hover:bg-raised"}`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-iris bg-iris text-white" : "border-line-2 bg-surface"}`}>
                      {selected && <Check size={12} />}
                    </span>
                    <span className="mt-3 block text-[13px] font-semibold">{option.label}</span>
                    <span className="mt-1 block text-[12px] leading-5 text-muted">{option.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 border-t border-line pt-5" aria-labelledby="connection-access">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-faint">Bước 3</p>
              <h4 id="connection-access" className="text-[14px] font-semibold">Cho phép marketplace gọi vào backend</h4>
              <p className="mt-0.5 text-[12px] text-muted">Dùng môi trường production có thể truy cập từ internet; không dùng localhost.</p>
            </div>
            <Field label="Địa chỉ API (Base URL)" hint="Ví dụ: https://api.congty-ban.com">
              <Input autoComplete="url" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.congty-ban.com" />
            </Field>
            <Field label="API key để marketplace xác thực" hint="Key do backend của bạn cấp. Key được mã hoá khi lưu.">
              <Input type="password" autoComplete="new-password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="Dán API key của backend vào đây" />
            </Field>
            {form.adapter_type === "seller_task_webhook" && (
              <Field label="Secret để xác thực kết quả trả về" hint="Backend dùng secret này khi gọi webhook báo đơn hoàn thành.">
                <Input type="password" autoComplete="new-password" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} placeholder="Tự tạo một chuỗi bí mật riêng" />
              </Field>
            )}
            {form.adapter_type === "seller_gateway" && (
              <details className="rounded-lg border border-line bg-raised px-3 py-2.5">
                <summary className="cursor-pointer text-[12.5px] font-medium">Đường dẫn API khác chuẩn? Khai báo thêm endpoint</summary>
                <div className="pt-3">
                  <EndpointMapEditor entries={form.endpoint_map} onChange={(endpoint_map) => setForm({ ...form, endpoint_map })} />
                </div>
              </details>
            )}
          </section>

          {error && <p role="alert" className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2.5 text-[12.5px] text-bad">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <p className="text-[12px] leading-5 text-muted max-w-md">Gửi xong, bạn có thể chạy kiểm tra kết nối. Admin chỉ duyệt sau khi có cấu hình và kết quả kiểm tra rõ ràng.</p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel}>Huỷ</Button>
              <Button size="sm" onClick={handleSubmit} disabled={saving || !form.name || !form.base_url}>
                {saving ? "Đang gửi…" : "Gửi để kiểm tra"}<ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </div>

        <aside className="border-t border-line bg-raised p-5 sm:p-6 lg:border-t-0 lg:border-l" aria-label="Lộ trình kết nối">
          <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-faint">Lộ trình</p>
          <h4 className="mt-1 text-[14px] font-semibold">Bạn sẽ làm gì?</h4>
          <ol className="mt-5 space-y-5">
            <li className="relative flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-iris text-[11px] font-semibold text-white">1</span>
              <div><p className="text-[12.5px] font-medium">Gửi thông tin kết nối</p><p className="mt-0.5 text-[12px] leading-5 text-muted">URL, key và cách hoàn thành đơn.</p></div>
            </li>
            <li className="relative flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface text-[11px] font-semibold">2</span>
              <div><p className="text-[12.5px] font-medium">Tự kiểm tra kết nối</p><p className="mt-0.5 text-[12px] leading-5 text-muted">Bấm test ngay trên card vừa tạo và sửa nếu có lỗi.</p></div>
            </li>
            <li className="relative flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface text-[11px] font-semibold">3</span>
              <div><p className="text-[12.5px] font-medium">Admin xem xét</p><p className="mt-0.5 text-[12px] leading-5 text-muted">Khi được duyệt, gắn backend vào sản phẩm của bạn.</p></div>
            </li>
          </ol>
          <div className="mt-6 rounded-lg border border-iris/20 bg-iris-soft px-3 py-3">
            <div className="flex gap-2"><Info size={14} className="mt-0.5 shrink-0 text-iris-hi" /><p className="text-[12px] leading-5 text-muted">Buyer chỉ dùng key do marketplace cấp. Họ không nhìn thấy URL hay key thật của backend.</p></div>
          </div>
        </aside>
      </div>
    </Card>
  );
}

export default function SellerProvidersPage() {
  const { account } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

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
          <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-faint">Hạ tầng bán hàng</p>
          <h2 className="mt-1 text-[20px] font-semibold tracking-tight">Backend của tôi</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted max-w-2xl">Kết nối API của bạn một lần, rồi dùng nó cho các sản phẩm phù hợp sau khi admin duyệt.</p>
        </div>
        {!creating && <Button onClick={() => { setJustSubmitted(false); setCreating(true); }}>Kết nối backend <ArrowRight size={14} /></Button>}
      </div>

      {!creating && providers.length === 0 && (
        <Card className="border-iris/20 bg-iris-soft p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-[13px] font-semibold">Chuẩn bị trước khi bắt đầu</p><p className="mt-1 text-[12.5px] leading-5 text-muted">Địa chỉ API production, API key để gọi vào backend, và webhook secret nếu job của bạn xử lý nền.</p></div>
            <Button size="sm" onClick={() => setCreating(true)}>Bắt đầu kết nối</Button>
          </div>
        </Card>
      )}

      {creating && (
        <CreateProviderForm
          onCreated={() => { setCreating(false); setJustSubmitted(true); load(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {justSubmitted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-good/25 bg-good-soft px-4 py-3">
          <div><p className="text-[13px] font-semibold text-good">Đã gửi thông tin kết nối</p><p className="mt-0.5 text-[12.5px] text-muted">Bước tiếp theo: bấm “Test kết nối” trên backend vừa tạo. Kết quả sẽ giúp admin duyệt nhanh hơn.</p></div>
          <Tag tone="warn"><Clock size={11} />Cần kiểm tra</Tag>
        </div>
      )}

      {providers.length === 0 && !creating ? (
        <Card className="p-8 text-center">
          <Plug size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] font-medium">Chưa có backend nào được kết nối</p>
          <p className="mt-1 text-[12.5px] text-muted">Kết nối backend đầu tiên để bắt đầu bán dịch vụ qua marketplace.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => <ProviderCard key={p.id} provider={p} onChanged={load} />)}
        </div>
      )}

      {providers.some((p) => p.review_status === "approved") && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3 border-good/25 bg-good-soft">
          <div>
            <p className="text-[13px] font-medium">Backend đã được duyệt</p>
            <p className="text-[12px] text-muted">Bước tiếp theo: gắn backend vào sản phẩm ở tab Vận hành, rồi lưu chiến lược giá tương thích.</p>
          </div>
          <Link href="/seller/products"><Button size="sm">Đi tới sản phẩm</Button></Link>
        </Card>
      )}
    </div>
  );
}
