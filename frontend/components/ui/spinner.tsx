"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function Spinner({ label, className, ...props }: SpinnerProps) {
  const t = useTranslations("common");
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2.5 py-14 text-slate-500",
        className
      )}
      {...props}
    >
      <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-200 border-t-indigo-600 animate-spin" />
      <span className="text-[13px]">{label ?? t("loading")}</span>
    </div>
  );
}
