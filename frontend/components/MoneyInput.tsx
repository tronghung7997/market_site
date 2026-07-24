"use client";

/* Hallmark · component: money-input · genre: modern-minimal · theme: hệ token sẵn có (iris/surface)
 * states: default · hover · focus · active · disabled · loading(n/a) · error(aria-invalid) · success(n/a)
 * Ô nhập TIỀN dùng chung toàn site. Lý do tồn tại: mọi chỗ nhập tiền từng là
 * <Input type="number"> trần — người Việt gõ "100000" không tách hàng nghìn
 * rất dễ thừa/thiếu một số 0 khi số tiền 6-8 chữ số. Component này:
 *   - hiển thị phân tách hàng nghìn kiểu VN ngay khi gõ (100000 → 100.000)
 *   - chốt hậu tố ₫ để không lẫn với các ô số lượng/ngày
 *   - số mono tabular, thẳng cột với mọi số tiền khác trên site
 * API giữ nguyên thói quen cũ (state string + parseInt) để chuyển đổi rẻ:
 * `value` là CHUỖI SỐ THÔ ("100000"), onValueChange trả về chuỗi số thô.
 */

import { useId } from "react";
import { cn } from "@/lib/cn";

interface MoneyInputProps {
  value: string;
  onValueChange: (raw: string) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  hint?: string;
  invalid?: boolean;
  className?: string;
  autoFocus?: boolean;
}

function formatDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("vi-VN");
}

export function MoneyInput({
  value, onValueChange, placeholder, disabled, label, hint, invalid, className, autoFocus,
}: MoneyInputProps) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <label htmlFor={id} className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          value={formatDisplay(value)}
          onChange={(e) => onValueChange(e.target.value.replace(/\D/g, ""))}
          placeholder={placeholder ?? "0"}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            "h-10 w-full rounded-lg bg-surface border border-line pl-3 pr-9 text-sm text-fg",
            "font-mono tabular-nums text-right",
            "placeholder:text-faint placeholder:font-sans placeholder:text-left",
            "transition-colors focus:border-iris focus:bg-panel",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            invalid && "border-bad focus:border-bad",
          )}
        />
        <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-faint font-medium select-none">
          ₫
        </span>
      </div>
      {hint && <p className="mt-1 text-[11px] text-faint">{hint}</p>}
    </div>
  );
}
