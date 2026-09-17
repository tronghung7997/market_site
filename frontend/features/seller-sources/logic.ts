/** Pure helpers for the supplier-sources feature (no React). */

/** Giá bán gợi ý = vốn × (1 + margin%), làm tròn LÊN bội số `roundTo` —
 *  cùng công thức với backend `sources.suggest_price`. */
export function suggestPrice(costPrice: number, marginPct: number, roundTo = 1000): number {
  if (costPrice <= 0) return 0;
  const step = Math.max(Math.trunc(roundTo) || 1, 1);
  return Math.ceil((costPrice * (1 + marginPct / 100)) / step) * step;
}
