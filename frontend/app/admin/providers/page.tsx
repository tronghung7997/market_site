"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { Banner, Card, Spinner, Tag, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Info } from "@/components/Icons";
import type { AdminProduct, Provider, ProviderHealth } from "@/lib/types";
import { isAdapterCompatible, type CompatMatrix } from "@/lib/compat";

/* ================================================================
   Constants & helpers
   ================================================================ */

const ADAPTER_COLORS: Record<string, string> = {
  mock: "bg-good-soft text-good border-good/25",
  seller_pool: "bg-[hsl(175,40%,92%)] text-[hsl(175,50%,30%)] border-[hsl(175,40%,60%)]/25",
  manual: "bg-warn-soft text-warn border-warn/25",
  topproxy: "bg-iris-soft text-iris-hi border-iris/25",
  scrapecreators: "bg-iris-soft text-iris-hi border-iris/25",
  dproxy: "bg-iris-soft text-iris-hi border-iris/25",
};

const ADAPTER_DESCRIPTIONS: Record<string, { label: string; desc: string; icon: string }> = {
  mock: { label: "Mock", desc: "Dữ liệu giả cho dev/demo, không cần API bên ngoài", icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  seller_pool: { label: "Seller Pool", desc: "Lấy từ kho hàng seller đã upload sẵn", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  manual: { label: "Thủ công", desc: "Team nội bộ xử lý thủ công (takedown, custom)", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
  topproxy: { label: "TopProxy", desc: "Kết nối API nhà cung cấp proxy thật", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  scrapecreators: { label: "ScrapCreators", desc: "Kết nối API nhà cung cấp scraping thật", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  seller_gateway: { label: "Gateway seller", desc: "Forward từng request qua API thật của seller, buyer không thấy credential", icon: "M8 9l3 3-3 3m5 0h3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" },
  seller_task_webhook: { label: "Webhook tác vụ seller", desc: "Gửi tác vụ cho backend seller, nhận kết quả qua webhook", icon: "M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" },
  dproxy: { label: "DProxy", desc: "Proxy xoay IP — mỗi đơn được cấp một proxy độc quyền, buyer tự đổi IP", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
};

const ADAPTER_OPTIONS = ["mock", "seller_pool", "manual", "topproxy", "scrapecreators", "seller_gateway", "seller_task_webhook", "dproxy"];

const HEALTH_MAP: Record<string, { color: string; label: string }> = {
  healthy: { color: "var(--color-good)", label: "Lành mạnh" },
  degraded: { color: "var(--color-warn)", label: "Suy giảm" },
  down: { color: "var(--color-bad)", label: "Lỗi" },
};

interface ExpandedProvider extends Provider {
  health?: ProviderHealth[] | null;
  loadingHealth?: boolean;
}

/* ================================================================
   Provider Products Tab
   ================================================================ */

interface ProviderProduct {
  id: number;
  title: string;
  service_type: string;
  status: string;
  pricing_strategy: string | null;
  pricing_params: Record<string, unknown> | null;
  order_count: number;
  revenue: number;
  compat_level: "ok" | "warn" | "block";
  compat_message: string | null;
}

const STRATEGY_LABELS: Record<string, string> = {
  fixed: "Cố định",
  config: "Cấu hình",
  credit: "Credit",
  task: "Tác vụ",
};

const STRATEGY_OPTIONS = ["fixed", "config", "credit", "task"];

const SAMPLE_CONFIGS: Record<string, string> = {
  fixed: '{"variant_id": "basic", "quantity": 1}',
  config: '{"type": "datacenter", "network": "viettel", "days": 30, "quantity": 1}',
  credit: '{"package_size": 1000}',
  task: '{"platform": "facebook", "target_urls": "https://fb.com/post/1\\nhttps://fb.com/post/2"}',
};

function PricingEditor({
  product,
  adapterType,
  compatMatrix,
  onSaved,
  onClose,
}: {
  product: ProviderProduct;
  adapterType: string;
  compatMatrix: CompatMatrix | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [strategy, setStrategy] = useState(product.pricing_strategy ?? "fixed");
  const strategyIncompatible = !isAdapterCompatible(adapterType, strategy, compatMatrix);
  const [paramsText, setParamsText] = useState(
    JSON.stringify(product.pricing_params ?? {}, null, 2),
  );
  const [sampleText, setSampleText] = useState(SAMPLE_CONFIGS[product.pricing_strategy ?? "fixed"]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parseParams = (): Record<string, unknown> | null => {
    try {
      return JSON.parse(paramsText);
    } catch {
      setError("pricing_params không phải JSON hợp lệ");
      return null;
    }
  };

  const handleTest = async () => {
    setError(null);
    setTestResult(null);
    const params = parseParams();
    if (!params) return;
    let sample: Record<string, unknown>;
    try {
      sample = JSON.parse(sampleText);
    } catch {
      setError("Config mẫu không phải JSON hợp lệ");
      return;
    }
    try {
      // Lưu tạm strategy+params rồi tính thử — endpoint calculate đọc từ product
      await api.updateProductOperations(product.id, {
        pricing_strategy: strategy,
        pricing_params: params,
      });
      const r = await api.calculatePrice(product.id, sample);
      setTestResult(
        `${r.amount.toLocaleString("vi-VN")}đ` +
        (r.discount_pct ? ` (gốc ${r.original_amount?.toLocaleString("vi-VN")}đ, -${Math.round(r.discount_pct * 100)}%)` : ""),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Tính thử thất bại");
    }
  };

  const handleSave = async () => {
    setError(null);
    const params = parseParams();
    if (!params) return;
    setSaving(true);
    try {
      await api.updateProductOperations(product.id, {
        pricing_strategy: strategy,
        pricing_params: params,
      });
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Lỗi khi lưu");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-iris/30 bg-iris-soft/20 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold">Chiến lược giá — {product.title}</span>
        <button onClick={onClose} className="text-muted hover:text-fg px-1 cursor-pointer">&times;</button>
      </div>

      <Field label="Strategy">
        <Select
          value={strategy}
          onChange={(e) => {
            setStrategy(e.target.value);
            setSampleText(SAMPLE_CONFIGS[e.target.value] ?? "{}");
          }}
        >
          {STRATEGY_OPTIONS.map((s) => (
            <option key={s} value={s}>{STRATEGY_LABELS[s] ?? s}</option>
          ))}
        </Select>
      </Field>

      {strategyIncompatible && (
        <Banner tone="bad" icon={<Info size={14} />}>
          Provider hiện tại (adapter &quot;{adapterType}&quot;) không tương thích với chiến lược &quot;{strategy}&quot;
          — lưu sẽ bị từ chối. Đổi provider hoặc chọn chiến lược khác.
        </Banner>
      )}

      <Field label="pricing_params (JSON)">
        <Textarea
          rows={6}
          value={paramsText}
          onChange={(e) => setParamsText(e.target.value)}
          className="font-mono text-[12px]"
        />
      </Field>

      <Field label="Config mẫu để tính thử (JSON)">
        <Textarea
          rows={3}
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          className="font-mono text-[12px]"
        />
      </Field>

      {testResult && (
        <p className="text-[13px] text-good font-medium">Giá tính thử: {testResult}</p>
      )}
      {error && <p className="text-[12px] text-bad">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={handleTest}>Tính thử</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Đang lưu..." : "Lưu giá"}
        </Button>
      </div>
    </div>
  );
}

function ProviderProductsTab({ providerId, adapterType }: { providerId: number; adapterType: string }) {
  const [products, setProducts] = useState<ProviderProduct[]>([]);
  const [allProducts, setAllProducts] = useState<AdminProduct[]>([]);
  const [compatMatrix, setCompatMatrix] = useState<CompatMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [attachId, setAttachId] = useState<string>("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.providerProducts(providerId).catch(() => []),
      api.adminProducts().catch(() => []),
      api.adapterCompatibility().catch(() => null),
    ])
      .then(([linked, all, matrix]) => {
        setProducts(linked ?? []);
        setAllProducts(all ?? []);
        setCompatMatrix(matrix);
      })
      .finally(() => setLoading(false));
  }, [providerId]);

  useEffect(() => {
    load();
  }, [load]);

  const linkedIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const attachable = useMemo(
    () => allProducts.filter((p) => !linkedIds.has(p.id)),
    [allProducts, linkedIds],
  );

  const handleAttach = async () => {
    if (!attachId) return;
    setActionError(null);
    try {
      await api.updateProductOperations(Number(attachId), { provider_id: providerId });
      setAttachId("");
      load();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Gắn sản phẩm thất bại");
    }
  };

  const handleDetach = async (productId: number) => {
    setActionError(null);
    try {
      await api.updateProductOperations(productId, { provider_id: null });
      load();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Tháo liên kết thất bại");
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {/* Attach row */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Gắn sản phẩm vào provider" hint={`Sản phẩm có chiến lược giá không tương thích với adapter "${adapterType}" bị vô hiệu hoá.`}>
            <Select value={attachId} onChange={(e) => setAttachId(e.target.value)}>
              <option value="">Chọn sản phẩm...</option>
              {attachable.map((p) => {
                const compatible = isAdapterCompatible(adapterType, p.pricing_strategy ?? "fixed", compatMatrix);
                return (
                  <option key={p.id} value={p.id} disabled={!compatible}>
                    #{p.id} {p.title}{p.provider_name ? ` (đang: ${p.provider_name})` : ""}{!compatible ? " — không tương thích" : ""}
                  </option>
                );
              })}
            </Select>
          </Field>
        </div>
        <Button size="sm" onClick={handleAttach} disabled={!attachId}>Gắn</Button>
      </div>

      {actionError && <p className="text-[12px] text-bad">{actionError}</p>}

      {products.length === 0 ? (
        <div className="rounded-lg bg-surface border border-line p-4 text-center">
          <p className="text-[13px] text-muted">Chưa có sản phẩm liên kết với provider này.</p>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-muted">{products.length} sản phẩm sử dụng provider này</p>
          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-surface border-b border-line">
                  <th className="text-left px-3 py-2 font-medium text-muted">Sản phẩm</th>
                  <th className="text-left px-3 py-2 font-medium text-muted">Loại</th>
                  <th className="text-left px-3 py-2 font-medium text-muted">Giá</th>
                  <th className="text-right px-3 py-2 font-medium text-muted">Đơn hàng</th>
                  <th className="text-right px-3 py-2 font-medium text-muted">Doanh thu</th>
                  <th className="text-right px-3 py-2 font-medium text-muted"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-b border-line last:border-0 hover:bg-surface/50">
                      <td className="px-3 py-2 text-fg font-medium">
                        {p.title}
                        {p.compat_level === "block" && (
                          <Tag tone="bad" className="ml-2">Sai cấu hình</Tag>
                        )}
                        {p.compat_level === "warn" && (
                          <Tag tone="iris" className="ml-2">Demo</Tag>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted">{p.service_type}</td>
                      <td className="px-3 py-2">
                        {p.pricing_strategy ? (
                          <Tag tone="iris">{STRATEGY_LABELS[p.pricing_strategy] ?? p.pricing_strategy}</Tag>
                        ) : (
                          <Tag tone="neutral">Mặc định</Tag>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-muted">{p.order_count}</td>
                      <td className="px-3 py-2 text-right text-fg font-medium">
                        {p.revenue.toLocaleString("vi-VN")}đ
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                          className="text-[12px] text-iris hover:underline cursor-pointer mr-2"
                        >
                          Sửa giá
                        </button>
                        <button
                          onClick={() => handleDetach(p.id)}
                          className="text-[12px] text-bad hover:underline cursor-pointer"
                        >
                          Tháo
                        </button>
                      </td>
                    </tr>
                    {p.compat_level === "block" && (
                      <tr key={`${p.id}-warn`} className="border-b border-line last:border-0">
                        <td colSpan={6} className="px-3 pb-3">
                          <Banner tone="bad" icon={<Info size={14} />}>
                            {p.compat_message ?? "Cấu hình sai — đơn hàng cho sản phẩm này sẽ bị huỷ tự động."}
                          </Banner>
                        </td>
                      </tr>
                    )}
                    {editingId === p.id && (
                      <tr key={`${p.id}-editor`} className="border-b border-line last:border-0">
                        <td colSpan={6} className="px-3 py-3">
                          <PricingEditor
                            product={p}
                            adapterType={adapterType}
                            compatMatrix={compatMatrix}
                            onSaved={() => {
                              setEditingId(null);
                              load();
                            }}
                            onClose={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ================================================================
   Edit Panel (slide-out with tabs)
   ================================================================ */

/* Dùng chung cho cả panel Sửa provider và panel Tạo provider mới — tránh chép
   lại 5 khối JSX theo adapter_type ở hai chỗ (trước đây chỉ tồn tại trong
   ProviderEditPanel, panel tạo mới sẽ không có nếu không tách ra). */
function AdapterConnectionFields({
  adapterType,
  config,
  onChange,
  providerId,
  onTest,
  testing,
  testResult,
}: {
  adapterType: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  providerId?: number;
  onTest?: (type: "health" | "provision") => void;
  testing?: boolean;
  testResult?: Record<string, unknown> | null;
}) {
  if (adapterType === "mock") {
    return (
      <div className="rounded-lg bg-surface border border-line p-4 text-center">
        <svg className="h-8 w-8 mx-auto mb-2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <p className="text-[13px] text-muted">Provider mock không cần kết nối API.</p>
        <p className="text-[12px] text-faint mt-1">Dữ liệu giả được tạo tự động để test.</p>
      </div>
    );
  }

  if (adapterType === "seller_pool") {
    return (
      <div className="rounded-lg bg-surface border border-line p-4 text-center">
        <svg className="h-8 w-8 mx-auto mb-2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
        <p className="text-[13px] text-muted">Dữ liệu lấy từ resource pool. Không cần API.</p>
        <p className="text-[12px] text-faint mt-1">Seller upload kho hàng, hệ thống tự phân phối.</p>
      </div>
    );
  }

  if (adapterType === "manual") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-surface border border-line p-3">
          <p className="text-[13px] text-muted">Team xử lý thủ công. Cấu hình kênh thông báo.</p>
        </div>
        <Field label="Kênh thông báo (notification channel)">
          <Input
            value={(config.notification_channel as string) ?? ""}
            onChange={(e) => onChange({ ...config, notification_channel: e.target.value })}
            placeholder="VD: #takedown-team"
          />
        </Field>
      </div>
    );
  }

  if (adapterType === "topproxy" || adapterType === "scrapecreators" || adapterType === "seller_gateway") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-iris-soft/50 border border-iris/20 p-3">
          <p className="text-[12px] text-iris-hi">
            {adapterType === "seller_gateway"
              ? "Base URL/API key của backend do SELLER tự cung cấp — buyer gọi qua platform (/gw/{key}/...), không bao giờ thấy 2 giá trị này."
              : "Nhập API key và base URL để kết nối với nhà cung cấp."}{" "}
            {providerId != null ? "Dùng nút Test để kiểm tra trước khi lưu." : "Lưu xong mới test kết nối được."}
          </p>
        </div>

        <Field label="API Key">
          <Input
            type="password"
            value={(config.api_key as string) ?? ""}
            onChange={(e) => onChange({ ...config, api_key: e.target.value })}
            placeholder="Nhập API key..."
          />
        </Field>

        <Field label="Base URL">
          <Input
            value={(config.base_url as string) ?? ""}
            onChange={(e) => onChange({ ...config, base_url: e.target.value })}
            placeholder="https://api.example.com"
          />
        </Field>

        {providerId != null && onTest && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onTest("health")} disabled={testing}>
              {testing ? "Đang test..." : "Test kết nối"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onTest("provision")} disabled={testing}>
              {testing ? "Đang test..." : "Test cấp phát"}
            </Button>
          </div>
        )}

        {testResult && (
          <Card className="p-3">
            <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Kết quả test</h4>
            <pre className="text-[11px] font-mono text-fg whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </Card>
        )}
      </div>
    );
  }

  if (adapterType === "seller_task_webhook") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-iris-soft/50 border border-iris/20 p-3">
          <p className="text-[12px] text-iris-hi">
            Mỗi tác vụ được POST tới base URL của seller (<code>/v1/tasks</code>); seller báo kết quả
            qua webhook <code>/webhooks/providers/&#123;id&#125;/tasks/&#123;external_task_id&#125;</code>,
            ký bằng webhook secret bên dưới.
          </p>
        </div>

        <Field label="API Key">
          <Input
            type="password"
            value={(config.api_key as string) ?? ""}
            onChange={(e) => onChange({ ...config, api_key: e.target.value })}
            placeholder="Nhập API key..."
          />
        </Field>

        <Field label="Base URL">
          <Input
            value={(config.base_url as string) ?? ""}
            onChange={(e) => onChange({ ...config, base_url: e.target.value })}
            placeholder="https://api.example.com"
          />
        </Field>

        <Field label="Webhook secret">
          <Input
            type="password"
            value={(config.webhook_secret as string) ?? ""}
            onChange={(e) => onChange({ ...config, webhook_secret: e.target.value })}
            placeholder="Dùng để ký/xác thực callback từ seller"
          />
        </Field>

        {providerId != null && onTest && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onTest("health")} disabled={testing}>
              {testing ? "Đang test..." : "Test kết nối"}
            </Button>
          </div>
        )}

        {testResult && (
          <Card className="p-3">
            <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Kết quả test</h4>
            <pre className="text-[11px] font-mono text-fg whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </Card>
        )}
      </div>
    );
  }

  if (adapterType === "dproxy") {
    const authType = (config.auth_type as string) ?? "bearer";
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-iris-soft/50 border border-iris/20 p-3">
          <p className="text-[12px] text-iris-hi">
            Nền tảng gọi <code>GET /api/v1/proxies/user</code> (cố định, không cấu hình được) để lấy tồn kho
            proxy và cấp độc quyền cho từng đơn. Buyer tự đổi IP qua nút &quot;Đổi IP&quot; — không bao giờ
            thấy base_url/api_key thật.{" "}
            {providerId != null ? "Dùng nút Test để kiểm tra trước khi lưu." : "Lưu xong mới test kết nối được."}
          </p>
        </div>

        <Field label="Base URL">
          <Input
            value={(config.base_url as string) ?? ""}
            onChange={(e) => onChange({ ...config, base_url: e.target.value })}
            placeholder="https://api.dproxy.example"
          />
        </Field>

        <Field label="API Key">
          <Input
            type="password"
            value={(config.api_key as string) ?? ""}
            onChange={(e) => onChange({ ...config, api_key: e.target.value })}
            placeholder="Nhập API key..."
          />
        </Field>

        <Field label="Kiểu xác thực">
          <Select
            value={authType}
            onChange={(e) => onChange({ ...config, auth_type: e.target.value })}
          >
            <option value="bearer">Authorization: Bearer</option>
            <option value="header">Header tuỳ chỉnh</option>
          </Select>
        </Field>

        {authType === "header" && (
          <Field label="Tên header xác thực">
            <Input
              value={(config.auth_header as string) ?? ""}
              onChange={(e) => onChange({ ...config, auth_header: e.target.value })}
              placeholder="X-API-Key"
            />
          </Field>
        )}

        <Field label="Rotate method">
          <Select
            value={(config.rotate_method as string) ?? "POST"}
            onChange={(e) => onChange({ ...config, rotate_method: e.target.value })}
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
            <option value="PUT">PUT</option>
          </Select>
        </Field>

        {providerId != null && onTest && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onTest("health")} disabled={testing}>
              {testing ? "Đang test..." : "Test kết nối"}
            </Button>
          </div>
        )}

        {testResult && (
          <Card className="p-3">
            <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Kết quả test</h4>
            <TestResultBody testResult={testResult} />
          </Card>
        )}
      </div>
    );
  }

  return null;
}

/* health từ DProxyAdapter.check_health() (src/adapters/dproxy.py) luôn có
   dạng {status, message, usable, total, rotation_capable, earliest_expiry}
   khi thành công — hiện đúng các số này thay vì dump JSON thô, dễ đọc hơn
   nhiều cho một admin không đọc code. Rơi về JSON thô nếu shape khác đi
   (lỗi/status khác adapter, không có field này) thay vì cố đoán không có
   thật. Không tự vẽ header/Card — hai chỗ dùng nó (panel cấu hình, toast
   test nhanh) đã có khung + tiêu đề riêng của mình. */
function TestResultBody({ testResult }: { testResult: Record<string, unknown> }) {
  const health = testResult.health as Record<string, unknown> | undefined;
  const hasSummary = health && typeof health.usable === "number" && typeof health.total === "number";

  if (!hasSummary) {
    return (
      <pre className="text-[11px] font-mono text-fg whitespace-pre-wrap overflow-x-auto">
        {JSON.stringify(testResult, null, 2)}
      </pre>
    );
  }

  const usable = health.usable as number;
  const total = health.total as number;
  const rotationCapable = (health.rotation_capable as number | undefined) ?? 0;
  const earliestExpiry = health.earliest_expiry as string | null | undefined;
  const healthy = health.status === "healthy";

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Tag tone={healthy ? "good" : "warn"}>{healthy ? "Lành mạnh" : "Cảnh báo"}</Tag>
        <span className="text-[12.5px] text-muted">{String(health.message ?? "")}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-surface border border-line py-2">
          <div className="text-[16px] font-semibold tabular">{usable}/{total}</div>
          <div className="text-[10.5px] text-faint uppercase tracking-wide">Khả dụng</div>
        </div>
        <div className="rounded-md bg-surface border border-line py-2">
          <div className="text-[16px] font-semibold tabular">{rotationCapable}</div>
          <div className="text-[10.5px] text-faint uppercase tracking-wide">Đổi IP được</div>
        </div>
        <div className="rounded-md bg-surface border border-line py-2">
          <div className="text-[11px] font-medium pt-1">{earliestExpiry ? new Date(earliestExpiry).toLocaleDateString("vi-VN") : "—"}</div>
          <div className="text-[10.5px] text-faint uppercase tracking-wide">Hết hạn sớm nhất</div>
        </div>
      </div>
    </div>
  );
}

type TabKey = "general" | "api" | "products";

const TABS: { key: TabKey; label: string }[] = [
  { key: "general", label: "Thông tin chung" },
  { key: "api", label: "Kết nối API" },
  { key: "products", label: "Sản phẩm liên kết" },
];

function ProviderEditPanel({
  provider,
  allProviders,
  initialTab,
  onClose,
  onSaved,
}: {
  provider: ExpandedProvider;
  allProviders: ExpandedProvider[];
  initialTab?: TabKey;
  onClose: () => void;
  onSaved: (p: Provider) => void;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? "general");
  const [adapterType, setAdapterType] = useState(provider.adapter_type ?? "mock");
  const [config, setConfig] = useState<Record<string, unknown>>(provider.config ?? {});
  const [fallbackId, setFallbackId] = useState<number | null>(provider.fallback_provider_id);
  const [isActive, setIsActive] = useState(provider.is_active);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const otherProviders = allProviders.filter((p) => p.id !== provider.id);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const updated = await api.updateProvider(provider.id, {
        adapter_type: adapterType,
        config,
        fallback_provider_id: fallbackId,
        is_active: isActive,
      });
      setSuccess("Da luu thanh cong!");
      setTimeout(() => setSuccess(null), 3000);
      onSaved(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Lỗi khi lưu");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (type: "health" | "provision") => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testProvider(provider.id);
      setTestResult(
        type === "health"
          ? { health: result.health }
          : { provision_test: result.provision_test ?? { note: "Adapter này không hỗ trợ test cấp phát." } },
      );
    } catch (e: unknown) {
      setTestResult({ error: e instanceof Error ? e.message : "Test thất bại" });
    } finally {
      setTesting(false);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-[600px] bg-surface z-[70] shadow-2xl border-l border-line overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-line z-10">
          <div className="px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${ADAPTER_COLORS[provider.adapter_type] ?? "bg-surface"}`}>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={ADAPTER_DESCRIPTIONS[provider.adapter_type]?.icon ?? "M12 6v6m0 0v6m0-6h6m-6 0H6"} />
                </svg>
              </div>
              <div>
                <h2 className="text-[15px] font-semibold">{provider.name}</h2>
                <p className="text-[11px] text-muted">{ADAPTER_DESCRIPTIONS[provider.adapter_type]?.label ?? provider.adapter_type}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted hover:text-fg text-[18px] leading-none px-2 cursor-pointer"
            >
              &times;
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 px-5 -mb-px">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${
                  tab === t.key
                    ? "border-iris text-fg"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="p-5 space-y-5">
          {/* Tab 1: General */}
          {tab === "general" && (
            <>
              <Field label="Ten nhà cung cấp">
                <Input value={provider.name} disabled className="opacity-60" />
              </Field>

              <Field label="Loai adapter">
                <Select value={adapterType} onChange={(e) => setAdapterType(e.target.value)}>
                  {ADAPTER_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {ADAPTER_DESCRIPTIONS[a]?.label ?? a}
                    </option>
                  ))}
                </Select>
              </Field>

              {/* Adapter description */}
              <div className="rounded-lg bg-surface border border-line p-3">
                <p className="text-[12px] text-muted">
                  {ADAPTER_DESCRIPTIONS[adapterType]?.desc ?? ""}
                </p>
              </div>

              <Field label="Nhà cung cấp dự phòng">
                <Select
                  value={fallbackId ?? ""}
                  onChange={(e) => setFallbackId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Không có</option>
                  {otherProviders.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsActive(!isActive)}
                  className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                    isActive ? "bg-good" : "bg-line-2"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      isActive ? "translate-x-5" : ""
                    }`}
                  />
                </button>
                <span className="text-[13px] text-fg">{isActive ? "Hoạt động" : "Tắt"}</span>
              </div>
            </>
          )}

          {/* Tab 2: API Connection */}
          {tab === "api" && (
            <AdapterConnectionFields
              adapterType={adapterType}
              config={config}
              onChange={setConfig}
              providerId={provider.id}
              onTest={handleTest}
              testing={testing}
              testResult={testResult}
            />
          )}

          {/* Tab 3: Connected Products */}
          {tab === "products" && (
            // Truyền state adapterType đang sửa dở, không phải provider.adapter_type
            // đã lưu — nếu không, đổi loại adapter ở tab "Thông tin chung" rồi
            // sang thẳng tab này (chưa bấm Lưu) sẽ vẫn kiểm tra tương thích
            // theo loại CŨ, gây hiểu nhầm sản phẩm nào gắn được.
            <ProviderProductsTab providerId={provider.id} adapterType={adapterType} />
          )}

          {/* Bottom actions (visible on all tabs) */}
          <div className="border-t border-line pt-4 space-y-3">
            {error && (
              <div className="rounded-lg bg-bad-soft border border-bad/25 px-3 py-2">
                <p className="text-[12px] text-bad">{error}</p>
              </div>
            )}
            {success && (
              <div className="rounded-lg bg-good-soft border border-good/25 px-3 py-2">
                <p className="text-[12px] text-good">{success}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu thay đổi"}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Đóng
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ================================================================
   Create Provider Panel — thứ tự đúng nhân quả: chọn LOẠI KẾT NỐI trước
   (nó quyết định field kết nối nào hiện ra + tương thích chiến lược giá
   nào), rồi mới tới tên. Không phải wizard nhiều bước có Back/Next — cả
   trang cuộn 1 lần, đúng quy ước "1 form duy nhất" repo đang dùng ở mọi
   chỗ tạo mới khác (tạo sản phẩm, tạo category).
   ================================================================ */

function CreateProviderPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Provider) => void;
}) {
  const [adapterType, setAdapterType] = useState("mock");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [compatMatrix, setCompatMatrix] = useState<CompatMatrix | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adapterCompatibility().then(setCompatMatrix).catch(() => {});
  }, []);

  const compatLabel = (adapter: string): string => {
    const compat = compatMatrix?.[adapter];
    if (compat == null) return "";
    if (compat === "*") return "Tương thích mọi chiến lược giá — chỉ nên dùng để demo/test.";
    return `Chỉ dùng được với chiến lược giá: ${compat.map((s) => STRATEGY_LABELS[s] ?? s).join(", ")}.`;
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const created = await api.createProvider({
        name: name.trim(),
        adapter_type: adapterType,
        config,
        priority: 1,
        is_active: true,
      });
      onCreated(created);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Không tạo được nhà cung cấp");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-[600px] bg-surface z-[70] shadow-2xl border-l border-line overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-line z-10">
          <div className="px-5 py-3.5 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Thêm nhà cung cấp mới</h2>
            <button onClick={onClose} className="text-muted hover:text-fg text-[18px] leading-none px-2 cursor-pointer">
              &times;
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* Bước 1 */}
          <div>
            <div className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-1">1. Loại kết nối</div>
            <p className="text-[12px] text-faint mb-3">
              Quyết định cách hệ thống giao hàng khi có đơn — chọn trước vì nó quyết định các bước sau.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ADAPTER_OPTIONS.map((a) => {
                const info = ADAPTER_DESCRIPTIONS[a];
                const active = adapterType === a;
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => { setAdapterType(a); setConfig({}); }}
                    className={`text-left rounded-lg border p-3 transition-all cursor-pointer ${active ? "border-iris bg-iris/5 ring-1 ring-iris/30" : "border-line bg-raised hover:border-muted"}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${active ? "border-iris bg-iris" : "border-muted"}`} />
                      <span className="text-[13px] font-semibold">{info?.label ?? a}</span>
                    </div>
                    <p className="text-[12px] text-muted mt-1 ml-5">{info?.desc}</p>
                    {compatMatrix && <p className="text-[11px] text-iris-hi mt-1 ml-5">{compatLabel(a)}</p>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bước 2 */}
          <div>
            <div className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-2">2. Tên nhà cung cấp</div>
            <Field
              label="Tên"
              hint="Chỉ để bạn dễ nhận diện — không ảnh hưởng cách hệ thống xử lý đơn hàng (cái đó do Loại kết nối ở bước 1 quyết định)."
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: TopProxy — tài khoản chính" />
            </Field>
          </div>

          {/* Bước 3 */}
          <div>
            <div className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-2">3. Kết nối</div>
            <AdapterConnectionFields adapterType={adapterType} config={config} onChange={setConfig} />
          </div>

          {error && (
            <div className="rounded-lg bg-bad-soft border border-bad/25 px-3 py-2">
              <p className="text-[12px] text-bad">{error}</p>
            </div>
          )}

          <div className="flex gap-2 border-t border-line pt-4">
            <Button onClick={handleCreate} disabled={!name.trim() || saving}>
              {saving ? "Đang tạo..." : "Tạo nhà cung cấp"}
            </Button>
            <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ================================================================
   Summary stat card
   ================================================================ */

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-medium text-muted uppercase tracking-wide">{label}</p>
      <p className="text-[22px] font-bold text-fg mt-1">{value}</p>
      {sub && <p className="text-[12px] text-faint mt-0.5">{sub}</p>}
    </Card>
  );
}

/* ================================================================
   Provider Card
   ================================================================ */

const REVIEW_STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  approved: "good",
  pending_review: "warn",
  rejected: "bad",
  disabled: "neutral",
};

const REVIEW_STATUS_LABEL: Record<string, string> = {
  approved: "Đã duyệt",
  pending_review: "Chờ duyệt",
  rejected: "Đã từ chối",
  disabled: "Đã tắt",
};

function ProviderCard({
  provider,
  onConfigure,
  onTest,
  onApprove,
  onReject,
}: {
  provider: ExpandedProvider;
  onConfigure: () => void;
  onTest: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const latest = provider.health && provider.health.length > 0 ? provider.health[0] : null;
  const healthInfo = latest ? HEALTH_MAP[latest.status] : null;
  const adapterInfo = ADAPTER_DESCRIPTIONS[provider.adapter_type];
  const adapterCls = ADAPTER_COLORS[provider.adapter_type] ?? "bg-surface text-muted border-line-2";
  // mock/seller_pool/manual không cần API thật — chỉ topproxy/scrapecreators/dproxy
  // mới cần api_key + base_url, thiếu 1 trong 2 là chưa dùng được dù đã tạo.
  const needsApiSetup =
    (provider.adapter_type === "topproxy" || provider.adapter_type === "scrapecreators" || provider.adapter_type === "dproxy")
    && (!provider.config?.api_key || !provider.config?.base_url);

  return (
    <Card interactive className="p-4 flex flex-col gap-3">
      {/* Top row: icon + name + status */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${adapterCls}`}>
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={adapterInfo?.icon ?? "M12 6v6m0 0v6m0-6h6m-6 0H6"} />
            </svg>
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-fg">{provider.name}</h3>
            <p className="text-[12px] text-muted">{adapterInfo?.desc ?? provider.adapter_type}</p>
          </div>
        </div>

        {/* Health dot */}
        {healthInfo && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: healthInfo.color }}
            />
            <span className="text-[11px] text-muted">{healthInfo.label}</span>
          </div>
        )}
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone={provider.is_active ? "good" : "bad"}>
          {provider.is_active ? "Hoạt động" : "Tắt"}
        </Tag>
        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none ${adapterCls}`}>
          {adapterInfo?.label ?? provider.adapter_type}
        </span>
        {provider.quality_score != null && (
          <Tag tone="neutral">
            Điểm: {provider.quality_score.toFixed(1)}
          </Tag>
        )}
        {needsApiSetup && <Tag tone="bad">Chưa cấu hình API</Tag>}
        {provider.seller_id != null && (
          <Tag tone={REVIEW_STATUS_TONE[provider.review_status] ?? "neutral"}>
            Seller #{provider.seller_id} · {REVIEW_STATUS_LABEL[provider.review_status] ?? provider.review_status}
          </Tag>
        )}
      </div>

      {provider.review_status === "rejected" && provider.review_note && (
        <p className="text-[11.5px] text-bad">Lý do từ chối: {provider.review_note}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        <Button variant="secondary" size="sm" onClick={onTest}>
          Test
        </Button>
        <Button size="sm" onClick={onConfigure}>
          Cấu hình
        </Button>
      </div>
      {provider.seller_id != null && provider.review_status === "pending_review" && (
        <div className="flex gap-2 -mt-1">
          <Button variant="secondary" size="sm" className="flex-1 border-good/40 text-good" onClick={onApprove}>
            Duyệt
          </Button>
          <Button variant="secondary" size="sm" className="flex-1 border-bad/40 text-bad" onClick={onReject}>
            Từ chối
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ================================================================
   Main Page
   ================================================================ */

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<ExpandedProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editProvider, setEditProvider] = useState<ExpandedProvider | null>(null);
  const [editProviderInitialTab, setEditProviderInitialTab] = useState<TabKey | undefined>(undefined);
  const [creatingProvider, setCreatingProvider] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; data: Record<string, unknown> } | null>(null);
  const [linkedCount, setLinkedCount] = useState<number | null>(null);

  useEffect(() => {
    api.providers()
      .catch(() => [])
      .then((p) => setProviders(p ?? []))
      .finally(() => setLoading(false));
    api.adminProducts()
      .then((all) => setLinkedCount((all ?? []).filter((p) => p.provider_name != null).length))
      .catch(() => setLinkedCount(null));
  }, []);

  const getLatestHealth = useCallback(async (providerId: number): Promise<ProviderHealth | null> => {
    try {
      const health = await api.providerHealth(providerId);
      return health && health.length > 0 ? health[0] : null;
    } catch {
      return null;
    }
  }, []);

  // Load health for all providers
  useEffect(() => {
    if (providers.length === 0) return;
    providers.forEach((p) => {
      if (p.health !== undefined) return;
      getLatestHealth(p.id).then((h) => {
        setProviders((prev) =>
          prev.map((pr) =>
            pr.id === p.id ? { ...pr, health: h ? [h] : [], loadingHealth: false } : pr,
          ),
        );
      });
    });
  }, [providers.length, getLatestHealth]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaved = (updated: Provider) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
    );
    setEditProvider(null);
    setEditProviderInitialTab(undefined);
  };

  const handleCreated = (created: Provider) => {
    const expanded: ExpandedProvider = { ...created, health: [] };
    setProviders((prev) => [...prev, expanded]);
    setCreatingProvider(false);
    // topproxy/scrapecreators/dproxy cần api_key/base_url thật trước khi dùng được —
    // đưa thẳng vào tab đó để test kết nối ngay, khỏi phải tự tìm nút Cấu hình
    // lần nữa. Loại còn lại (mock/seller_pool/manual) không cần API nên việc
    // tiếp theo có ích nhất là gắn sản phẩm luôn.
    const needsApiSetup = created.adapter_type === "topproxy" || created.adapter_type === "scrapecreators" || created.adapter_type === "dproxy";
    setEditProviderInitialTab(needsApiSetup ? "api" : "products");
    setEditProvider(expanded);
  };

  const handleApprove = async (provider: ExpandedProvider) => {
    const note = window.prompt("Ghi chú (tuỳ chọn) khi duyệt:") ?? undefined;
    const updated = await api.approveProvider(provider.id, note || undefined);
    setProviders((prev) => prev.map((p) => (p.id === provider.id ? { ...p, ...updated } : p)));
  };

  const handleReject = async (provider: ExpandedProvider) => {
    const note = window.prompt("Lý do từ chối:") ?? undefined;
    const updated = await api.rejectProvider(provider.id, note || undefined);
    setProviders((prev) => prev.map((p) => (p.id === provider.id ? { ...p, ...updated } : p)));
  };

  const handleQuickTest = async (provider: ExpandedProvider) => {
    setTestingId(provider.id);
    setTestResult(null);
    try {
      const result = await api.testProvider(provider.id);
      setTestResult({ id: provider.id, data: { health: result.health } });
    } catch (e: unknown) {
      setTestResult({ id: provider.id, data: { error: e instanceof Error ? e.message : "Test thất bại" } });
    } finally {
      setTestingId(null);
    }
  };

  // Computed stats
  const stats = useMemo(() => {
    const active = providers.filter((p) => p.is_active).length;
    return {
      total: providers.length,
      active,
    };
  }, [providers]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[16px] font-semibold">Nhà cung cấp</h1>
        <Button size="sm" onClick={() => setCreatingProvider(true)}>+ Thêm nhà cung cấp</Button>
      </div>

      {loading ? (
        <Spinner />
      ) : providers.length === 0 ? (
        <Card className="p-8 text-center space-y-3">
          <p className="text-[13px] text-muted">Chưa có nhà cung cấp nào</p>
          <Button size="sm" onClick={() => setCreatingProvider(true)}>+ Thêm nhà cung cấp</Button>
        </Card>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Tổng nhà cung cấp"
              value={stats.total}
            />
            <StatCard
              label="Đang hoạt động"
              value={stats.active}
              sub={`${stats.total - stats.active} tat`}
            />
            <StatCard
              label="Sản phẩm liên kết"
              value={linkedCount ?? "--"}
              sub="đang gắn provider"
            />
            <StatCard
              label="Adapter"
              value={new Set(providers.map((p) => p.adapter_type)).size}
              sub="loại đang dùng"
            />
          </div>

          {/* Provider cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                onConfigure={() => setEditProvider(p)}
                onTest={() => handleQuickTest(p)}
                onApprove={() => handleApprove(p)}
                onReject={() => handleReject(p)}
              />
            ))}
          </div>

          {/* Quick test result toast */}
          {(testingId !== null || testResult !== null) && (
            <div className="fixed bottom-5 right-5 z-50">
              <Card className="p-4 max-w-sm shadow-lg">
                {testingId !== null ? (
                  <div className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-line-2 border-t-iris animate-spin" />
                    <span className="text-[13px] text-muted">Dang test provider...</span>
                  </div>
                ) : testResult ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[12px] font-semibold text-muted uppercase tracking-wide">Kết quả test</h4>
                      <button
                        onClick={() => setTestResult(null)}
                        className="text-muted hover:text-fg text-[14px] px-1 cursor-pointer"
                      >
                        &times;
                      </button>
                    </div>
                    {"error" in testResult.data ? (
                      <p className="text-[12.5px] text-bad">{String(testResult.data.error)}</p>
                    ) : (
                      <TestResultBody testResult={testResult.data} />
                    )}
                  </div>
                ) : null}
              </Card>
            </div>
          )}
        </>
      )}

      {/* Edit Panel */}
      {editProvider && (
        <ProviderEditPanel
          provider={editProvider}
          allProviders={providers}
          initialTab={editProviderInitialTab}
          onClose={() => { setEditProvider(null); setEditProviderInitialTab(undefined); }}
          onSaved={handleSaved}
        />
      )}

      {/* Create Panel */}
      {creatingProvider && (
        <CreateProviderPanel
          onClose={() => setCreatingProvider(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
