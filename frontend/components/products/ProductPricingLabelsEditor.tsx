"use client";

import type { ProductPricingLabels, ProductLocale } from "@/lib/types";
import { Button, Field, Input } from "@/components/ui";
import { useTranslations } from "next-intl";

type Params = Record<string, unknown>;

function mapAt(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item ?? "")]),
  );
}

/** Sản phẩm có bảng giá (`plan_prices`): trục lấy từ chính các key `type|network|days`. */
export function hasPlanTable(params: Params | null | undefined): boolean {
  const table = params?.plan_prices;
  return Boolean(table && typeof table === "object" && !Array.isArray(table) && Object.keys(table).length > 0);
}

function planAxes(params: Params): { types: string[]; networks: string[]; days: string[] } {
  const parts = Object.keys(mapAt(params.plan_prices)).map((key) => key.split("|")).filter((p) => p.length === 3);
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
  return {
    types: uniq([...parts.map((p) => p[0]), ...Object.keys(mapAt(params.type_display))]),
    networks: uniq([...parts.map((p) => p[1]), ...Object.keys(mapAt(params.network_display))]),
    days: uniq(parts.map((p) => p[2])).sort((a, b) => Number(a) - Number(b)),
  };
}

function keysFrom(params: Params, map: keyof ProductPricingLabels): string[] {
  const current = mapAt(params[map]);
  if (hasPlanTable(params)) {
    const axes = planAxes(params);
    if (map === "field_labels") return Array.from(new Set(["type", "network", ...Object.keys(current)]));
    if (map === "type_display") return axes.types;
    if (map === "network_display") return axes.networks;
    if (map === "duration_labels") return axes.days;
  }
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

/** Nhãn gốc (tiếng Việt, trong pricing_params) — gợi ý cho người dịch. */
function sourceLabel(params: Params, map: keyof ProductPricingLabels, key: string): string {
  if (map === "duration_labels") return mapAt(params.duration_labels)[key] ?? `${key} ngày`;
  return mapAt(params[map])[key] ?? key;
}

export function ProductPricingLabelsEditor({
  locale,
  params,
  value,
  onChange,
  onDirty,
  onOpenPriceGrid,
}: {
  locale: ProductLocale;
  params: Params | null | undefined;
  value: ProductPricingLabels;
  onChange: (next: ProductPricingLabels) => void;
  onDirty: () => void;
  /** Có thì bản tiếng Việt của sản phẩm dạng bảng giá hiện nút mở bảng giá. */
  onOpenPriceGrid?: () => void;
}) {
  const t = useTranslations("seller");
  if (!params || Object.keys(params).length === 0) return null;
  if (locale === "vi" && hasPlanTable(params)) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-iris/20 bg-iris/4 p-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t("pricingLabelsTitle")} · VI</div>
          <p className="mt-1 text-[12px] text-muted">{t("pricingLabelsInGrid")}</p>
        </div>
        {onOpenPriceGrid && <Button size="sm" variant="secondary" onClick={onOpenPriceGrid}>{t("openPriceGrid")}</Button>}
      </div>
    );
  }
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
                    placeholder={sourceLabel(params, map, key)}
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
