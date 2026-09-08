"use client";

import { Field, Input, Select } from "@/components/ui";
import {
  DPROXY_NETWORK_PRESETS,
  DPROXY_TYPE_OPTIONS,
  dproxyNetworkLabel,
  dproxyTypeLabel,
} from "@/lib/dproxy-plan";

const CUSTOM = "__custom__";

export function DproxyCodeSelect({
  kind,
  name,
  value,
  onChange,
  proxyType,
  allowCustom = true,
  currentLabel,
  locale = "vi",
}: {
  kind: "type" | "network";
  name: string;
  value: string;
  onChange: (value: string) => void;
  proxyType?: string;
  allowCustom?: boolean;
  currentLabel?: string;
  locale?: "vi" | "en";
}) {
  const allPresets = kind === "type"
    ? DPROXY_TYPE_OPTIONS.map((item) => ({ value: item.value, label: locale === "en" ? item.labelEn : item.labelVi }))
    : DPROXY_NETWORK_PRESETS.map((item) => ({ value: item.value, label: locale === "en" ? item.labelEn : item.labelVi }));
  const networkIsCarrier = proxyType === "mobile" || proxyType === "isp";
  const presets = kind === "network" && proxyType
    ? allPresets.filter((item) => networkIsCarrier ? item.value.length !== 2 : item.value.length === 2)
    : allPresets;
  const known = presets.some((item) => item.value === value);
  const selectValue = !value ? "" : known ? value : allowCustom ? CUSTOM : value;
  const label = kind === "type"
    ? (locale === "en" ? "Proxy type" : "Loại proxy")
    : networkIsCarrier
      ? (locale === "en" ? "Carrier / ISP" : "Nhà mạng")
      : (locale === "en" ? "Country" : "Quốc gia");
  const hint = kind === "type"
    ? (locale === "en" ? "Machine code sent with the order, e.g. residential or isp." : "Mã gửi kèm đơn, ví dụ residential hoặc isp.")
    : (locale === "en" ? "Country code (VN) or ISP (viettel, vinaphone)." : "Mã quốc gia (VN) hoặc nhà mạng (viettel, vinaphone).");
  const customPlaceholder = kind === "type" ? "vd: residential" : "vd: viettel";

  return (
    <Field label={label} hint={selectValue === CUSTOM ? hint : undefined}>
      <div className="space-y-1.5">
        <Select
          name={name}
          value={selectValue}
          onChange={(event) => {
            const next = event.target.value;
            if (next === CUSTOM) onChange(known ? "" : value);
            else onChange(next);
          }}
        >
          <option value="">{locale === "en" ? "Choose…" : "Chọn…"}</option>
          {!allowCustom && value && !known && (
            <option value={value}>{currentLabel ? `${locale === "en" ? "Custom" : "Tùy chỉnh"}: ${currentLabel}` : locale === "en" ? `Current value: ${value}` : `Giá trị hiện tại: ${value}`}</option>
          )}
          {kind === "network" && !proxyType && (
            <>
              <option disabled>{locale === "en" ? "— Countries —" : "— Quốc gia —"}</option>
              {presets.filter((item) => item.value.length === 2).map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
              <option disabled>{locale === "en" ? "— Networks / ISPs —" : "— Nhà mạng —"}</option>
              {presets.filter((item) => item.value.length !== 2).map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </>
          )}
          {kind === "network" && proxyType && presets.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
          {kind === "type" && presets.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
          {allowCustom && <option value={CUSTOM}>{locale === "en" ? "Other — type a code…" : "Khác — nhập mã…"}</option>}
        </Select>
        {allowCustom && selectValue === CUSTOM && (
          <Input
            name={`${name}-custom`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={customPlaceholder}
          />
        )}
      </div>
    </Field>
  );
}

export function dproxyBuyerPreview(type: string, network: string, days: number, locale: "vi" | "en" = "vi"): string {
  return `${dproxyTypeLabel(type, locale)} · ${dproxyNetworkLabel(network, locale)} · ${days} ${locale === "en" ? "days" : "ngày"}`;
}
