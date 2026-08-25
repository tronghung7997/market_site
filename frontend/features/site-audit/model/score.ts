import type { AuditItem, AuditStore, AuditSummary, Baseline, Gate, ItemStatus, Severity, Surface, Verdict } from "./types.ts";

export function emptyStore(): AuditStore {
  return { version: 1, updatedAt: null, verdicts: {}, notes: {} };
}

export function statusOf(item: AuditItem, store: AuditStore): ItemStatus {
  const verdict = store.verdicts[item.id];
  if (verdict) return verdict;
  if (item.baseline === "na") return "na";
  return "open";
}

export function summarize(items: AuditItem[], store: AuditStore): AuditSummary {
  const summary: AuditSummary = { total: items.length, open: 0, pass: 0, fail: 0, skip: 0, na: 0 };
  for (const item of items) {
    summary[statusOf(item, store)] += 1;
  }
  return summary;
}

export function parseStore(raw: unknown): AuditStore {
  if (!raw || typeof raw !== "object") return emptyStore();
  const record = raw as Record<string, unknown>;
  const verdicts: AuditStore["verdicts"] = {};
  const notes: AuditStore["notes"] = {};
  if (record.verdicts && typeof record.verdicts === "object") {
    for (const [id, value] of Object.entries(record.verdicts as Record<string, unknown>)) {
      if (value === "pass" || value === "fail" || value === "skip") verdicts[id] = value;
    }
  }
  if (record.notes && typeof record.notes === "object") {
    for (const [id, value] of Object.entries(record.notes as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) notes[id] = value;
    }
  }
  return {
    version: 1,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    verdicts,
    notes,
  };
}

export type AuditFilters = {
  query: string;
  surface: Surface | "all";
  gate: Gate | "all";
  severity: Severity | "all";
  status: ItemStatus | "all";
  baseline: Baseline | "all";
};

export function defaultFilters(): AuditFilters {
  return {
    query: "",
    surface: "all",
    gate: "all",
    severity: "all",
    status: "all",
    baseline: "all",
  };
}

export function filterItems(items: AuditItem[], store: AuditStore, filters: AuditFilters): AuditItem[] {
  const q = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.surface !== "all" && item.surface !== filters.surface) return false;
    if (filters.gate !== "all" && item.gate !== filters.gate) return false;
    if (filters.severity !== "all" && item.severity !== filters.severity) return false;
    if (filters.baseline !== "all" && item.baseline !== filters.baseline) return false;
    if (filters.status !== "all" && statusOf(item, store) !== filters.status) return false;
    if (!q) return true;
    const hay = `${item.id} ${item.title} ${item.check} ${item.evidence} ${item.routes.join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
}

