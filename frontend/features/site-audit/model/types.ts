export const SURFACES = ["public", "buyer", "seller", "admin"] as const;
export const GATES = ["semantic", "a11y", "perf", "seo", "security"] as const;
export const SEVERITIES = ["p0", "p1", "p2"] as const;
export const BASELINES = ["pass", "fail", "unknown", "na"] as const;
export const VERDICTS = ["pass", "fail", "skip"] as const;

export type Surface = (typeof SURFACES)[number];
export type Gate = (typeof GATES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Baseline = (typeof BASELINES)[number];
export type Verdict = (typeof VERDICTS)[number];
export type ItemStatus = Verdict | "open" | "na";

export type AuditItem = {
  id: string;
  surface: Surface;
  gate: Gate;
  severity: Severity;
  title: string;
  check: string;
  routes: string[];
  evidence: string;
  baseline: Baseline;
};

export type AuditStore = {
  version: 1;
  updatedAt: string | null;
  verdicts: Record<string, Verdict>;
  notes: Record<string, string>;
};

export type AuditSummary = {
  total: number;
  open: number;
  pass: number;
  fail: number;
  skip: number;
  na: number;
};
