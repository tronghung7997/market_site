import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info } from "@/components/Icons";
import { cn } from "@/lib/cn";

const TONES = {
  bad: { box: "border-bad/20 bg-bad-soft text-bad", Icon: AlertCircle },
  good: { box: "border-good/25 bg-good-soft text-good", Icon: CheckCircle2 },
  info: { box: "border-iris/20 bg-iris-soft text-iris-hi", Icon: Info },
} as const;

/** Inline notice above the submit button; announced to screen readers. */
export function AuthNotice({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  const { box, Icon } = TONES[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border p-3 text-[13px] leading-snug", box)} role={tone === "bad" ? "alert" : "status"}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
