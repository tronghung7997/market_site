"use client";

import type { ProductPricingLabels, ProductLocale } from "@/lib/types";
import { Field, Input } from "@/components/ui";
import { useTranslations } from "next-intl";

type Params = Record<string, unknown>;

function mapAt(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item ?? "")]),
  );
}

function keysFrom(params: Params, map: keyof ProductPricingLabels): string[] {
  const current = mapAt(params[map]);
  if (map === "field_labels") {
    return Array.from(new Set([
      ...Object.keys(current),
      ...(params.type_mult && typeof params.type_mult === "object" ? ["type"] : []),
      ...(params.network_mult && typeof params.network_mult === "object" ? ["network"] : []),
      ...(Array.isArray(params.duration_options) ? ["days"] : []),
      "quantity",
    ]));
  }
  if (map === "type_display") return Object.keys(mapAt(params.type_mult)).concat(Object.keys(current).filter((k) => !(k in mapAt(params.type_mult))));
  if (map === "network_display") return Object.keys(mapAt(params.network_mult)).concat(Object.keys(current).filter((k) => !(k in mapAt(params.network_mult))));
  if (map === "duration_labels") {
    const durationKeys = Array.isArray(params.duration_options)
      ? params.duration_options.flatMap((item) => item && typeof item === "object" && "days" in item ? [String((item as { days: number }).days)] : [])
      : [];
    return Array.from(new Set([...durationKeys, ...Object.keys(current)]));
  }
  return Object.keys(current);
}

export function ProductPricingLabelsEditor({
  locale,
  params,
  value,
  onChange,
  onDirty,
}: {
  locale: ProductLocale;
  params: Params | null | undefined;
  value: ProductPricingLabels;
  onChange: (next: ProductPricingLabels) => void;
  onDirty: () => void;
}) {
  const t = useTranslations("seller");
  if (!params || Object.keys(params).length === 0) return null;
  const maps: (keyof ProductPricingLabels)[] = ["field_labels", "type_display", "network_display", "duration_labels"];
  const update = (map: keyof ProductPricingLabels, key: string, nextValue: string) => {
    const nextMap = { ...mapAt(value[map]), [key]: nextValue };
    onChange({ ...value, [map]: nextMap });
    onDirty();
  };

  return (
    <div className="space-y-4 rounded-lg border border-iris/20 bg-iris/4 p-4">
      <div>
        <div className="text-[13px] font-semibold">{t("pricingLabelsTitle")} · {locale.toUpperCase()}</div>
        <p className="mt-1 text-[11.5px] text-muted">{t("pricingLabelsHint")}</p>
      </div>
      {maps.map((map) => {
        const keys = keysFrom(params, map);
        if (keys.length === 0) return null;
        return (
          <div key={map} className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t(map === "field_labels" ? "pricingFieldLabels" : map === "type_display" ? "pricingProtocolLabels" : map === "network_display" ? "pricingNetworkLabels" : "pricingDurationLabels")}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {keys.map((key) => (
                <Field key={key} label={key}>
                  <Input
                    value={mapAt(value[map])[key] ?? ""}
                    placeholder={key}
                    onChange={(event) => update(map, key, event.target.value)}
                  />
                </Field>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
