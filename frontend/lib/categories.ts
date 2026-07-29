import type { Category } from "@/lib/types";

/** Cây danh mục → mảng phẳng, giữ thứ tự duyệt sâu (cha đứng trước con).
 *  Một bản thay cho 3 bản chép ở home / categories / sellers. */
export function flattenCategories(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (list: Category[]) => list.forEach((c) => { out.push(c); walk(c.children ?? []); });
  walk(cats);
  return out;
}

/** id của danh mục + toàn bộ hậu duệ — dùng để lọc sản phẩm theo cả nhánh. */
export function subtreeIds(cat: Category): number[] {
  return [cat.id, ...(cat.children ?? []).flatMap(subtreeIds)];
}
