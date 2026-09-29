"use client";

import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMoney } from "@/lib/money";
import { FrozenNotice, useFlowFrozen } from "@/features/site-status";
import { productPath } from "@/lib/routes";
import { useAuth } from "@/lib/auth";
import { useVariantTerm } from "@/lib/variant-term";
import { cn } from "@/lib/cn";
import type { ProductDetail } from "@/lib/types";
import { Button, Card, Tag } from "@/components/ui";
import { EscrowHelp } from "@/components/products/EscrowHelp";
import { Bolt, Clock, Shield, Wallet } from "@/components/Icons";
import {
  alternativePackages, ctaState, maxQtyFor, minQtyFor, outOfStock, panelMode, perOrderBounds, purchasable,
} from "./purchase";
import {
  ConfirmProduct, MoneyTimeline, PromoCodeField, PurchaseSteps, WalletShortfall, usePromoCode, walletShortfall,
} from "@/features/checkout";
import { useWalletBalance } from "@/hooks/use-wallet";
import type { PurchaseState } from "./usePurchase";
import OrderResult from "./OrderResult";

export function PanelShell({ title, aside, children }: {
  title: string; aside?: ReactNode; children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden shadow-card-lg">
      <div className="flex items-center justify-between px-5 h-11 bg-ink-panel dotgrid-dark">
        <span className="text-[12.5px] font-semibold tracking-wide text-white/95">{title}</span>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export default function OrderPanel({ product, purchase, fulfillment }: {
  product: ProductDetail;
  purchase: PurchaseState;
  fulfillment?: string | null;
}) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatCheckoutMoney } = useMoney();
  const router = useRouter();
  const { account } = useAuth();
  const term = useVariantTerm(product.service_type);
  const { selected, qty, total, order, placing, placeError, notice, showConfirm } = purchase;
  const ordersFrozen = useFlowFrozen("orders");
  // Balance is only read once the buyer opens the confirmation (the header
  // chip shares the same cached query, so this is usually instant).
  const wallet = useWalletBalance(!!account && showConfirm);
  const available = wallet.data?.available_balance ?? null;
  // Priced for exactly this package and quantity; any change drops the code.
  const promo = usePromoCode(showConfirm && selected
    ? { variant_id: selected.id, quantity: qty, expected_unit_price: selected.price }
    : null);
  const payable = promo.payable(total);
  const shortfall = walletShortfall(payable, available);
  const closeConfirm = () => { promo.reset(); purchase.closeConfirm(); };
  const alternatives = alternativePackages(product.variants, selected?.id ?? null);

  const instant = selected?.delivery_mode === "instant";
  const contact = panelMode(selected) === "contact";
  const maxQty = maxQtyFor(selected);
  const minQty = minQtyFor(selected);
  const bounds = perOrderBounds(selected);
  const cta = ctaState({ loggedIn: !!account, placing, selected });
  const showOosHint = !!account && !!selected && outOfStock(selected);

  const onCtaClick = () => {
    if (cta.intent === "login") router.push(`/login?next=${encodeURIComponent(productPath(product))}`);
    else if (cta.intent === "confirm") purchase.openConfirm();
  };

  return (
    <>
      <PanelShell
        title={t("orderPanel")}
        aside={selected && !order ? (
          <Tag tone={instant ? "good" : "warn"}>
            {instant
              ? <><Bolt size={10} /> {t("instantDelivery")}</>
              : <><Clock size={10} /> {t("deliverInHours", { hours: selected.sla_hours })}</>}
          </Tag>
        ) : undefined}
      >
        {order ? <OrderResult order={order} onRebuy={purchase.rebuy} fulfillment={fulfillment} deliveryMode={selected?.delivery_mode} slaHours={selected?.sla_hours} inspectionSteps={product.inspection_steps} /> : (
          <div className="space-y-4">
            <fieldset>
              <legend className="text-[11px] font-semibold text-faint uppercase tracking-wider mb-2">
                {t("choosePackage", { count: product.variants.length, ...term })}
              </legend>
              <div role="radiogroup" className="space-y-1.5 max-h-[304px] overflow-y-auto overscroll-contain pr-0.5">
                {product.variants.map((v) => {
                  const on = selected?.id === v.id;
                  const oos = outOfStock(v);
                  return (
                    <button
                      key={v.id}
                      role="radio"
                      aria-checked={on}
                      disabled={oos}
                      onClick={() => purchase.pickVariant(v)}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                        on
                          ? "border-iris ring-1 ring-iris bg-iris/4"
                          : "border-line bg-surface hover:border-line-2",
                        oos && "opacity-55",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-snug">{v.name}</span>
                        <span className="mt-1 flex items-center gap-2 text-[11px] leading-none">
                          {v.delivery_mode === "instant" ? (
                            oos
                              ? <span className="text-bad font-medium">{t("outOfStock")}</span>
                              : <span className={cn("flex items-center gap-1", v.stock_state === "low" ? "text-warn" : "text-good")}>
                                  <Bolt size={10} />
                                  {v.stock_count != null
                                    ? t("instantStock", { count: v.stock_count.toLocaleString(locale) })
                                    : v.stock_state === "low" ? t("instantLow") : t("instantReady")}
                                </span>
                          ) : (
                            <span className="flex items-center gap-1 text-warn"><Clock size={10} /> {t("deliverInHours", { hours: v.sla_hours })}</span>
                          )}
                        </span>
                      </span>
                      <span className="font-mono text-[13px] font-semibold tabular shrink-0">
                        {v.price > 0 ? formatCheckoutMoney(v.price, { locale }) : t("contact")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {contact ? (
              <p className="border-t border-line pt-3.5 text-[12.5px] text-muted leading-relaxed">
                {t("contactBlurb")}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between border-t border-line pt-3.5">
                  <span className="text-[12.5px] text-muted">{t("quantity")}</span>
                  <div className="flex items-center border border-line rounded-lg overflow-hidden">
                    <button
                      aria-label={t("decreaseQty")}
                      onClick={() => purchase.setQty(qty - 1)}
                      disabled={qty <= minQty}
                      className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    >−</button>
                    <input
                      type="number" min={minQty} max={maxQty} value={qty} aria-label={t("quantity")}
                      onChange={(e) => purchase.setQty(Number(e.target.value) || minQty)}
                      className="h-9 w-12 text-center font-mono text-[13px] font-medium border-x border-line bg-surface [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      aria-label={t("increaseQty")}
                      onClick={() => purchase.setQty(qty + 1)}
                      disabled={qty >= maxQty}
                      className="h-9 w-9 grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    >+</button>
                  </div>
                </div>

                {bounds && (
                  <p className="-mt-2 text-right text-[11.5px] text-faint">
                    {bounds.max == null
                      ? t("perOrderMin", { min: bounds.min })
                      : bounds.min > 1
                        ? t("perOrderRange", { min: bounds.min, max: bounds.max })
                        : t("perOrderMax", { max: bounds.max })}
                  </p>
                )}

                <div className="flex items-end justify-between border-t border-line pt-3.5">
                  <div>
                    <div className="text-[12.5px] text-muted">{t("total")}</div>
                    {qty > 1 && selected && (
                      <div className="text-[11px] text-faint mt-1">
                        {t("checkoutUnitsHint", { count: qty })}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-[24px] leading-none font-bold tabular text-iris-hi">
                    {formatCheckoutMoney(total, { locale })}
                  </span>
                </div>

                {placeError && <p className="text-bad text-[12.5px]" role="alert">{placeError}</p>}
                <FrozenNotice flow="orders" />

                <Button size="lg" block disabled={cta.disabled || ordersFrozen} onClick={onCtaClick}>
                  {t(cta.labelKey)}
                </Button>
                {showOosHint && (
                  <p className="text-[11.5px] text-faint text-center -mt-1.5">
                    {t("oosHint", { ...term })}
                  </p>
                )}
              </>
            )}

            <p className="text-[11.5px] text-faint leading-relaxed text-center">
              <Shield size={11} className="inline -mt-0.5 mr-0.5 text-good" />
              {t("escrowNote", { days: product.escrow_days })} <EscrowHelp days={product.escrow_days} className="align-middle" />
            </p>
          </div>
        )}
      </PanelShell>

      {/* Portalled: the sticky order column is its own stacking context, so
          an inline overlay would sit under the page's sticky section tabs. */}
      {showConfirm && selected && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={closeConfirm}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            role="dialog" aria-modal="true" aria-label={t("confirmTitle")}
            className="relative w-full max-w-[400px] mx-4 bg-surface border border-line rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3 px-5 py-3 border-b border-line">
              <span className="text-[14px] font-semibold">{t("confirmTitle")}</span>
              <PurchaseSteps current={2} />
            </div>
            <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-5 space-y-3 text-[13px]">
              {notice?.kind === "price" && (
                <div role="alert" className="rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5 text-[12.5px]">
                  <p className="font-medium text-fg">
                    {t("priceChanged", { old: formatCheckoutMoney(notice.oldPrice, { locale }), now: formatCheckoutMoney(selected.price, { locale }) })}
                  </p>
                  <p className="mt-0.5 text-muted">{t("priceChangedBody")}</p>
                </div>
              )}
              {notice?.kind === "soldOut" && (
                <div role="alert" className="rounded-md border border-bad/25 bg-bad-soft px-3 py-2.5 text-[12.5px]">
                  <p className="font-medium text-fg">{t("soldOutTitle", { name: selected.name })}</p>
                  {alternatives.length > 0 ? (
                    <>
                      <p className="mt-0.5 text-muted">{t("soldOutPick", { ...term })}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {alternatives.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => purchase.pickVariant(v)}
                            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[12px] hover:border-iris/50"
                          >
                            <span className="block font-medium text-fg">{v.name}</span>
                            <span className="font-mono text-[11.5px] text-muted">{formatCheckoutMoney(v.price, { locale })}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="mt-0.5 text-muted">{t("soldOutNone")}</p>
                  )}
                </div>
              )}
              <ConfirmProduct product={product} />
              <div className="flex justify-between gap-3 border-t border-line pt-3">
                <span className="text-muted">{t("confirmPackage", { ...term })}</span>
                <span className="font-medium">{selected.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t("confirmQty")}</span>
                <span className="font-medium">{qty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t("confirmUnitPrice")}</span>
                <span className="font-medium">{formatCheckoutMoney(selected.price, { locale })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t("confirmDelivery")}</span>
                <span className="font-medium">
                  {instant ? t("deliveryInstantAuto") : t("deliveryManualHours", { hours: selected.sla_hours })}
                </span>
              </div>
              <PromoCodeField promo={promo} disabled={placing} />
              <div className="border-t border-line pt-3 flex justify-between items-end">
                <span className="text-muted">{t("total")}</span>
                <span className="flex items-baseline gap-2">
                  {payable !== total && (
                    <span className="font-mono text-[12.5px] text-faint line-through tabular">{formatCheckoutMoney(total, { locale })}</span>
                  )}
                  <span className="font-mono text-[18px] font-bold tabular text-iris-hi">
                    {formatCheckoutMoney(payable, { locale })}
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1.5 text-muted"><Wallet size={13} /> {t("walletBalance")}</span>
                <span className="font-mono font-medium tabular">
                  {available == null ? "—" : formatCheckoutMoney(available, { locale })}
                </span>
              </div>
              {shortfall > 0 ? (
                <WalletShortfall shortfall={shortfall} returnPath={productPath(product)} />
              ) : (
                <MoneyTimeline instant={instant} slaHours={selected.sla_hours ?? 24} escrowDays={product.escrow_days} />
              )}
              {placeError && <p role="alert" className="text-bad text-[12.5px]">{placeError}</p>}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-line">
              <Button variant="secondary" block onClick={closeConfirm} disabled={placing}>{tc("cancel")}</Button>
              <Button block disabled={placing || promo.checking || shortfall > 0 || !purchasable(selected)} loading={placing} onClick={() => purchase.buy(promo.code)}>
                {placing ? t("processing") : notice?.kind === "price" ? t("confirmBuyAgain") : t("confirmBuyTotal", { amount: formatCheckoutMoney(payable, { locale }) })}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
