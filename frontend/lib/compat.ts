// Nhỏ, không giữ trạng thái: chỉ tra cứu trên ma trận thật lấy từ
// GET /admin/adapter-compatibility (api.adapterCompatibility()) — không hard-code
// lại danh sách adapter/strategy ở đây để tránh lệch với backend.

export type CompatMatrix = Record<string, string[] | "*">;

export function isAdapterCompatible(
  adapterType: string | null | undefined,
  strategy: string | null | undefined,
  matrix: CompatMatrix | null,
): boolean {
  if (!adapterType || !strategy || !matrix) return true;
  const compat = matrix[adapterType];
  if (compat == null) return true;
  return compat === "*" || compat.includes(strategy);
}

export function isAdapterDemo(adapterType: string | null | undefined, matrix: CompatMatrix | null): boolean {
  if (!adapterType || !matrix) return false;
  return matrix[adapterType] === "*";
}
