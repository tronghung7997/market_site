"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import type { CalculateResult, Order, PricingField, PricingOptions, ProductDetail } from "@/lib/types";
import { Banner, Button, Card, Input, Select, Tag, Textarea } from "@/components/ui";
import { EscrowHelp } from "@/components/products/EscrowHelp";
import { Info, Shield, Wallet } from "@/components/Icons";
import {
  ConfirmProduct, MoneyTimeline, PromoCodeField, PurchaseSteps, WalletShortfall, usePromoCode, walletShortfall,
} from "@/features/checkout";
import { useWalletBalance } from "@/hooks/use-wallet";
import { cn } from "@/lib/cn";
import { clampQuantity, orderConfig, orderQuantity, quantityControl } from "./dynamic-order-quantity";

interface Props {
  productId: number;
  product: ProductDetail;
  onOrderCreated: (order: Order) => void;
  /** The live total (null while unpriced), for the mobile buy bar. */
  onTotalChange?: (amount: number | null) => void;
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

export default function DynamicOrderForm({ productId, product, onOrderCreated, onTotalChange }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { account } = useAuth();
  const locale = useLocale();
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const { formatCheckoutMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();

  const [options, setOptions] = useState<PricingOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [qty, setQty] = useState(1);
  const qtyLabelId = useId();

  const [calc, setCalc] = useState<CalculateResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  // Read once the buyer opens the confirmation (the header chip shares the cache).
  const wallet = useWalletBalance(!!account && showConfirm);

  useEffect(() => {
    if (!showConfirm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !placing) { setShowConfirm(false); setPlaceError(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showConfirm, placing]);

  // Fetch pricing options on mount.
  //
  // Effect này có thể chạy nhiều lần cho cùng một productId: StrictMode ở
  // dev gọi 2 lần, và ở prod `t`/`apiErrorMessage` đổi identity khi
  // IntlProvider re-render (vd sau khi /me về). Trước 14/09 mỗi lần chạy lại
  // là `setConfig(defaults)` — response về SAU khi buyer đã chọn gói thì đè
  // lựa chọn về gói mặc định, buyer bấm mua và trả tiền cho gói khác (quan
  // sát thực tế: đơn #148 chọn VN 7 ngày, đặt thành US 30 ngày). Hai lớp
  // chặn: response cũ/của effect đã cleanup bị bỏ, và default chỉ điền vào
  // field CHƯA có giá trị — không bao giờ ghi đè thứ buyer đã chọn.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opts = await api.pricingOptions(productId);
        if (cancelled) return;
        setOptions(opts);
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
        setConfig((prev) => {
          const next = { ...prev };
          for (const [field, value] of Object.entries(defaults)) {
            if (next[field] == null || next[field] === "") next[field] = value;
          }
          return next;
        });
      } catch (e) {
        if (cancelled) return;
        setOptionsError(apiErrorMessage(e, t("optionsLoadFailed")));
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiErrorMessage, productId, t]);

  // Debounced calculate on config/qty change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "auto_proxy" là nhãn public của mọi adapter proxy giao tự động (backend
  // che tên nguồn thật — xem _PUBLIC_ADAPTER_ALIASES, src/pricing/router.py).
  // Strategy phân biệt hai kiểu bán: `credit` = cấp từ kho proxy có sẵn (luôn
  // đổi IP được, đúng 1 proxy/đơn, package_size ép 1), `config` = mua theo
  // gói — mua được nhiều proxy một đơn khi pricing-options báo
  // `max_quantity` > 1 (mỗi proxy một dòng #NN, hiện riêng trong /proxies).
  // Luật số lượng nằm ở dynamic-order-quantity.ts (có test).
  const isAutoProxy = options?.adapter_type === "auto_proxy";
  const isPoolProxy = isAutoProxy && options?.strategy === "credit";
  const isPlanProxy = isAutoProxy && options?.strategy === "config";
  const isSingleUnit = isAutoProxy;
  const qtyControl = options ? quantityControl(options) : ({ kind: "single" } as const);
  // Với strategy "credit" (mua gói request), "package_size" TỰ NÓ đã là số
  // lượng thật (đã chọn trong DynamicField ở trên) — backend chỉ cấp phát
  // đúng bằng package_size và bỏ qua hoàn toàn quantity riêng
  // (pricing/credit.py::CreditPricing chỉ khai field "package_size", không có
  // "quantity"). Stepper "Số lượng" bên dưới trước đây vẫn hiện cho strategy
  // này dù không ảnh hưởng giá lẫn số request nhận được — thuần cosmetic,
  // gây hiểu lầm buyer mua được "2 x gói". Ẩn nó đi, giống cách đã ẩn với
  // task/isSingleUnit.
  const isCredit = options?.strategy === "credit";
  // Phần TRẤN AN + nhãn thân thiện dưới đây áp cho mọi đơn giao tự động
  // (`isSingleUnit`), không riêng một nguồn nào.
  const isAutoDelivered = isSingleUnit;
  // Số lượng thật gửi đi (stepper đã kẹp 1…max; single/none luôn 1).
  const orderQty = orderQuantity(qtyControl, qty);

  // Mỗi lượt tính giá mang một số thứ tự; chỉ lượt MỚI NHẤT được ghi kết quả.
  // Không có guard này, buyer đổi gói 2 lần nhanh → response của gói cũ về
  // sau → nút mua hiện giá gói cũ (backend vẫn tính đúng theo config, nhưng
  // buyer nhìn sai giá tới lúc bấm).
  const calcSeqRef = useRef(0);
  const doCalculate = useCallback(async (cfg: Record<string, unknown>, q: number) => {
    if (!options || !options.ready || options.fields.length === 0) return;
    const seq = ++calcSeqRef.current;
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
      const result = await api.calculatePrice(productId, orderConfig(cfg, options, orderQuantity(quantityControl(options), q)));
      if (seq !== calcSeqRef.current) return;
      setCalc(result);
      setCalcError(null);
    } catch (e) {
      if (seq !== calcSeqRef.current) return;
      // Đây mới là lỗi thật (field đã điền nhưng backend từ chối) — trước đây
      // bị nuốt hoàn toàn, giá cứ đứng ở "—" mãi mà buyer không hiểu vì sao.
      setCalc(null);
      setCalcError(apiErrorMessage(e, t("priceCalcFailed")));
    } finally {
      if (seq === calcSeqRef.current) setCalculating(false);
    }
  }, [apiErrorMessage, productId, options, t, locale]);

  useEffect(() => {
    onTotalChange?.(calc && !calculating ? calc.amount : null);
  }, [calc, calculating, onTotalChange]);

  useEffect(() => {
    if (!options) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doCalculate(config, qty), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [config, qty, doCalculate, options]);

  const updateField = (field: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  // The exact body POST /orders receives; a promo quote holds only for it.
  const finalConfig = options ? orderConfig(config, options, orderQty) : config;
  const promo = usePromoCode(showConfirm && calc
    ? { product_id: productId, user_config: finalConfig, quantity: orderQty }
    : null);
  const closeConfirm = () => { setShowConfirm(false); setPlaceError(null); promo.reset(); };

  const handleSubmit = async () => {
    // Come back to this (canonical, id-free) product page after login.
    if (!account) { router.push(`/login?next=${encodeURIComponent(pathname)}`); return; }
    setShowConfirm(true);
  };

  const confirmBuy = async () => {
    setPlacing(true);
    setPlaceError(null);
    try {
      const order = await api.createOrderWithConfig(productId, finalConfig, orderQty, promo.code);
      setShowConfirm(false);
      promo.reset();
      onOrderCreated(order);
    } catch (e) {
      setPlaceError(apiErrorMessage(e, t("placeFailed")));
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
      <FormShell title={t("configureOrder")}>
        <div className="space-y-3.5" aria-busy="true" aria-label={t("loadingOptionsAria")}>
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
      <FormShell title={t("configureOrder")}>
        <Banner tone="bad" icon={<Info size={15} />} title={t("optionsLoadFailed")}>
          {optionsError}
        </Banner>
      </FormShell>
    );
  }
  if (!options) return null;

  const hasDiscount = calc && calc.discount_pct != null && calc.discount_pct > 0;
  const displayAmount = calc?.amount ?? 0;
  const payable = promo.payable(displayAmount);
  const available = wallet.data?.available_balance ?? null;
  const shortfall = walletShortfall(payable, available);

  // Một số strategy (vd "config") khai báo sẵn field "quantity" trong
  // options.fields để giữ tương thích với các nơi khác dùng chung schema này
  // — nhưng form này luôn tự vẽ riêng 1 ô "Số lượng" (stepper bên dưới) và
  // đè giá trị đó lên trước mỗi lần tính giá/đặt hàng (xem doCalculate,
  // confirmBuy). Lọc field trùng ra khỏi phần render để buyer không thấy 2 ô
  // số lượng cùng lúc. Với DProxy, "package_size" cũng là một ô số lượng
  // trá hình (CreditPricing._subtotal đọc đúng field này) — ẩn luôn, số
  // lượng luôn là 1 và không hiển thị cho buyer chỉnh.
  const visibleFields = options.fields.filter(
    (f) => f.field !== "quantity" && !(isPoolProxy && f.field === "package_size"),
  );

  return (
    <>
      <Card className="overflow-hidden shadow-card-lg">
        <div className="px-5 h-11 flex items-center justify-between bg-ink-panel dotgrid-dark">
          <span className="text-[12.5px] font-semibold tracking-wide text-white/95">
            {options.strategy === "credit" ? t("buyApiAccess") : options.strategy === "task" ? t("submitTaskOrder") : isAutoDelivered ? t("buyProxy") : t("configureOrder")}
          </span>
          <div className="flex items-center gap-1.5">
            {options.strategy === "credit" && <Tag tone="iris">{t("fulfillment.api")}</Tag>}
            {options.strategy === "task" && <Tag tone="warn">{t("fulfillment.task")}</Tag>}
            {isAutoDelivered && <Tag tone="good">{t("autoDelivered")}</Tag>}
            {isPoolProxy && <Tag tone="iris">{t("ipRotatable")}</Tag>}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {!options.ready && (
            <Banner tone="warn" icon={<Info size={15} />} title={t("notReadyTitle")}>
              {options.not_ready_reason ?? t("notReadyDefault")}
            </Banner>
          )}

          {/* Dynamic fields */}
          {(() => {
            const packageField = visibleFields.find((f) => f.field === "plan_key");
            const packageOnly = Boolean(packageField);
            const collapsed = packageOnly
              ? (packageField?.choices?.length ?? 0) <= 1
              : isPlanProxy && visibleFields.length > 0 && visibleFields.every((f) => (f.choices?.length ?? 0) <= 1);
            if (collapsed) {
              const summaryFields = packageField ? [packageField] : visibleFields;
              return (
            <div className="rounded-lg border border-line bg-raised/40 px-3 py-3 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-faint">{t("dproxyPackageTitle")}</p>
              <p className="text-[13px] font-medium">
                {summaryFields.map((f) => {
                  const val = config[f.field];
                  const choice = f.choices?.find((c) => String(c.value) === String(val));
                  return choice?.label ?? String(val ?? "—");
                }).join(" · ")}
              </p>
              <p className="text-[12px] text-muted">{t("dproxyPackageHint")}</p>
            </div>
              );
            }
            if (packageField) {
              return (
                <DproxyPackagePicker
                  field={packageField}
                  value={config[packageField.field]}
                  locale={locale}
                  fieldLabels={((options.base_info as Record<string, unknown> | null)?.field_labels as Record<string, string> | undefined) ?? {}}
                  onChange={(next) => updateField(packageField.field, next)}
                />
              );
            }
            const creditPackages = isCredit ? visibleFields.find((f) => f.field === "package_size" && f.choices?.some((c) => c.price != null)) : undefined;
            if (creditPackages) {
              return (
                <CreditPackagePicker
                  field={creditPackages}
                  value={config[creditPackages.field]}
                  onChange={(next) => updateField(creditPackages.field, next)}
                />
              );
            }
            return visibleFields.map((f) => (
            <DynamicField key={f.field} field={f} value={config[f.field]} locale={locale} onChange={(v) => updateField(f.field, v)} />
            ));
          })()}

          {/* Quantity — ẩn (`none`) với strategy "task" (tự đếm theo URL) và
              "credit" (package_size ở trên đã là số lượng thật); proxy kho
              (pool) hoặc backend không báo max_quantity giữ đúng 1 proxy/đơn
              (`single`). Proxy mua theo gói: stepper 1…max_quantity. */}
          {qtyControl.kind === "stepper" && (
          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div id={qtyLabelId} className="text-[11px] text-faint uppercase tracking-wider mb-1.5">{qtyControl.proxy ? t("proxyQuantity") : t("quantity")}</div>
                <div className="flex items-center border border-line rounded-lg overflow-hidden w-fit">
                  <button
                    type="button"
                    aria-label={t("decreaseQty")}
                    onClick={() => setQty(clampQuantity(orderQty - 1, qtyControl.max))}
                    disabled={orderQty <= 1}
                    className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={qtyControl.max}
                    value={orderQty}
                    aria-labelledby={qtyLabelId}
                    onChange={(e) => setQty(clampQuantity(Number(e.target.value) || 1, qtyControl.max))}
                    className="h-9 w-12 text-center font-mono text-[13px] font-medium tabular border-x border-line bg-surface [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    aria-label={t("increaseQty")}
                    onClick={() => setQty(clampQuantity(orderQty + 1, qtyControl.max))}
                    disabled={orderQty >= qtyControl.max}
                    className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>
              {qtyControl.proxy && (
                <span className="pb-2 text-[11.5px] text-faint">{t("perOrderMax", { max: qtyControl.max })}</span>
              )}
            </div>
            {qtyControl.proxy && (
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{t("bulkProxyHint")}</p>
            )}
          </div>
          )}
          {qtyControl.kind === "single" && isSingleUnit && (
            <p className="text-[12px] text-muted">{t("oneProxyPerOrder")}</p>
          )}

          {/* Price display */}
          <div className="border-t border-line pt-4 flex items-end justify-between">
            <span className="text-[12px] text-muted">{t("total")}</span>
            <div className="text-right">
              {calculating ? (
                <span className="text-[13px] text-muted">{t("calculating")}</span>
              ) : calc ? (
                <div>
                  {hasDiscount && calc.original_amount != null && (
                    <div className="flex items-center gap-2 justify-end mb-0.5">
                      <span className="text-[13px] text-faint line-through">{formatCheckoutMoney(calc.original_amount, { locale })}</span>
                      <Tag tone="good">-{Math.round((calc.discount_pct ?? 0) * 100)}%</Tag>
                    </div>
                  )}
                  <span className="font-mono text-[22px] font-bold tabular text-iris-hi">{formatCheckoutMoney(displayAmount, { locale })}</span>
                </div>
              ) : (
                <span className="text-[13px] text-faint">—</span>
              )}
            </div>
          </div>

          {calcError && <p className="text-bad text-[12.5px]">{calcError}</p>}
          {placeError && <p className="text-bad text-[12.5px]">{placeError}</p>}

          <Button size="lg" block disabled={!options.ready || placing || !calc || calculating} onClick={handleSubmit}>
            {placing ? t("processing")
              : !account ? t("loginToBuy")
              : !options.ready ? t("cannotOrder")
              : isAutoDelivered && calc ? t("buyProxies", { count: orderQty, amount: formatCheckoutMoney(displayAmount, { locale }) })
              : t("placeOrder")}
          </Button>

          <p className="text-[11.5px] text-faint leading-relaxed text-center">
            <Shield size={11} className="inline -mt-0.5 mr-0.5 text-good" />
            {t("escrowNote", { days: product.escrow_days })} <EscrowHelp days={product.escrow_days} className="align-middle" />
          </p>
        </div>
      </Card>

      {/* Portalled: the sticky order column is its own stacking context, so an
          inline overlay would sit under the page's sticky section tabs. */}
      {showConfirm && calc && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { if (!placing) closeConfirm(); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            role="dialog" aria-modal="true" aria-label={t("confirmTitle")}
            className="relative w-full max-w-[420px] mx-4 bg-surface border border-line rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3 px-5 py-3 border-b border-line">
              <span className="text-[14px] font-semibold">{t("confirmTitle")}</span>
              <PurchaseSteps current={2} />
            </div>
            <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-5 space-y-3 text-[13px]">
              <ConfirmProduct product={product} />
              <div className="space-y-3 border-t border-line pt-3">
                {(isAutoDelivered ? (options.strategy === "config" ? visibleFields : []) : visibleFields).map((f) => {
                  const val = config[f.field];
                  let display = String(val ?? "—");
                  if (f.choices) {
                    const choice = f.choices.find((c) => String(c.value) === String(val));
                    if (choice) display = choice.label;
                  }
                  return (
                    <div key={f.field} className="flex justify-between gap-3">
                      <span className="text-muted">{locale === "en" && t.has(`fields.${f.field}`) ? t(`fields.${f.field}`) : f.label}</span>
                      <span className="font-medium text-right break-words min-w-0">{display}</span>
                    </div>
                  );
                })}
                {isAutoDelivered ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t("confirmQty")}</span>
                    <span className="font-medium">{t("dedicatedProxies", { count: orderQty })}</span>
                  </div>
                ) : qtyControl.kind === "stepper" && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t("confirmQty")}</span>
                    <span className="font-medium tabular">{orderQty}</span>
                  </div>
                )}
                {isPoolProxy && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t("ipRotation")}</span>
                    <span className="font-medium">{t("supported")}</span>
                  </div>
                )}
                {isAutoDelivered && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t("viewProxyDetails")}</span>
                    <span className="font-medium text-right">{t("proxyDetailsWhere")}</span>
                  </div>
                )}
                {hasDiscount && calc.original_amount != null && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t("originalPrice")}</span>
                    <span className="text-faint line-through">{formatCheckoutMoney(calc.original_amount, { locale })}</span>
                  </div>
                )}
                {hasDiscount && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t("discount")}</span>
                    <Tag tone="good">-{Math.round((calc.discount_pct ?? 0) * 100)}%</Tag>
                  </div>
                )}
              </div>
              <PromoCodeField promo={promo} disabled={placing} />
              <div className="border-t border-line pt-3 flex justify-between items-end">
                <span className="text-muted">{t("total")}</span>
                <span className="flex items-baseline gap-2">
                  {payable !== displayAmount && (
                    <span className="font-mono text-[12.5px] text-faint line-through tabular">{formatCheckoutMoney(displayAmount, { locale })}</span>
                  )}
                  <span className="font-mono text-[18px] font-bold tabular text-iris-hi">{formatCheckoutMoney(payable, { locale })}</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1.5 text-muted"><Wallet size={13} /> {t("walletBalance")}</span>
                <span className="font-mono font-medium tabular">
                  {available == null ? "—" : formatCheckoutMoney(available, { locale })}
                </span>
              </div>
              {shortfall > 0 ? (
                <WalletShortfall shortfall={shortfall} returnPath={pathname} />
              ) : (
                <MoneyTimeline
                  instant={options.strategy !== "task"}
                  slaHours={24}
                  escrowDays={product.escrow_days}
                  deliverTitle={options.strategy === "credit" ? t("deliveryGatewayKey") : options.strategy === "task" ? t("deliveryTaskResult") : t("deliveryAutoSeconds")}
                />
              )}
              {isAutoDelivered && (
                <p className="text-[11.5px] text-faint">
                  {orderQty > 1 ? t("allocationPartialRefundHint", { count: orderQty }) : t("allocationRefundHint")}
                </p>
              )}
              {placeError && <p role="alert" className="text-bad text-[12.5px]">{placeError}</p>}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-line">
              <Button variant="secondary" block onClick={closeConfirm} disabled={placing}>
                {tc("cancel")}
              </Button>
              <Button block disabled={placing || promo.checking || shortfall > 0} loading={placing} onClick={confirmBuy}>
                {placing ? t("processing") : t("confirmBuyTotal", { amount: formatCheckoutMoney(payable, { locale }) })}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ================================================================
   Dynamic field renderer
   ================================================================ */

interface DproxyPackageChoice {
  value: string;
  type: string;
  network: string;
  days: string;
  typeLabel: string;
  networkLabel: string;
  daysLabel: string;
}

function parseDproxyPackageChoices(field: PricingField): DproxyPackageChoice[] {
  return (field.choices ?? []).flatMap((choice) => {
    const [type, network, days] = String(choice.value).split("|");
    if (!type || !network || !days) return [];
    const labels = choice.label.split(" · ");
    return [{
      value: String(choice.value),
      type,
      network,
      days,
      typeLabel: labels[0] || type,
      networkLabel: labels[1] || network,
      daysLabel: labels[2] || `${days} ngày`,
    }];
  });
}

function uniquePackageOptions(
  items: DproxyPackageChoice[],
  key: "type" | "network" | "days",
  label: "typeLabel" | "networkLabel" | "daysLabel",
) {
  return Array.from(new Map(items.map((item) => [item[key], item[label]])).entries());
}

export function DproxyPackagePicker({
  field,
  value,
  locale,
  fieldLabels,
  onChange,
}: {
  field: PricingField;
  value: unknown;
  locale: string;
  /** Seller's labels (e.g. "Mức chia sẻ"); Vietnamese-only, so EN keeps the defaults. */
  fieldLabels: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const choices = parseDproxyPackageChoices(field);
  const vi = locale !== "en";
  const typeLabel = vi ? fieldLabels.type || "Loại proxy" : "Proxy type";
  const networkLabel = vi ? fieldLabels.network || "Khu vực / mạng" : "Location";
  const selected = choices.find((choice) => choice.value === String(value)) ?? choices[0];
  if (!selected) return null;

  const typeOptions = uniquePackageOptions(choices, "type", "typeLabel");
  const networkChoices = choices.filter((choice) => choice.type === selected.type);
  const networkOptions = uniquePackageOptions(networkChoices, "network", "networkLabel");
  const durationChoices = networkChoices.filter((choice) => choice.network === selected.network);
  const durationOptions = uniquePackageOptions(durationChoices, "days", "daysLabel");

  const selectClosest = (partial: Partial<Pick<DproxyPackageChoice, "type" | "network" | "days">>) => {
    const desired = { type: selected.type, network: selected.network, days: selected.days, ...partial };
    const exact = choices.find((choice) => choice.type === desired.type && choice.network === desired.network && choice.days === desired.days);
    const sameTypeAndNetwork = choices.find((choice) => choice.type === desired.type && choice.network === desired.network);
    const sameType = choices.find((choice) => choice.type === desired.type);
    onChange((exact ?? sameTypeAndNetwork ?? sameType ?? choices[0]).value);
  };

  return (
    <div className="space-y-4" aria-label={locale === "en" ? "Choose proxy package" : "Chọn gói proxy"}>
      <div>
        <p className="text-[15px] font-semibold">{locale === "en" ? "Choose your proxy" : "Chọn gói proxy"}</p>
        <p className="text-[12px] leading-relaxed text-muted mt-1">{locale === "en" ? "Options update automatically so every combination can be delivered." : "Các lựa chọn tự cập nhật để mọi cấu hình đều có thể giao."}</p>
      </div>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface px-3">
        <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 py-3">
          <label htmlFor="dproxy-package-type" className="text-[12px] font-medium text-muted">{typeLabel}</label>
          <Select id="dproxy-package-type" name="dproxy-package-type" value={selected.type} onChange={(event) => selectClosest({ type: event.target.value })}>
            {typeOptions.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 py-3">
          <label htmlFor="dproxy-package-network" className="text-[12px] font-medium leading-snug text-muted">{networkLabel}</label>
          <Select id="dproxy-package-network" name="dproxy-package-network" value={selected.network} onChange={(event) => selectClosest({ network: event.target.value })}>
            {networkOptions.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 py-3">
          <label htmlFor="dproxy-package-days" className="text-[12px] font-medium text-muted">{locale === "en" ? "Duration" : "Thời hạn"}</label>
          <Select id="dproxy-package-days" name="dproxy-package-days" value={selected.days} onChange={(event) => selectClosest({ days: event.target.value })}>
            {durationOptions.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex items-start justify-between gap-4 border-t border-line pt-3">
        <p className="shrink-0 text-[12px] text-muted">{locale === "en" ? "You receive" : "Bạn sẽ nhận"}</p>
        <p className="text-right text-[13px] font-semibold leading-snug">{selected.typeLabel} · {selected.networkLabel} · {selected.daysLabel}</p>
      </div>
    </div>
  );
}

function DynamicField({
  field,
  value,
  locale,
  onChange,
}: {
  field: PricingField;
  value: unknown;
  locale: string;
  onChange: (v: unknown) => void;
}) {
  const t = useTranslations("products");
  const catalogLabel = t.has(`fields.${field.field}`) ? t(`fields.${field.field}`) : null;
  const fieldLabel = locale === "en" ? (catalogLabel ?? field.label) : field.label;
  const label = (
    <div className="text-[11px] text-faint uppercase tracking-wider mb-1.5">
      {fieldLabel}
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


/** Gói request có giá riêng (nguồn API): thẻ chọn thay cho dropdown — thấy
 *  ngay giá mỗi request và gói nào rẻ hơn. */
function CreditPackagePicker({ field, value, onChange }: {
  field: PricingField; value: unknown; onChange: (next: string | number) => void;
}) {
  const t = useTranslations("products");
  const locale = useLocale();
  const { formatCheckoutMoney } = useMoney();
  const choices = field.choices ?? [];
  const maxPer = Math.max(...choices.map((c) => c.per_unit ?? 0));
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">{t("requestPackageLegend")}</legend>
      {choices.map((c) => {
        const on = String(c.value) === String(value);
        const save = c.per_unit && maxPer > 0 ? Math.round((1 - c.per_unit / maxPer) * 100) : 0;
        return (
          <label
            key={String(c.value)}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3.5 py-3 transition-colors",
              on ? "border-iris bg-iris-soft" : "border-line-2 bg-surface hover:border-faint",
            )}
          >
            <input type="radio" name={field.field} className="sr-only" checked={on} onChange={() => onChange(c.value)} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium text-fg">
                {c.label}
                {save >= 5 && <Tag tone="good">{t("packageSaves", { pct: save })}</Tag>}
              </span>
              <span className="block text-[12px] text-muted">
                <span className="whitespace-nowrap">{t("packageRequests", { n: Number(c.value).toLocaleString(locale) })}</span>
                {c.per_unit != null && (
                  <>
                    {" · "}
                    <span className="whitespace-nowrap">{t("packagePerRequest", { price: formatCheckoutMoney(Math.round(c.per_unit), { locale }) })}</span>
                  </>
                )}
              </span>
            </span>
            {c.price != null && <span className="shrink-0 font-mono text-[14px] font-semibold tabular text-fg">{formatCheckoutMoney(c.price, { locale })}</span>}
          </label>
        );
      })}
    </fieldset>
  );
}
