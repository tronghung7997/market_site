"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, vnd, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CalculateResult, Order, PricingField, PricingOptions, ProductDetail } from "@/lib/types";
import { Banner, Button, Card, Input, Select, Tag, Textarea } from "@/components/ui";
import { Info, Shield } from "@/components/Icons";

interface Props {
  productId: number;
  product: ProductDetail;
  onOrderCreated: (order: Order) => void;
}

/** Vỏ phiếu đặt hàng — dùng chung cho các trạng thái CHƯA có form (đang tải,
 *  lỗi tải tuỳ chọn) để khung phiếu không biến mất giữa chừng. Trạng thái đủ
 *  dữ liệu vẫn tự dựng vỏ riêng vì nó cần thêm Tag "Giao tự động" ở nắp. */
function FormShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden shadow-card-lg">
      <div className="px-5 h-11 flex items-center bg-ink-panel dotgrid-dark">
        <span className="text-[12.5px] font-semibold tracking-wide text-white/95">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export default function DynamicOrderForm({ productId, product, onOrderCreated }: Props) {
  const router = useRouter();
  const { account } = useAuth();

  const [options, setOptions] = useState<PricingOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [qty, setQty] = useState(1);

  const [calc, setCalc] = useState<CalculateResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch pricing options on mount
  useEffect(() => {
    (async () => {
      try {
        const opts = await api.pricingOptions(productId);
        setOptions(opts);
        // Set default values
        const defaults: Record<string, unknown> = {};
        for (const f of opts.fields) {
          if (f.default != null) {
            defaults[f.field] = f.default;
          } else if (f.type === "select" && f.choices?.length) {
            defaults[f.field] = f.choices[0].value;
          } else if (f.type === "radio" && f.choices?.length) {
            defaults[f.field] = f.choices[0].value;
          } else if (f.type === "number" || f.type === "slider") {
            defaults[f.field] = f.min ?? 1;
          }
        }
        setConfig(defaults);
      } catch (e) {
        setOptionsError(e instanceof Error ? e.message : "Không tải được tùy chọn giá");
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, [productId]);

  // Debounced calculate on config/qty change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // DProxy chỉ bind được đúng 1 ProxyAllocation/order (UNIQUE(order_id) ở
  // backend) — package_size/quantity > 1 sẽ tính tiền nhiều proxy nhưng chỉ
  // giao 1. Backend đã chặn (orders/service.py::create_order_with_adapter),
  // đây là khoá phía frontend để buyer không bao giờ thấy lỗi đó — luôn ép
  // package_size=1 bất kể field gốc cho phép gì. Xem
  // docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md P0#1.
  const isDproxy = options?.adapter_type === "dproxy";
  // "auto_proxy" là nhãn public của adapter proxy mua-theo-đơn (backend che
  // tên nguồn thật — xem _PUBLIC_ADAPTER_ALIASES, src/pricing/router.py).
  // Cùng ràng buộc 1 allocation/đơn với DProxy nên dùng chung khoá số lượng.
  const isSingleUnit = isDproxy || options?.adapter_type === "auto_proxy";
  // Với strategy "credit" (mua gói request), "package_size" TỰ NÓ đã là số
  // lượng thật (đã chọn trong DynamicField ở trên) — backend chỉ cấp phát
  // đúng bằng package_size và bỏ qua hoàn toàn quantity riêng
  // (pricing/credit.py::CreditPricing chỉ khai field "package_size", không có
  // "quantity"). Stepper "Số lượng" bên dưới trước đây vẫn hiện cho strategy
  // này dù không ảnh hưởng giá lẫn số request nhận được — thuần cosmetic,
  // gây hiểu lầm buyer mua được "2 x gói". Ẩn nó đi, giống cách đã ẩn với
  // task/isSingleUnit.
  const isCredit = options?.strategy === "credit";
  // Toàn bộ phần TRẤN AN + nhãn thân thiện dưới đây trước kia gắn vào
  // `isDproxy`, nên sản phẩm auto_proxy (TopProxy) tuy cũng giao tự động và
  // cũng tự hoàn tiền khi cấp phát hỏng lại rơi vào nhánh "chung": tiêu đề
  // "Cấu hình đơn hàng" và một Tag in ra tên strategy máy. Điều kiện đúng là
  // "đơn này có được giao tự động không", tức `isSingleUnit`.
  const isAutoDelivered = isSingleUnit;

  const doCalculate = useCallback(async (cfg: Record<string, unknown>, q: number) => {
    if (!options || !options.ready || options.fields.length === 0) return;
    // Field bắt buộc còn trống (vd target_urls rỗng lúc mới vào trang) không
    // phải là lỗi — buyer chỉ đang chưa điền xong. Bỏ qua im lặng, đừng gọi
    // API để rồi biến "chưa điền" thành một thông báo lỗi giả.
    const missingRequired = options.fields.some(
      (f) => f.required && (cfg[f.field] == null || cfg[f.field] === ""),
    );
    if (missingRequired) {
      setCalc(null);
      setCalcError(null);
      return;
    }
    setCalculating(true);
    try {
      const merged = { ...cfg, quantity: isSingleUnit ? 1 : q, ...(isDproxy ? { package_size: 1 } : {}) };
      const result = await api.calculatePrice(productId, merged);
      setCalc(result);
      setCalcError(null);
    } catch (e) {
      // Đây mới là lỗi thật (field đã điền nhưng backend từ chối) — trước đây
      // bị nuốt hoàn toàn, giá cứ đứng ở "—" mãi mà buyer không hiểu vì sao.
      setCalc(null);
      setCalcError(e instanceof Error ? e.message : "Không tính được giá — thử lại.");
    } finally {
      setCalculating(false);
    }
  }, [productId, options, isDproxy, isSingleUnit]);

  useEffect(() => {
    if (!options) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doCalculate(config, qty), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [config, qty, doCalculate, options]);

  const updateField = (field: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!account) { router.push(`/login?next=/products/${productId}`); return; }
    setShowConfirm(true);
  };

  const confirmBuy = async () => {
    setPlacing(true);
    setPlaceError(null);
    try {
      const finalConfig = { ...config, quantity: isSingleUnit ? 1 : qty, ...(isDproxy ? { package_size: 1 } : {}) };
      const order = await api.createOrderWithConfig(productId, finalConfig, isSingleUnit ? 1 : qty);
      setShowConfirm(false);
      onOrderCreated(order);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setPlaceError("Số dư không đủ — vui lòng nạp tiền vào ví.");
      } else {
        setPlaceError(e instanceof Error ? e.message : "Đặt hàng thất bại");
      }
    } finally {
      setPlacing(false);
    }
  };

  // Khung phiếu dựng ngay từ frame đầu, chỉ RUỘT là skeleton: trước 30/07 hai
  // nhánh này trả về Spinner/đoạn text trần, nên cột phải trống trơn vài giây
  // rồi phiếu bung ra — nội dung bên cạnh nhảy theo. Giữ nguyên vỏ thì trang
  // đứng yên, buyer thấy ngay "đây là chỗ đặt hàng, đang tải".
  if (loadingOptions) {
    return (
      <FormShell title="Cấu hình đơn hàng">
        <div className="space-y-3.5" aria-busy="true" aria-label="Đang tải tuỳ chọn">
          <div className="h-3 w-24 rounded bg-line/70 animate-shimmer" />
          <div className="h-9 w-full rounded-lg bg-line/60 animate-shimmer" />
          <div className="h-3 w-20 rounded bg-line/70 animate-shimmer" />
          <div className="h-9 w-full rounded-lg bg-line/60 animate-shimmer" />
          <div className="h-10 w-full rounded-lg bg-line/60 animate-shimmer" />
        </div>
      </FormShell>
    );
  }
  if (optionsError) {
    return (
      <FormShell title="Cấu hình đơn hàng">
        <Banner tone="bad" icon={<Info size={15} />} title="Chưa tải được tuỳ chọn">
          {optionsError}
        </Banner>
      </FormShell>
    );
  }
  if (!options) return null;

  const hasDiscount = calc && calc.discount_pct != null && calc.discount_pct > 0;
  const displayAmount = calc?.amount ?? 0;

  // Một số strategy (vd "config") khai báo sẵn field "quantity" trong
  // options.fields để giữ tương thích với các nơi khác dùng chung schema này
  // — nhưng form này luôn tự vẽ riêng 1 ô "Số lượng" (stepper bên dưới) và
  // đè giá trị đó lên trước mỗi lần tính giá/đặt hàng (xem doCalculate,
  // confirmBuy). Lọc field trùng ra khỏi phần render để buyer không thấy 2 ô
  // số lượng cùng lúc. Với DProxy, "package_size" cũng là một ô số lượng
  // trá hình (CreditPricing._subtotal đọc đúng field này) — ẩn luôn, số
  // lượng luôn là 1 và không hiển thị cho buyer chỉnh.
  const visibleFields = options.fields.filter(
    (f) => f.field !== "quantity" && !(isDproxy && f.field === "package_size"),
  );

  return (
    <>
      <Card className="overflow-hidden shadow-card-lg">
        <div className="px-5 h-11 flex items-center justify-between bg-ink-panel dotgrid-dark">
          <span className="text-[12.5px] font-semibold tracking-wide text-white/95">{isAutoDelivered ? "Mua proxy" : "Cấu hình đơn hàng"}</span>
          {isAutoDelivered ? (
            <div className="flex items-center gap-1.5">
              <Tag tone="good">Giao tự động</Tag>
              {/* "Đổi IP" CHỈ đúng với DProxy — proxy tĩnh TopProxy không có
                  rotate, hứa ở đây là hứa suông ngay trên nút mua. */}
              {isDproxy && <Tag tone="iris">Có thể đổi IP</Tag>}
            </div>
          ) : null}
        </div>

        <div className="p-5 space-y-4">
          {!options.ready && (
            <Banner tone="warn" icon={<Info size={15} />} title="Sản phẩm chưa sẵn sàng bán">
              {options.not_ready_reason ?? "Người bán chưa hoàn tất thiết lập sản phẩm này — vui lòng quay lại sau."}
            </Banner>
          )}

          {/* Dynamic fields */}
          {visibleFields.map((f) => (
            <DynamicField key={f.field} field={f} value={config[f.field]} onChange={(v) => updateField(f.field, v)} />
          ))}

          {/* Quantity — ẩn với strategy "task" (tự đếm theo URL), "credit"
              (package_size ở trên đã là số lượng thật) và với DProxy/auto_proxy
              (luôn đúng 1 proxy/đơn, không cho chọn). */}
          {options.strategy !== "task" && !isSingleUnit && !isCredit && (
          <div>
            <div className="text-[11px] text-faint uppercase tracking-wider mb-1.5">Số lượng</div>
            <div className="flex items-center border border-line rounded-lg overflow-hidden w-fit">
              <button
                onClick={() => setQty(Math.max(1, qty - 1))}
                className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="h-9 w-12 text-center font-mono text-[13px] font-medium border-x border-line bg-surface"
              />
              <button
                onClick={() => setQty(qty + 1)}
                className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
              >
                +
              </button>
            </div>
          </div>
          )}
          {isSingleUnit && (
            <p className="text-[12px] text-muted">Mỗi đơn nhận 1 proxy riêng.</p>
          )}

          {/* Price display */}
          <div className="border-t border-line pt-4 flex items-end justify-between">
            <span className="text-[12px] text-muted">Tổng cộng</span>
            <div className="text-right">
              {calculating ? (
                <span className="text-[13px] text-muted">Đang tính...</span>
              ) : calc ? (
                <div>
                  {hasDiscount && calc.original_amount != null && (
                    <div className="flex items-center gap-2 justify-end mb-0.5">
                      <span className="text-[13px] text-faint line-through">{vnd(calc.original_amount)}</span>
                      <Tag tone="good">-{Math.round((calc.discount_pct ?? 0) * 100)}%</Tag>
                    </div>
                  )}
                  <span className="font-mono text-[22px] font-bold tabular text-iris-hi">{vnd(displayAmount)}</span>
                </div>
              ) : (
                <span className="text-[13px] text-faint">—</span>
              )}
            </div>
          </div>

          {calcError && <p className="text-bad text-[12.5px]">{calcError}</p>}
          {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}

          <Button size="lg" block disabled={!options.ready || placing || !calc || calculating} onClick={handleSubmit}>
            {placing ? "Đang xử lý…"
              : !account ? "Đăng nhập để mua"
              : !options.ready ? "Chưa thể đặt hàng"
              : isAutoDelivered && calc ? `Mua 1 proxy — ${vnd(displayAmount)}`
              : "Đặt hàng"}
          </Button>

          <p className="text-[11.5px] text-faint leading-relaxed text-center">
            <Shield size={11} className="inline -mt-0.5 mr-0.5 text-good" />
            Ký quỹ {product.escrow_days} ngày · Tiền chỉ chuyển khi bạn xác nhận
          </p>
        </div>
      </Card>

      {/* Confirmation modal */}
      {showConfirm && calc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-[400px] mx-4 bg-surface border border-line rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-line">
              <span className="text-[14px] font-semibold">Xác nhận đơn hàng</span>
            </div>
            <div className="p-5 space-y-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted">Sản phẩm</span>
                <span className="font-medium text-right max-w-[220px] truncate">{product.title}</span>
              </div>
              {isAutoDelivered ? (
                <>
                  {/* strategy "config" (Loại proxy/Nhà mạng/Thời hạn) — buyer
                      thật sự chọn được, khác với "credit" (không có field
                      nào ngoài số lượng luôn = 1). Hiện đúng lựa chọn của họ
                      trước khi hiện các dòng mô tả giao hàng cố định bên
                      dưới. */}
                  {options.strategy === "config" && visibleFields.map((f) => {
                    const val = config[f.field];
                    let display = String(val ?? "—");
                    if (f.choices) {
                      const choice = f.choices.find((c) => String(c.value) === String(val));
                      if (choice) display = choice.label;
                    }
                    return (
                      <div key={f.field} className="flex justify-between">
                        <span className="text-muted">{f.label}</span>
                        <span className="font-medium">{display}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between">
                    <span className="text-muted">Số lượng</span>
                    <span className="font-medium">1 proxy riêng</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Giao hàng</span>
                    <span className="font-medium">Tự động, trong vài giây</span>
                  </div>
                  {isDproxy && (
                    <div className="flex justify-between">
                      <span className="text-muted">Đổi IP</span>
                      <span className="font-medium">Có hỗ trợ</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">Xem thông tin proxy</span>
                    <span className="font-medium">Trang Đơn hàng, sau khi giao</span>
                  </div>
                </>
              ) : (
                <>
                  {/* Show user config summary */}
                  {visibleFields.map((f) => {
                    const val = config[f.field];
                    let display = String(val ?? "—");
                    if (f.choices) {
                      const choice = f.choices.find((c) => String(c.value) === String(val));
                      if (choice) display = choice.label;
                    }
                    return (
                      <div key={f.field} className="flex justify-between">
                        <span className="text-muted">{f.label}</span>
                        <span className="font-medium">{display}</span>
                      </div>
                    );
                  })}
                  {options.strategy !== "task" && !isCredit && (
                    <div className="flex justify-between">
                      <span className="text-muted">Số lượng</span>
                      <span className="font-medium">{qty}</span>
                    </div>
                  )}
                </>
              )}
              {hasDiscount && calc.original_amount != null && (
                <div className="flex justify-between">
                  <span className="text-muted">Giá gốc</span>
                  <span className="text-faint line-through">{vnd(calc.original_amount)}</span>
                </div>
              )}
              {hasDiscount && (
                <div className="flex justify-between">
                  <span className="text-muted">Giảm giá</span>
                  <Tag tone="good">-{Math.round((calc.discount_pct ?? 0) * 100)}%</Tag>
                </div>
              )}
              <div className="border-t border-line pt-3 flex justify-between items-end">
                <span className="text-muted">Tổng cộng</span>
                <span className="font-mono text-[18px] font-bold tabular text-iris-hi">{vnd(displayAmount)}</span>
              </div>
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-good/5 border border-good/15 text-[12px] text-muted">
                <Shield size={13} className="text-good mt-0.5 shrink-0" />
                <span>Ký quỹ {product.escrow_days} ngày — tiền chỉ chuyển cho người bán khi bạn xác nhận hài lòng.</span>
              </div>
              {isAutoDelivered && (
                <p className="text-[11.5px] text-faint">Nếu cấp phát thất bại, tiền được tự động hoàn lại vào ví của bạn.</p>
              )}
              {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-line">
              <Button variant="secondary" block onClick={() => { setShowConfirm(false); setPlaceError(null); }} disabled={placing}>
                Huỷ
              </Button>
              <Button block disabled={placing} onClick={confirmBuy}>
                {placing ? "Đang xử lý…" : "Xác nhận mua"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================
   Dynamic field renderer
   ================================================================ */

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: PricingField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <div className="text-[11px] text-faint uppercase tracking-wider mb-1.5">
      {field.label}
      {field.required && <span className="text-bad ml-0.5">*</span>}
    </div>
  );

  switch (field.type) {
    case "select":
      return (
        <div>
          {label}
          <Select
            value={String(value ?? "")}
            onChange={(e) => {
              // <select> chỉ trả string qua e.target.value dù option.value gốc
              // là số (vd package_size) — backend validate isinstance(x, int),
              // gửi thẳng string xuống là "Cấu hình không hợp lệ" ngay khi đổi
              // lựa chọn. Tra lại giá trị gốc trong choices để giữ đúng kiểu.
              const choice = field.choices?.find((c) => String(c.value) === e.target.value);
              onChange(choice ? choice.value : e.target.value);
            }}
          >
            {field.choices?.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
      );

    case "radio":
      return (
        <div>
          {label}
          <div className="space-y-1.5">
            {field.choices?.map((c) => {
              const active = String(value) === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => onChange(c.value)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left text-[13px] transition-all ${
                    active
                      ? "border-iris bg-iris/4 shadow-[inset_3px_0_0_var(--color-iris)]"
                      : "border-line bg-surface hover:border-line-2"
                  }`}
                >
                  <span
                    className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      active ? "border-iris" : "border-line-2"
                    }`}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-iris" />}
                  </span>
                  <span className="font-medium">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      );

    case "number":
    case "slider":
      return (
        <div>
          {label}
          <Input
            type="number"
            min={field.min}
            max={field.max}
            value={String(value ?? "")}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {field.min != null && field.max != null && (
            <span className="text-[11px] text-faint mt-1 block">
              {field.min} — {field.max}
            </span>
          )}
        </div>
      );

    case "textarea":
      return (
        <div>
          {label}
          <Textarea
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
          />
        </div>
      );

    default:
      return null;
  }
}
