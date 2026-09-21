import type { CategoryAdminRow } from "@/lib/types";
import { headingSlug } from "@/lib/heading-slug";

export type CategoryNode = CategoryAdminRow & { children: CategoryNode[]; depth: number };

/** Flat admin rows → ordered tree (sort_order, then id) with depth. */
export function buildTree(rows: CategoryAdminRow[]): CategoryNode[] {
  const byParent = new Map<number | null, CategoryAdminRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.parent_id) ?? [];
    list.push(r);
    byParent.set(r.parent_id, list);
  }
  const order = (a: CategoryAdminRow, b: CategoryAdminRow) => a.sort_order - b.sort_order || a.id - b.id;
  const build = (parent: number | null, depth: number): CategoryNode[] =>
    (byParent.get(parent) ?? []).sort(order).map((r) => ({ ...r, depth, children: build(r.id, depth + 1) }));
  return build(null, 0);
}

/** Depth-first flattening of the tree (parents before children). */
export function flattenTree(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (list: CategoryNode[]) => list.forEach((n) => { out.push(n); walk(n.children); });
  walk(nodes);
  return out;
}

/** Ancestors from the root down to (not including) `id`. */
export function pathTo(rows: CategoryAdminRow[], id: number | null): CategoryAdminRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: CategoryAdminRow[] = [];
  let cur = id == null ? undefined : byId.get(id);
  while (cur) { out.unshift(cur); cur = cur.parent_id == null ? undefined : byId.get(cur.parent_id); }
  return out;
}

/** id + every descendant — the set a category may not be moved into. */
export function descendantIds(rows: CategoryAdminRow[], id: number): Set<number> {
  const byParent = new Map<number | null, number[]>();
  for (const r of rows) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r.id]);
  const out = new Set<number>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of byParent.get(cur) ?? []) if (!out.has(child)) { out.add(child); stack.push(child); }
  }
  return out;
}

export const slugFromName = (name: string) => headingSlug(name).slice(0, 100);

export type StatusFilter = "" | "active" | "hidden" | "empty";

export function matchesFilter(row: CategoryAdminRow, status: StatusFilter, search: string): boolean {
  if (status === "active" && !row.is_active) return false;
  if (status === "hidden" && row.is_active) return false;
  if (status === "empty" && row.branch_product_count > 0) return false;
  if (search) {
    const q = search.toLowerCase();
    const hay = `${row.name} ${row.name_en ?? ""} ${row.slug}`.toLowerCase();
    if (!hay.includes(q) && !headingSlug(hay).includes(headingSlug(q))) return false;
  }
  return true;
}
