"use client";

/** "Get your shop ready" steps on the overview. Hidden once every step is
 *  done, or when the seller hides it on this browser; `fallback` then
 *  renders in its place. */

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { SellerDashboardInventory } from "@/lib/types";
import { Card, ProgressBar } from "@/components/ui";
import { ArrowRight, Check, X } from "@/components/Icons";
import { nextOnboardingStep, onboardingDismissKey, onboardingSteps } from "../onboarding";

function readHidden(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}

export function OnboardingChecklist({ inventory, fallback = null }: { inventory: SellerDashboardInventory; fallback?: ReactNode }) {
  const t = useTranslations("sellerDashboard.onboarding");
  const { account } = useAuth();
  const profile = useQuery({ queryKey: ["me", "seller-profile"], queryFn: api.mySellerProfile, staleTime: 60_000 });
  // Unknown until the browser's saved choice is read; nothing renders meanwhile.
  const [hidden, setHidden] = useState<boolean | null>(null);
  const dismissKey = account ? onboardingDismissKey(account.id) : null;

  useEffect(() => {
    setHidden(dismissKey ? readHidden(dismissKey) : true);
  }, [dismissKey]);

  if (hidden === null) return null;
  if (!account || hidden) return fallback;
  const steps = onboardingSteps({ inventory, profile: profile.data ?? null, account });
  const next = nextOnboardingStep(steps);
  if (!next) return fallback;
  const done = steps.filter((step) => step.done).length;

  const hide = () => {
    setHidden(true);
    try { if (dismissKey) window.localStorage.setItem(dismissKey, "1"); } catch { /* hiding is a convenience only */ }
  };

  return (
    <Card className="p-5" role="region" aria-labelledby="seller-onboarding-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="seller-onboarding-title" className="text-[14px] font-semibold">{t("title")}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">{t("progress", { done, total: steps.length })}</p>
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label={t("hide")}
          title={t("hide")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>
      <ProgressBar value={done} max={steps.length} label={t("title")} className="mt-3" />
      <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((step, i) => {
          const current = step.key === next.key;
          const body = (
            <>
              <span className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                step.done ? "border-good bg-good text-white" : current ? "border-iris text-iris-hi" : "border-line-2 text-faint",
              )}>
                {step.done ? <Check size={12} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13px] font-medium", step.done && "text-muted")}>{t(`steps.${step.key}.title`)}</span>
                {!step.done && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{t(`steps.${step.key}.body`)}</span>}
              </span>
              {!step.done && <ArrowRight size={14} className={cn("mt-1 shrink-0", current ? "text-iris-hi" : "text-faint")} />}
            </>
          );
          const box = cn(
            "flex items-start gap-3 rounded-lg border px-3.5 py-3",
            step.done ? "border-line bg-raised/30" : current ? "border-iris/40 bg-iris-soft" : "border-line bg-surface",
          );
          return (
            <li key={step.key}>
              {step.done
                ? <div className={box}><span className="sr-only">{t("done")}: </span>{body}</div>
                : <Link href={step.href} className={cn(box, "transition-colors hover:border-iris/60")}>{body}</Link>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
