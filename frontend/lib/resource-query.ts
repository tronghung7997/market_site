import type { ResourceLineFilter, ResourceStatusFilter } from "@/lib/types";

/** Query parameters for a `ResourceLineFilter` — the same names on every
 *  stock-line endpoint (list, per-package export, multi-package export). */
export function resourceFilterParams(f: ResourceLineFilter, q = new URLSearchParams()): URLSearchParams {
  if (f.statuses?.length) q.set("statuses", f.statuses.join(","));
  if (f.archived === "only") q.set("archived_only", "true");
  else if (f.archived === "include") q.set("include_archived", "true");
  if (f.search?.trim()) q.set("search", f.search.trim());
  if (f.createdFrom) q.set("created_from", f.createdFrom);
  if (f.createdTo) q.set("created_to", f.createdTo);
  if (f.assignedFrom) q.set("assigned_from", f.assignedFrom);
  if (f.assignedTo) q.set("assigned_to", f.assignedTo);
  if (f.hasOrder === true || f.hasOrder === false) q.set("has_order", String(f.hasOrder));
  if (f.batch) q.set("batch", f.batch);
  return q;
}

/** The stock table's status tab as a line filter: "archived" is the hidden
 *  lines of any status, "all" every visible line. */
export function statusTabFilter(tab: ResourceStatusFilter | undefined): Pick<ResourceLineFilter, "statuses" | "archived"> {
  if (tab === "archived") return { archived: "only" };
  if (!tab || tab === "all") return {};
  return { statuses: [tab] };
}
