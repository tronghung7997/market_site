"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "@/components/Icons";
import { Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { passwordStrength } from "../model/password";

/** Password field with a show/hide toggle and, for new passwords, a strength meter. */
export function PasswordInput({
  id,
  value,
  onChange,
  label,
  error,
  hint,
  autoComplete,
  placeholder = "••••••••",
  showStrength = false,
  trailing,
  autoFocus,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string;
  hint?: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  showStrength?: boolean;
  /** Rendered on the label row's right (e.g. "Forgot password?"). */
  trailing?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const t = useTranslations("auth");
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? passwordStrength(value) : 0;
  const strengthLabel = [t("strength0"), t("strength1"), t("strength2"), t("strength3"), t("strength4")][strength];
  const strengthTone = ["bg-line-2", "bg-bad", "bg-warn", "bg-iris", "bg-good"][strength];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-[13px] font-medium text-muted">{label}</label>
        {trailing}
      </div>
      <div className="relative">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={showStrength && value ? `${inputId}-strength` : undefined}
          className="pr-11"
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40"
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          aria-pressed={visible}
          title={visible ? t("hidePassword") : t("showPassword")}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {showStrength && value && (
        <div id={`${inputId}-strength`} className="flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((step) => (
              <span key={step} className={cn("h-1 flex-1 rounded-full transition-colors", step <= strength ? strengthTone : "bg-line")} />
            ))}
          </div>
          <span className="w-[72px] text-right text-[11.5px] text-muted">{strengthLabel}</span>
        </div>
      )}
      {error
        ? <span className="text-[12px] text-bad" role="alert">{error}</span>
        : hint && <span className="text-[12px] text-faint">{hint}</span>}
    </div>
  );
}
