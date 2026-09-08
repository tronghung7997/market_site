export const DPROXY_TYPE_OPTIONS = [
  { value: "residential", labelVi: "Dân cư", labelEn: "Residential" },
  { value: "datacenter", labelVi: "Datacenter", labelEn: "Datacenter" },
  { value: "isp", labelVi: "ISP", labelEn: "ISP" },
  { value: "mobile", labelVi: "Di động", labelEn: "Mobile" },
  { value: "static", labelVi: "IP tĩnh", labelEn: "Static IP" },
  { value: "rotating", labelVi: "IP xoay", labelEn: "Rotating IP" },
] as const;

export const DPROXY_NETWORK_PRESETS = [
  { value: "VN", labelVi: "Việt Nam", labelEn: "Vietnam" },
  { value: "viettel", labelVi: "Viettel", labelEn: "Viettel" },
  { value: "vinaphone", labelVi: "Vinaphone", labelEn: "Vinaphone" },
  { value: "mobifone", labelVi: "Mobifone", labelEn: "Mobifone" },
  { value: "fpt", labelVi: "FPT", labelEn: "FPT" },
  { value: "US", labelVi: "Hoa Kỳ", labelEn: "United States" },
  { value: "GB", labelVi: "Anh", labelEn: "United Kingdom" },
  { value: "SG", labelVi: "Singapore", labelEn: "Singapore" },
  { value: "JP", labelVi: "Nhật Bản", labelEn: "Japan" },
  { value: "KR", labelVi: "Hàn Quốc", labelEn: "South Korea" },
  { value: "TH", labelVi: "Thái Lan", labelEn: "Thailand" },
  { value: "ID", labelVi: "Indonesia", labelEn: "Indonesia" },
  { value: "DE", labelVi: "Đức", labelEn: "Germany" },
  { value: "AU", labelVi: "Úc", labelEn: "Australia" },
] as const;

export const DPROXY_NETWORK_OPTIONS = DPROXY_NETWORK_PRESETS.map((item) => item.value);

function humanizeCode(code: string): string {
  const words = code.replace(/_/g, " ").replace(/-/g, " ").split(" ").filter(Boolean);
  if (!words.length) return code;
  return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}

export function dproxyTypeLabel(code: string, locale: "vi" | "en" = "vi"): string {
  const match = DPROXY_TYPE_OPTIONS.find((item) => item.value === code);
  if (!match) return humanizeCode(code);
  return locale === "vi" ? match.labelVi : match.labelEn;
}

export function dproxyNetworkLabel(code: string, locale: "vi" | "en" = "vi"): string {
  const match = DPROXY_NETWORK_PRESETS.find((item) => item.value === code);
  if (!match) return /^[A-Z]{2}$/.test(code) ? code : humanizeCode(code);
  return locale === "vi" ? match.labelVi : match.labelEn;
}

export function formatDproxyPlanKey(type: string, network: string, days: number): string {
  return `${type.trim()}|${network.trim()}|${days}`;
}

export function parseDproxyPlanKey(key: string): { type: string; network: string; days: number } {
  const [type = "", network = "", rawDays = ""] = key.split("|");
  return { type, network, days: Number(rawDays) || 0 };
}

export function dproxySalePriceFromBase(basePrice: number, days: number): number {
  if (!basePrice || !days) return 0;
  return Math.round(basePrice * days / 30);
}

export function dproxyBaseFromSalePrice(salePrice: number, days: number): number {
  if (!salePrice || !days) return 0;
  return Math.round(salePrice * 30 / days);
}

export function guessDproxyMapping(planName: string, durationDays?: number): { type: string; network: string; days: number } {
  const text = planName.toLowerCase();
  let type = "";
  if (/(residential|resi|dân cư|dan cu)/i.test(text)) type = "residential";
  else if (/(datacenter|data.?center|\bdc\b)/i.test(text)) type = "datacenter";
  else if (/\bisp\b/i.test(text)) type = "isp";
  else if (/(mobile|4g|5g)/i.test(text)) type = "mobile";

  let network = "";
  if (/(viettel)/i.test(text)) network = "viettel";
  else if (/(vinaphone|vina\b)/i.test(text)) network = "vinaphone";
  else if (/(mobifone|mobi\b)/i.test(text)) network = "mobifone";
  else if (/\bfpt\b/i.test(text)) network = "fpt";
  else {
    const country = planName.match(/\b([A-Z]{2})\b/);
    if (country) network = country[1];
    else if (/(việt nam|viet nam|\bvn\b)/i.test(text)) network = "VN";
    else if (/(united states|\busa\b|\bus\b)/i.test(text)) network = "US";
  }

  const daysFromName = planName.match(/(\d+)\s*(?:d|day|ngày)/i);
  const days = durationDays && durationDays > 0
    ? durationDays
    : daysFromName ? Number(daysFromName[1]) : 0;

  return { type, network, days };
}

export function isSingleConfigPlan(params: Record<string, unknown> | null | undefined): boolean {
  if (!params) return false;
  const priced = Object.keys((params.plan_prices as Record<string, number>) ?? {});
  if (priced.length === 1) return true;
  if (priced.length > 1) return false;
  const types = Object.keys((params.type_mult as Record<string, number>) ?? {});
  const networks = Object.keys((params.network_mult as Record<string, number>) ?? {});
  const durations = (params.duration_options as { days?: number }[] | undefined) ?? [];
  return types.length === 1 && networks.length === 1 && durations.length === 1;
}

export interface DproxySalePackage {
  type: string;
  network: string;
  days: number;
  price: number;
}

export function packagesFromDproxyParams(params: Record<string, unknown> | null | undefined): DproxySalePackage[] {
  if (!params) return [];
  const priced = params.plan_prices as Record<string, number> | undefined;
  if (priced && Object.keys(priced).length > 0) {
    return Object.entries(priced).flatMap(([key, price]) => {
      const item = parseDproxyPlanKey(key);
      if (!item.type || !item.network || !item.days || !price) return [];
      return [{ ...item, price: Number(price) || 0 }];
    });
  }
  const types = Object.keys((params.type_mult as Record<string, number>) ?? {});
  const networks = Object.keys((params.network_mult as Record<string, number>) ?? {});
  const durations = ((params.duration_options as { days?: number }[]) ?? []).map((item) => item.days || 0).filter((days) => days > 0);
  if (types.length === 1 && networks.length === 1 && durations.length === 1) {
    return [{
      type: types[0],
      network: networks[0],
      days: durations[0],
      price: dproxySalePriceFromBase(Number(params.base_price) || 0, durations[0]),
    }];
  }
  return [];
}

export function dproxyParamsFromPackages(packages: DproxySalePackage[]): Record<string, unknown> {
  const valid = packages.filter((item) => item.type.trim() && item.network.trim() && item.days > 0 && item.price > 0);
  const planPrices = Object.fromEntries(
    valid.map((item) => [formatDproxyPlanKey(item.type, item.network, item.days), item.price]),
  );
  const types = [...new Set(valid.map((item) => item.type))];
  const networks = [...new Set(valid.map((item) => item.network))];
  const days = [...new Set(valid.map((item) => item.days))];
  const first = valid[0];
  return {
    base_price: first ? dproxyBaseFromSalePrice(first.price, first.days) : 0,
    type_mult: Object.fromEntries(types.map((type) => [type, 1])),
    network_mult: Object.fromEntries(networks.map((network) => [network, 1])),
    duration_options: days.map((value) => ({ days: value, label: `${value} ngày` })),
    type_display: Object.fromEntries(types.map((type) => [type, dproxyTypeLabel(type)])),
    network_display: Object.fromEntries(networks.map((network) => [network, dproxyNetworkLabel(network)])),
    plan_prices: planPrices,
  };
}
