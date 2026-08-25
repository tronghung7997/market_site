"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { Banner, Button, Card, Input, Select, Tag, Textarea } from "@/components/ui";
import { Download, Search, Upload } from "@/components/Icons";
import {
  AUDIT_ITEMS,
  BASELINE_LABELS,
  GATE_LABELS,
  SEVERITY_LABELS,
  SURFACE_LABELS,
} from "../model/catalog";
import {
  defaultFilters,
  emptyStore,
  filterItems,
  parseStore,
  statusOf,
  summarize,
  type AuditFilters,
} from "../model/score";
import { loadStore, saveStore, setNote, setVerdict } from "../model/storage";
import type { AuditItem, AuditStore, Baseline, Gate, ItemStatus, Severity, Surface, Verdict } from "../model/types";

const STATUS_LABELS: Record<ItemStatus, string> = {
  open: "Còn mở",
  pass: "Đạt",
  fail: "Fail",
  skip: "Bỏ qua",
  na: "Nợ đã biết",
};

function severityTone(severity: Severity): "bad" | "warn" | "neutral" {
  if (severity === "p0") return "bad";
  if (severity === "p1") return "warn";
  return "neutral";
}

function statusTone(status: ItemStatus): "good" | "bad" | "warn" | "iris" | "neutral" {
  if (status === "pass") return "good";
  if (status === "fail") return "bad";
  if (status === "open") return "warn";
  if (status === "na") return "iris";
  return "neutral";
}

function baselineTone(baseline: Baseline): "good" | "bad" | "warn" | "iris" {
  if (baseline === "pass") return "good";
  if (baseline === "fail") return "bad";
  if (baseline === "na") return "iris";
  return "warn";
}

export function SiteAuditWorkbench() {
  const [store, setStore] = useState<AuditStore>(emptyStore);
  const [filters, setFilters] = useState<AuditFilters>(defaultFilters);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setStore(loadStore());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveStore(store);
  }, [ready, store]);

  const visible = useMemo(() => filterItems(AUDIT_ITEMS, store, filters), [store, filters]);
  const summary = useMemo(() => summarize(AUDIT_ITEMS, store), [store]);
  const visibleSummary = useMemo(() => summarize(visible, store), [visible, store]);

  const grouped = useMemo(() => {
    const groups: { surface: Surface; items: AuditItem[] }[] = [];
    for (const surface of Object.keys(SURFACE_LABELS) as Surface[]) {
      const items = visible.filter((item) => item.surface === surface);
      if (items.length) groups.push({ surface, items });
    }
    return groups;
  }, [visible]);

  const update = (next: AuditStore) => setStore(next);

  const exportJson = () => {
    const payload = {
      ...store,
      exportedAt: new Date().toISOString(),
      summary,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "proxora-site-audit.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = parseStore(JSON.parse(await file.text()));
      setStore({ ...parsed, updatedAt: new Date().toISOString() });
    } catch {
      /* keep current store */
    }
  };

  return (
    <div className="space-y-5">
      <Banner tone="iris">
        Workbook audit FE. Chấm trên browser thật. Cột baseline chỉ là gợi ý từ code, không thay cho kiểm tra live.
        Điểm lưu local trên máy này, không gửi server.
      </Banner>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Tổng mục" value={summary.total} />
        <Stat label="Còn mở" value={summary.open} tone="warn" />
        <Stat label="Đạt" value={summary.pass} tone="good" />
        <Stat label="Fail" value={summary.fail} tone="bad" />
        <Stat label="Bỏ qua" value={summary.skip} />
        <Stat label="Nợ đã biết" value={summary.na} tone="iris" />
      </div>

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <div className="relative min-w-0">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder="Tìm id, route, bằng chứng…"
              className="pl-9"
              aria-label="Tìm mục audit"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Select
              aria-label="Surface"
              value={filters.surface}
              onChange={(e) => setFilters({ ...filters, surface: e.target.value as AuditFilters["surface"] })}
            >
              <option value="all">Mọi surface</option>
              {(Object.keys(SURFACE_LABELS) as Surface[]).map((key) => (
                <option key={key} value={key}>{SURFACE_LABELS[key]}</option>
              ))}
            </Select>
            <Select
              aria-label="Gate"
              value={filters.gate}
              onChange={(e) => setFilters({ ...filters, gate: e.target.value as AuditFilters["gate"] })}
            >
              <option value="all">Mọi gate</option>
              {(Object.keys(GATE_LABELS) as Gate[]).map((key) => (
                <option key={key} value={key}>{GATE_LABELS[key]}</option>
              ))}
            </Select>
            <Select
              aria-label="Mức"
              value={filters.severity}
              onChange={(e) => setFilters({ ...filters, severity: e.target.value as AuditFilters["severity"] })}
            >
              <option value="all">Mọi mức</option>
              <option value="p0">P0</option>
              <option value="p1">P1</option>
              <option value="p2">P2</option>
            </Select>
            <Select
              aria-label="Trạng thái chấm"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as AuditFilters["status"] })}
            >
              <option value="all">Mọi trạng thái</option>
              {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((key) => (
                <option key={key} value={key}>{STATUS_LABELS[key]}</option>
              ))}
            </Select>
            <Select
              aria-label="Baseline"
              value={filters.baseline}
              onChange={(e) => setFilters({ ...filters, baseline: e.target.value as AuditFilters["baseline"] })}
            >
              <option value="all">Mọi baseline</option>
              {(Object.keys(BASELINE_LABELS) as Baseline[]).map((key) => (
                <option key={key} value={key}>{BASELINE_LABELS[key]}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[12px] text-muted">
              Đang xem {visible.length}/{AUDIT_ITEMS.length}
              {visible.length !== AUDIT_ITEMS.length && ` · mở ${visibleSummary.open}`}
              {store.updatedAt && ` · lưu ${new Date(store.updatedAt).toLocaleString("vi-VN")}`}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={() => setFilters(defaultFilters())}>
              Xóa lọc
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setStore(emptyStore())}>
              Xóa điểm
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={exportJson}>
              <Download size={14} /> Xuất JSON
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => {
              const picker = document.createElement("input");
              picker.type = "file";
              picker.accept = "application/json";
              picker.addEventListener("change", () => {
                const file = picker.files?.[0];
                if (file) void importJson(file);
              });
              picker.click();
            }}>
              <Upload size={14} /> Nhập JSON
            </Button>
          </div>
        </div>
      </Card>

      {grouped.length === 0 ? (
        <Card className="p-6 text-[13px] text-muted">Không có mục khớp bộ lọc.</Card>
      ) : (
        grouped.map((group) => (
          <section key={group.surface} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-serif text-[18px] font-semibold tracking-tight text-fg">
                {SURFACE_LABELS[group.surface]}
              </h2>
              <span className="text-[12px] text-faint">{group.items.length} mục</span>
            </div>
            <div className="space-y-2">
              {group.items.map((item) => (
                <AuditRow
                  key={item.id}
                  item={item}
                  store={store}
                  onVerdict={(verdict) => update(setVerdict(store, item.id, verdict))}
                  onNote={(note) => update(setNote(store, item.id, note))}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function routeTarget(route: string): { kind: "app" | "raw"; href: string } {
  if (
    route === "/en"
    || route === "/vi"
    || route.endsWith(".txt")
    || route.endsWith(".xml")
  ) {
    return { kind: "raw", href: route };
  }
  const stripped = route.replace(/^\/(vi|en)(?=\/|$)/, "") || "/";
  return { kind: "app", href: stripped };
}

function RouteChip({ route }: { route: string }) {
  const target = routeTarget(route);
  const className = "rounded-md border border-line bg-raised px-2 py-1 font-mono text-[11px] text-muted hover:border-line-2 hover:text-fg";
  if (target.kind === "raw") {
    return <a href={target.href} className={className}>{route}</a>;
  }
  return <Link href={target.href} className={className}>{route}</Link>;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad" | "warn" | "iris";
}) {
  const valueClass =
    tone === "good" ? "text-good"
    : tone === "bad" ? "text-bad"
    : tone === "warn" ? "text-warn"
    : tone === "iris" ? "text-iris-hi"
    : "text-fg";
  return (
    <Card className="px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={cn("mt-1 font-mono text-[22px] tabular leading-none", valueClass)}>{value}</div>
    </Card>
  );
}

function AuditRow({
  item,
  store,
  onVerdict,
  onNote,
}: {
  item: AuditItem;
  store: AuditStore;
  onVerdict: (verdict: Verdict | null) => void;
  onNote: (note: string) => void;
}) {
  const status = statusOf(item, store);
  const current = store.verdicts[item.id] ?? null;
  const note = store.notes[item.id] ?? "";

  return (
    <Card className="p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-faint">{item.id}</span>
            <Tag tone={severityTone(item.severity)}>{SEVERITY_LABELS[item.severity]}</Tag>
            <Tag>{GATE_LABELS[item.gate]}</Tag>
            <Tag tone={baselineTone(item.baseline)}>{BASELINE_LABELS[item.baseline]}</Tag>
            <Tag tone={statusTone(status)}>{STATUS_LABELS[status]}</Tag>
          </div>
          <h3 className="text-[14px] font-medium text-fg">{item.title}</h3>
          <p className="text-[13px] leading-relaxed text-muted">{item.check}</p>
          <p className="text-[12px] leading-relaxed text-faint">{item.evidence}</p>
          <div className="flex flex-wrap gap-1.5">
            {item.routes.map((route) => (
              <RouteChip key={route} route={route} />
            ))}
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 lg:w-[220px]">
          <div className="grid grid-cols-3 gap-1">
            <Button
              type="button"
              size="sm"
              variant={current === "pass" ? "primary" : "secondary"}
              onClick={() => onVerdict(current === "pass" ? null : "pass")}
            >
              Đạt
            </Button>
            <Button
              type="button"
              size="sm"
              variant={current === "fail" ? "danger" : "secondary"}
              onClick={() => onVerdict(current === "fail" ? null : "fail")}
            >
              Fail
            </Button>
            <Button
              type="button"
              size="sm"
              variant={current === "skip" ? "secondary" : "ghost"}
              className={current === "skip" ? "border border-line" : undefined}
              onClick={() => onVerdict(current === "skip" ? null : "skip")}
            >
              Bỏ
            </Button>
          </div>
          <label className="block">
            <span className="sr-only">Ghi chú {item.id}</span>
            <Textarea
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="Ghi chú live…"
              rows={3}
              className="min-h-[72px] text-[12.5px]"
            />
          </label>
        </div>
      </div>
    </Card>
  );
}
