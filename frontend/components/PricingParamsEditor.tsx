"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Banner, Field, Input, Select } from "@/components/ui";
import { Info } from "@/components/Icons";
import { dproxyParamsFromPackages, packagesFromDproxyParams } from "@/lib/dproxy-plan";
import { DproxyCodeSelect } from "@/components/DproxyCodeSelect";

/* ================================================================
   Editor cho tham số chiến lược giá (config/credit/task) — dùng chung
   cho cả trang admin và trang seller, thay cho 2 bản gần-giống-nhau
   từng tồn tại độc lập ở mỗi trang.

   LabeledMultEditor: mỗi lựa chọn = 1 dòng "Nhãn khách thấy" + "Mã máy
   gửi cho nhà cung cấp" + "Hệ số giá" — tách biệt rõ cái buyer đọc được
   khỏi cái được gửi nguyên văn cho API nhà cung cấp thật (xem
   RealApiAdapter.provision, gửi user_config y nguyên). Mã máy để trống
   thì tự dùng luôn nhãn làm mã, giữ hành vi cũ (key == label).

   Mọi input có bề rộng cố định đều bọc trong 1 div riêng thay vì gán
   thẳng class w-[Npx] lên <Input> — <Input> tự có w-full, đặt 2 class
   width lên cùng 1 phần tử là 2 utility cùng specificity giẫm lên
   nhau, thắng-thua phụ thuộc thứ tự Tailwind sinh CSS chứ không phải
   thứ tự viết trong className (đã ăn bug này một lần — ô hệ số kéo dài
   hết hàng vì w-full thắng w-[90px]).
   ================================================================ */

type MultParams = Record<string, unknown>;

function Cell({ width, children }: { width: string; children: React.ReactNode }) {
  return <div className={`${width} shrink-0`}>{children}</div>;
}

function LabeledMultEditor({
  sectionTitle,
  fieldLabelKey,
  defaultFieldLabel,
  multKey,
  displayKey,
  params,
  onChange,
}: {
  sectionTitle: string;
  fieldLabelKey: string;
  defaultFieldLabel: string;
  multKey: string;
  displayKey: string;
  params: MultParams;
  onChange: (params: MultParams) => void;
}) {
  const t = useTranslations("seller.operations.editor");
  const mult = (params[multKey] as Record<string, number>) ?? {};
  const display = (params[displayKey] as Record<string, string>) ?? {};
  const fieldLabels = (params.field_labels as Record<string, string>) ?? {};

  const [newLabel, setNewLabel] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newMult, setNewMult] = useState("1");

  const setFieldLabel = (v: string) => {
    onChange({ ...params, field_labels: { ...fieldLabels, [fieldLabelKey]: v || undefined } });
  };

  const addOption = () => {
    const label = newLabel.trim();
    if (!label) return;
    const code = newCode.trim() || label;
    onChange({
      ...params,
      [multKey]: { ...mult, [code]: Number(newMult) || 0 },
      [displayKey]: { ...display, [code]: label },
    });
    setNewLabel(""); setNewCode(""); setNewMult("1");
  };

  const removeOption = (code: string) => {
    const nextMult = { ...mult }; delete nextMult[code];
    const nextDisplay = { ...display }; delete nextDisplay[code];
    onChange({ ...params, [multKey]: nextMult, [displayKey]: nextDisplay });
  };

  const updateMultVal = (code: string, v: number) => {
    onChange({ ...params, [multKey]: { ...mult, [code]: v } });
  };

  const codes = Object.keys(mult);

  return (
    <div className="rounded-lg border border-line bg-raised/40 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12px] font-semibold">{sectionTitle}</div>
        <input
          className="h-7 rounded-md bg-surface border border-line px-2 text-[11.5px] text-muted focus:border-iris focus:text-fg outline-none w-[180px]"
          placeholder={t("buyerGroupPlaceholder", { default: defaultFieldLabel })}
          value={fieldLabels[fieldLabelKey] ?? ""}
          onChange={(e) => setFieldLabel(e.target.value)}
        />
      </div>

      {codes.length === 0 && (
        <p className="text-[12px] text-faint">{t("emptyOptions")}</p>
      )}

      {codes.map((code) => (
        <div key={code} className="flex items-center gap-2 flex-wrap sm:flex-nowrap rounded-md border border-line/70 bg-surface px-2 py-2 sm:border-transparent sm:bg-transparent sm:px-0 sm:py-0">
          <div className="flex-1 min-w-[120px]">
            <Input
              value={display[code] ?? code}
              onChange={(e) => onChange({ ...params, [displayKey]: { ...display, [code]: e.target.value } })}
              placeholder={t("buyerLabel")}
            />
          </div>
          <span
            className="text-[11px] font-mono bg-surface border border-line rounded px-2 py-2 text-faint shrink-0"
            title={t("machineCodeHelp")}
          >
            {code}
          </span>
          <Cell width="w-[80px]"><Input type="number" value={mult[code]} onChange={(e) => updateMultVal(code, Number(e.target.value))} /></Cell>
          <button onClick={() => removeOption(code)} className="text-bad text-[12px] hover:underline shrink-0">{t("remove")}</button>
        </div>
      ))}

      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-2 border-t border-line/60 mt-1">
        <div className="flex-1 min-w-[120px]">
          <Input placeholder={t("addLabelPlaceholder")} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        </div>
        <Cell width="w-[130px]"><Input placeholder={t("machineCode")} value={newCode} onChange={(e) => setNewCode(e.target.value)} /></Cell>
        <Cell width="w-[80px]"><Input type="number" placeholder={t("multiplier")} value={newMult} onChange={(e) => setNewMult(e.target.value)} /></Cell>
        <Button size="sm" variant="secondary" onClick={addOption} className="shrink-0">{t("add")}</Button>
      </div>
      <p className="text-[11px] text-faint">
        {t("machineCodeHelp")}
      </p>
    </div>
  );
}

/* ── Editor cho 3 tham số dạng danh sách cấu trúc cố định — không còn
   JSON thô, mỗi tham số có form nhập đúng field của nó. ──────────── */

function DurationOptionsEditor({ value, onChange }: {
  value: { days: number; label?: string }[];
  onChange: (v: { days: number; label?: string }[]) => void;
}) {
  const t = useTranslations("seller.operations.editor");
  const [days, setDays] = useState("");
  const [label, setLabel] = useState("");

  const add = () => {
    const d = Number(days);
    if (!d || d <= 0) return;
    onChange([...value, { days: d, label: label.trim() || `${d} ${d === 1 ? t("daySingular") : t("dayPlural")}` }]);
    setDays(""); setLabel("");
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted">{t("duration")}</div>
      {value.length === 0 && <p className="text-[12px] text-faint">{t("emptyDuration")}</p>}
      {value.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[12.5px] bg-raised rounded-md px-2.5 py-1.5 flex-1">
            <strong>{o.days} {o.days === 1 ? t("daySingular") : t("dayPlural")}</strong>{o.label ? ` — ${o.label}` : ""}
          </span>
          <button onClick={() => remove(i)} className="text-bad text-[12px] hover:underline shrink-0">{t("remove")}</button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-1 border-t border-line/60 mt-1">
        <Cell width="w-[100px]"><Input type="number" placeholder={t("days")} value={days} onChange={(e) => setDays(e.target.value)} /></Cell>
        <div className="flex-1 min-w-[120px]">
          <Input placeholder={t("durationLabelPlaceholder")} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <Button size="sm" variant="secondary" onClick={add} className="shrink-0">{t("add")}</Button>
      </div>
    </div>
  );
}

function VolumeTiersEditor({ value, onChange }: {
  value: { min_qty: number; discount: number }[];
  onChange: (v: { min_qty: number; discount: number }[]) => void;
}) {
  const tx = useTranslations("seller.operations.editor");
  const [minQty, setMinQty] = useState("");
  const [discountPct, setDiscountPct] = useState("");

  const add = () => {
    const q = Number(minQty);
    const p = Number(discountPct);
    if (!q || q <= 0 || !(p > 0 && p <= 100)) return;
    onChange([...value, { min_qty: q, discount: p / 100 }]);
    setMinQty(""); setDiscountPct("");
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted">{tx("volumeDiscount")}</div>
      {value.length === 0 && <p className="text-[12px] text-faint">{tx("emptyDiscount")}</p>}
      {value.map((tier, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[12.5px] bg-raised rounded-md px-2.5 py-1.5 flex-1">
            {tx("fromUnits", { count: tier.min_qty, discount: Math.round(tier.discount * 100) })}
          </span>
          <button onClick={() => remove(i)} className="text-bad text-[12px] hover:underline shrink-0">{tx("remove")}</button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-1 border-t border-line/60 mt-1">
        <Cell width="w-[120px]"><Input type="number" placeholder={tx("fromQuantity")} value={minQty} onChange={(e) => setMinQty(e.target.value)} /></Cell>
        <Cell width="w-[110px]"><Input type="number" placeholder={tx("discount")} value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} /></Cell>
        <Button size="sm" variant="secondary" onClick={add} className="shrink-0">{tx("add")}</Button>
      </div>
    </div>
  );
}

function PackagesEditor({ value, onChange }: {
  value: { size: number; label?: string }[];
  onChange: (v: { size: number; label?: string }[]) => void;
}) {
  const t = useTranslations("seller.operations.editor");
  const [size, setSize] = useState("");
  const [label, setLabel] = useState("");

  const add = () => {
    const s = Number(size);
    if (!s || s <= 0) return;
    onChange([...value, { size: s, label: label.trim() || `${s.toLocaleString("vi-VN")} credits` }]);
    setSize(""); setLabel("");
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted">{t("creditPackages")}</div>
      {value.length === 0 && <p className="text-[12px] text-faint">{t("emptyPackages")}</p>}
      {value.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[12.5px] bg-raised rounded-md px-2.5 py-1.5 flex-1">
            <strong>{t("creditsCount", { count: p.size.toLocaleString() })}</strong>{p.label ? ` — ${p.label}` : ""}
          </span>
          <button onClick={() => remove(i)} className="text-bad text-[12px] hover:underline shrink-0">{t("remove")}</button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-1 border-t border-line/60 mt-1">
        <Cell width="w-[110px]"><Input type="number" placeholder={t("credits")} value={size} onChange={(e) => setSize(e.target.value)} /></Cell>
        <div className="flex-1 min-w-[120px]">
          <Input placeholder={t("creditLabelPlaceholder")} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <Button size="sm" variant="secondary" onClick={add} className="shrink-0">{t("add")}</Button>
      </div>
    </div>
  );
}

export function PricingParamsEditor({ strategy, params, onChange, adapterType }: {
  strategy: string;
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  adapterType?: string | null;
}) {
  const t = useTranslations("seller.operations.editor");
  const locale = useLocale();
  const dproxyCopy = locale === "en"
    ? {
      title: "Packages the buyer can choose",
      help: "Add every mapped DProxy package this product sells. Buyers pick a whole package — they cannot mix type, country, and duration.",
      type: "Proxy type",
      network: "Country or network",
      days: "Days",
      salePrice: "Buyer price (VND)",
      add: "Add package",
      remove: "Remove",
    }
    : {
      title: "Gói buyer được chọn",
      help: "Thêm từng gói DProxy đã map. Buyer chọn nguyên gói, không trộn loại × quốc gia × số ngày.",
      type: "Loại proxy",
      network: "Quốc gia hoặc nhà mạng",
      days: "Số ngày",
      salePrice: "Giá khách trả (VND)",
      add: "Thêm gói",
      remove: "Xoá",
    };
  const setParam = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  if (strategy === "config" && (adapterType === "dproxy" || Boolean(params.plan_prices))) {
    const packages = packagesFromDproxyParams(params);
    const writePackages = (next: typeof packages) => onChange({ ...params, ...dproxyParamsFromPackages(next) });
    return (
      <div className="space-y-4">
        <Banner tone="iris" icon={<Info size={14} />} title={dproxyCopy.title}>
          {dproxyCopy.help}
        </Banner>
        {packages.map((item, index) => (
          <div key={`${item.type}|${item.network}|${item.days}|${index}`} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_96px_1fr_auto]">
            <DproxyCodeSelect kind="type" name={`pkg-type-${index}`} value={item.type} onChange={(type) => writePackages(packages.map((row, rowIndex) => rowIndex === index ? { ...row, type } : row))} locale={locale === "en" ? "en" : "vi"} />
            <DproxyCodeSelect kind="network" name={`pkg-network-${index}`} value={item.network} onChange={(network) => writePackages(packages.map((row, rowIndex) => rowIndex === index ? { ...row, network } : row))} locale={locale === "en" ? "en" : "vi"} />
            <Field label={dproxyCopy.days}>
              <Input type="number" min={1} value={item.days} onChange={(e) => writePackages(packages.map((row, rowIndex) => rowIndex === index ? { ...row, days: Number(e.target.value) || 0 } : row))} />
            </Field>
            <Field label={dproxyCopy.salePrice}>
              <Input type="number" min={1} value={item.price || ""} onChange={(e) => writePackages(packages.map((row, rowIndex) => rowIndex === index ? { ...row, price: Number(e.target.value) || 0 } : row))} />
            </Field>
            <button type="button" className="text-bad text-[12px] self-end pb-2" onClick={() => writePackages(packages.filter((_, rowIndex) => rowIndex !== index))}>{dproxyCopy.remove}</button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => writePackages([...packages, { type: "residential", network: "VN", days: 7, price: 0 }])}>{dproxyCopy.add}</Button>
      </div>
    );
  }

  if (strategy === "config") {
    const basePrice = Number(params.base_price) || 0;
    const types = Object.entries((params.type_mult as Record<string, number>) ?? {});
    const networks = Object.entries((params.network_mult as Record<string, number>) ?? {});
    const durations = (params.duration_options as { days: number; label?: string }[]) ?? [];
    const examples = types.flatMap(([type, typeMult]) => networks.flatMap(([network, networkMult]) =>
      durations.map((duration) => ({
        key: `${type}|${network}|${duration.days}`,
        label: `${((params.type_display as Record<string, string>) ?? {})[type] ?? type} · ${((params.network_display as Record<string, string>) ?? {})[network] ?? network} · ${duration.label ?? `${duration.days} ngày`}`,
        price: Math.round(basePrice * typeMult * networkMult * duration.days / 30),
      })),
    )).slice(0, 12);
    return (
      <div className="space-y-4">
        <Banner tone="iris" icon={<Info size={14} />} title={t("configPricingTitle")}>
          {t("configPricingHelp")}
        </Banner>
        <Field label={t("basePrice")} hint={t("basePriceHelp")}>
          <Input type="number" value={(params.base_price as number) ?? ""} onChange={(e) => setParam("base_price", Number(e.target.value) || 0)} />
        </Field>
        <LabeledMultEditor
          sectionTitle={t("typeSection")}
          fieldLabelKey="type" defaultFieldLabel={t("typeDefault")}
          multKey="type_mult" displayKey="type_display"
          params={params} onChange={onChange}
        />
        <LabeledMultEditor
          sectionTitle={t("networkSection")}
          fieldLabelKey="network" defaultFieldLabel={t("networkDefault")}
          multKey="network_mult" displayKey="network_display"
          params={params} onChange={onChange}
        />
        <DurationOptionsEditor value={(params.duration_options as { days: number; label?: string }[]) ?? []} onChange={(v) => setParam("duration_options", v)} />
        {examples.length > 0 && (
          <div className="rounded-lg border border-line overflow-hidden">
            <div className="px-3 py-2 bg-raised text-[12px] font-medium">{t("buyerPricePreview")}</div>
            <div className="divide-y divide-line">
              {examples.map((example) => (
                <div key={example.key} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                  <span className="text-muted">{example.label}</span>
                  <span className="font-mono font-semibold tabular">{example.price.toLocaleString("vi-VN")}đ</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <VolumeTiersEditor value={(params.volume_tiers as { min_qty: number; discount: number }[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} />
      </div>
    );
  }

  if (strategy === "credit") {
    return (
      <div className="space-y-4">
        <Field label={t("creditPrice")}>
          <Input type="number" value={(params.credit_price as number) ?? ""} onChange={(e) => setParam("credit_price", Number(e.target.value) || 0)} />
        </Field>
        <PackagesEditor value={(params.packages as { size: number; label?: string }[]) ?? []} onChange={(v) => setParam("packages", v)} />
        <VolumeTiersEditor value={(params.volume_tiers as { min_qty: number; discount: number }[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} />
      </div>
    );
  }

  if (strategy === "task") {
    return (
      <div className="space-y-4">
        <Field label={t("basePrice")}>
          <Input type="number" value={(params.base_price as number) ?? ""} onChange={(e) => setParam("base_price", Number(e.target.value) || 0)} />
        </Field>
        <LabeledMultEditor
          sectionTitle={t("platformSection")}
          fieldLabelKey="platform" defaultFieldLabel={t("platformDefault")}
          multKey="platform_mult" displayKey="platform_display"
          params={params} onChange={onChange}
        />
        <VolumeTiersEditor value={(params.volume_tiers as { min_qty: number; discount: number }[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} />
      </div>
    );
  }

  return null;
}
