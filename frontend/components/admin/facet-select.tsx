"use client";

import * as React from "react";
import { ChevronDown, ListFilter, Search, X } from "lucide-react";

// ============================================================
// FacetSelect — dropdown lọc theo một giá trị (người bán, người
// mua, nguồn hàng…) với ô tìm kiếm, số bản ghi từng giá trị và
// điều hướng bàn phím. Không thêm dependency; đóng khi click ra
// ngoài hoặc nhấn Escape.
// ============================================================

export interface FacetOption {
  key: string;
  label: string;
  count: number;
}

/**
 * Gom số bản ghi theo một chiều (facet) trong phạm vi items đang xét.
 * Giá trị đang được chọn luôn có mặt trong danh sách kể cả khi bị
 * cross-filter loại hết bản ghi (count 0) — để chip lọc không "mồ côi".
 */
export function buildFacetOptions<T>(
  items: T[],
  all: T[],
  selectedKey: string | null,
  getKey: (item: T) => string,
  getLabel: (item: T) => string | null | undefined
): FacetOption[] {
  const map = new Map<string, FacetOption>();
  for (const item of items) {
    const key = getKey(item);
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { key, label: getLabel(item) ?? key, count: 1 });
    }
  }
  if (selectedKey !== null && !map.has(selectedKey)) {
    const src = all.find((item) => getKey(item) === selectedKey);
    map.set(selectedKey, {
      key: selectedKey,
      label: src ? getLabel(src) ?? selectedKey : selectedKey,
      count: 0,
    });
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );
}

export function FacetSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FacetOption[];
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = value !== null ? options.find((o) => o.key === value) ?? null : null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  React.useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const pick = (key: string | null) => {
    onChange(key);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[highlight];
      if (o) pick(o.key);
    }
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <div
        className={`inline-flex h-9 items-stretch overflow-hidden rounded-lg border transition-colors ${
          selected
            ? "border-indigo-300 bg-indigo-50/60"
            : "border-slate-300 bg-white hover:border-slate-400"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`inline-flex items-center gap-1.5 px-3 text-[12.5px] font-medium ${
            selected ? "text-indigo-800" : "text-slate-600"
          }`}
        >
          <ListFilter size={14} className={selected ? "text-indigo-500" : "text-slate-400"} />
          {label}
          {selected && (
            <>
              <span className="text-indigo-300">·</span>
              <span className="max-w-[130px] truncate">{selected.label}</span>
            </>
          )}
          {!selected && <ChevronDown size={13} className="text-slate-400" />}
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => pick(null)}
            aria-label={`Bỏ lọc ${label.toLowerCase()}`}
            className="inline-flex items-center border-l border-indigo-200 px-1.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="relative border-b border-slate-100">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Tìm ${label.toLowerCase()}…`}
              className="h-9 w-full pl-9 pr-3 text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {!query.trim() && (
              <li>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-[12.5px] hover:bg-slate-50 ${
                    value === null ? "font-medium text-indigo-700" : "text-slate-500"
                  }`}
                >
                  Tất cả {label.toLowerCase()}
                </button>
              </li>
            )}
            {filtered.map((o, i) => (
              <li key={o.key} role="option" aria-selected={o.key === value}>
                <button
                  type="button"
                  onClick={() => pick(o.key)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12.5px] transition-colors ${
                    i === highlight ? "bg-slate-50" : ""
                  } ${o.key === value ? "font-medium text-indigo-700" : "text-slate-700"}`}
                >
                  <span className="truncate">{o.label}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-slate-400">
                    {o.count.toLocaleString("vi-VN")}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-[12px] text-slate-400">
                Không tìm thấy kết quả
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
