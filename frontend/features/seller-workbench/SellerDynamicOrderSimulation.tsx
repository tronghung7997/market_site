"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { Button, Select, Tag, Textarea } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";
import {
  type BackendState,
  type B1ConfigState,
  type B2CreditState,
  type B3TaskState,
  type WorkModelB,
  calculateB1Price,
  calculateB2Price,
  calculateB3Price,
} from "./index.ts";

export function SellerDynamicOrderSimulation({
  title,
  categoryName,
  coverId,
  escrowDays,
  workModel,
  b1,
  b2,
  b3,
  backend,
  onB1Change,
  onB2Change,
  onB3Change,
}: {
  title: string;
  categoryName?: string;
  coverId?: string | null;
  escrowDays: number;
  workModel: WorkModelB | null;
  b1: B1ConfigState;
  b2: B2CreditState;
  b3: B3TaskState;
  backend: BackendState;
  onB1Change?: (value: B1ConfigState) => void;
  onB2Change?: (value: B2CreditState) => void;
  onB3Change?: (value: B3TaskState) => void;
}) {
  const locale = useLocale() as "en" | "vi";
  const t = useTranslations("seller.workbench");
  const tp = useTranslations("products");
  const backendReady = backend.status === "approved";
  const backendReason = backend.status === "none"
    ? t("backendNone")
    : backend.status === "pending"
      ? t("backendPending")
      : backend.status === "mismatch"
        ? t("backendMismatch")
        : backend.status === "demo"
          ? t("backendDemo")
          : null;

  const identity = (
    <div className="flex items-start gap-3">
      <ProductCover coverId={coverId} title={title || t("productFallback")} className="h-11 w-11" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <Tag tone="neutral">{categoryName || t("digitalService")}</Tag>
          <span className="text-[12px] text-faint">• {t("yourShop")}</span>
        </div>
        <h3 className="break-words font-serif text-[16px] font-bold leading-snug text-fg">
          {title.trim() || t("unnamedProduct")}
        </h3>
      </div>
    </div>
  );

  if (!workModel) {
    return (
      <div className="space-y-4 rounded-xl border border-line bg-card p-5 shadow-card">
        {identity}
        <div className="space-y-3 rounded-xl border border-dashed border-line bg-surface/50 p-6 text-center text-[12px] text-muted">
          <p>{t("noDynamicModel")}</p>
          <div className="rounded-lg border border-line bg-surface py-3 font-semibold text-faint">{t("cannotBuyNoModel")}</div>
        </div>
      </div>
    );
  }

  const modelTitle = workModel === "B1"
    ? b1.isSingleUnit ? t("modelB1Single") : t("modelB1")
    : workModel === "B2" ? t("modelB2") : t("modelB3");

  return (
    <div className="space-y-4 rounded-xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2 border-b border-line pb-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{modelTitle}</span>
          <h4 className="text-[13px] font-semibold text-fg">{t("customerPreview")}</h4>
        </div>
        <Tag tone={workModel === "B1" ? "good" : workModel === "B2" ? "iris" : "neutral"}>
          {workModel === "B1" ? t("automatic") : workModel === "B2" ? t("creditPackage") : t("perTask")}
        </Tag>
      </div>

      {identity}

      {workModel === "B1" && (
        <ConfigPreview
          value={b1}
          locale={locale}
          backendReady={backendReady}
          backendReason={backendReason}
          onChange={onB1Change}
        />
      )}
      {workModel === "B2" && (
        <CreditPreview
          value={b2}
          locale={locale}
          backendReady={backendReady}
          backendReason={backendReason}
          onChange={onB2Change}
        />
      )}
      {workModel === "B3" && (
        <TaskPreview
          value={b3}
          locale={locale}
          backendReady={backendReady}
          backendReason={backendReason}
          onChange={onB3Change}
        />
      )}

      <p className="pt-1 text-center text-[11.5px] text-faint">
        {escrowDays > 0 ? t("escrowProtected", { days: escrowDays }) : t("escrowNone")}
      </p>
    </div>
  );
}

function ConfigPreview({ value, locale, backendReady, backendReason, onChange }: {
  value: B1ConfigState;
  locale: "en" | "vi";
  backendReady: boolean;
  backendReason: string | null;
  onChange?: (value: B1ConfigState) => void;
}) {
  const t = useTranslations("seller.workbench");
  const tp = useTranslations("products");
  const result = calculateB1Price(value);
  const canBuy = result.valid && backendReady;
  return (
    <div className="space-y-3 text-[12px]">
      <FieldLabel label={t("proxyType")}>
        <Select value={value.selectedType} onChange={(event) => onChange?.({ ...value, selectedType: event.target.value })}>
          {value.types.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </Select>
      </FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        <FieldLabel label={t("network")}>
          <Select value={value.selectedNetwork} onChange={(event) => onChange?.({ ...value, selectedNetwork: event.target.value })}>
            {value.networks.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </Select>
        </FieldLabel>
        <FieldLabel label={t("duration")}>
          <Select value={value.selectedDays} onChange={(event) => onChange?.({ ...value, selectedDays: Number(event.target.value) || 30 })}>
            {value.durations.map((item) => <option key={item.days} value={item.days}>{locale === "vi" ? `${item.days} ngày` : `${item.days} days`}</option>)}
          </Select>
        </FieldLabel>
      </div>
      {!value.isSingleUnit && (
        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-muted">{t("proxyQuantity")}</span>
          <div className="flex items-center overflow-hidden rounded-lg border border-line">
            <Button type="button" variant="ghost" size="sm" aria-label={tp("decreaseQty")} onClick={() => onChange?.({ ...value, qty: Math.max(1, value.qty - 1) })} className="!h-8 !w-8 !p-0 hover:bg-raised">−</Button>
            <span className="grid h-8 w-10 place-items-center border-x border-line font-mono">{value.qty}</span>
            <Button type="button" variant="ghost" size="sm" aria-label={tp("increaseQty")} onClick={() => onChange?.({ ...value, qty: value.qty + 1 })} className="!h-8 !w-8 !p-0 hover:bg-raised">+</Button>
          </div>
        </div>
      )}
      <Total amount={result.valid ? result.total : null} locale={locale} />
      <BuyState canBuy={canBuy} label={tp("buyProxy")} reason={backendReason || t("completeBasePrice")} />
    </div>
  );
}

function CreditPreview({ value, locale, backendReady, backendReason, onChange }: {
  value: B2CreditState;
  locale: "en" | "vi";
  backendReady: boolean;
  backendReason: string | null;
  onChange?: (value: B2CreditState) => void;
}) {
  const t = useTranslations("seller.workbench");
  const { formatCheckoutMoney } = useMoney();
  const result = calculateB2Price(value);
  return (
    <div className="space-y-3 text-[12px]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t("chooseCreditPackage")}</div>
      <div className="space-y-2">
        {value.packages.map((item) => {
          const active = item.size === value.selectedPackageSize;
          const raw = item.size * value.creditPrice;
          const total = raw - raw * item.discountPct / 100;
          return (
            <Button
              type="button"
              variant="ghost"
              aria-pressed={active}
              key={item.size}
              onClick={() => onChange?.({ ...value, selectedPackageSize: item.size })}
              className={cn("!h-auto !whitespace-normal flex w-full items-center justify-between rounded-xl border p-3 text-left", active ? "border-iris bg-iris-soft/40 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2")}
            >
              <span>
                <span className="block font-semibold">{locale === "vi" ? `Gói ${item.size.toLocaleString("vi-VN")} lượt` : `${item.size.toLocaleString("en-US")} requests`}</span>
                <span className="font-mono text-[11px] text-muted">{formatCheckoutMoney(value.creditPrice, { locale })} × {item.size.toLocaleString()}</span>
              </span>
              <span className="text-right">
                <span className="block font-mono font-bold text-iris-hi">{formatCheckoutMoney(total, { locale })}</span>
                {item.discountPct > 0 && <Tag tone="good">{t("savePercent", { percent: item.discountPct })}</Tag>}
              </span>
            </Button>
          );
        })}
      </div>
      <Total amount={result.valid ? result.finalTotal : null} locale={locale} />
      <BuyState canBuy={result.valid && backendReady} label={t("buyCreditPackage")} reason={backendReason || t("completeUnitPrice")} />
    </div>
  );
}

function TaskPreview({ value, locale, backendReady, backendReason, onChange }: {
  value: B3TaskState;
  locale: "en" | "vi";
  backendReady: boolean;
  backendReason: string | null;
  onChange?: (value: B3TaskState) => void;
}) {
  const t = useTranslations("seller.workbench");
  const result = calculateB3Price(value);
  return (
    <div className="space-y-3 text-[12px]">
      <FieldLabel label={t("platform")}>
        <Select value={value.selectedPlatform} onChange={(event) => onChange?.({ ...value, selectedPlatform: event.target.value })}>
          {value.platforms.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </Select>
      </FieldLabel>
      <FieldLabel label={t("urlList")} aside={t("urlCount", { count: result.urlCount })}>
        <Textarea rows={3} value={value.urls} onChange={(event) => onChange?.({ ...value, urls: event.target.value })} placeholder={t("urlPlaceholder")} />
      </FieldLabel>
      <Total amount={result.valid ? result.total : null} locale={locale} />
      <BuyState
        canBuy={result.valid && backendReady && result.urlCount > 0}
        label={t("submitTasks")}
        reason={backendReason || (result.urlCount === 0 ? t("enterUrl") : t("completeUnitPrice"))}
      />
    </div>
  );
}

function FieldLabel({ label, aside, children }: { label: string; aside?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span>{label}</span>{aside && <span className="font-mono text-iris-hi">{aside}</span>}
      </span>
      {children}
    </label>
  );
}

function Total({ amount, locale }: { amount: number | null; locale: "en" | "vi" }) {
  const tp = useTranslations("products");
  const { formatCheckoutMoney } = useMoney();
  return (
    <div className="flex items-baseline justify-between border-t border-line pt-3">
      <span className="text-[12px] text-muted">{tp("total")}</span>
      <span className="font-mono text-[20px] font-bold tabular-nums text-iris-hi">{amount == null ? "—" : formatCheckoutMoney(amount, { locale })}</span>
    </div>
  );
}

function BuyState({ canBuy, label, reason }: { canBuy: boolean; label: string; reason: string }) {
  const t = useTranslations("seller.workbench");
  return canBuy ? (
    <div className="w-full rounded-lg bg-iris py-3 text-center text-[12.5px] font-semibold text-panel shadow-xs">{label}</div>
  ) : (
    <div className="space-y-1.5 text-center">
      <div className="w-full cursor-not-allowed rounded-lg border border-line bg-surface py-3 text-[12px] font-semibold text-faint">{t("cannotBuy")}</div>
      <p className="text-[11px] font-medium text-warn">{reason}</p>
    </div>
  );
}
