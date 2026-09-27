"use client";

/** Compact tier card on the seller overview: current tier, what is left for
 *  the next one, and the trust score, linking to the full page. */

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { Card } from "@/components/ui";
import { AlertTriangle, ArrowRight } from "@/components/Icons";
import { missingCriteria } from "../model";

export function TierProgressCard() {
  const t = useTranslations("seller.tier");
  const progress = useQuery({ queryKey: ["seller", "tier-progress"], queryFn: () => api.sellerTierProgress(), staleTime: 5 * 60_000 });
  const p = progress.data;
  if (!p) return null;
  const missing = missingCriteria(p.criteria);
  const need = p.criteria.find((row) => row.key === "min_score")?.target;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
          {t(`tiers.${p.tier}`)}
          {p.at_risk.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-normal text-warn"><AlertTriangle size={13} /> {t("atRiskShort")}</span>
          )}
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {!p.next_tier || !p.next_tier_promotable
            ? t("topTierShort")
            : p.eligible
              ? t("eligible", { tier: t(`tiers.${p.next_tier}`) })
              : t("missing", { count: missing.length, tier: t(`tiers.${p.next_tier}`) })}
          {missing.length > 0 && p.next_tier_promotable && (
            <span className="text-faint"> · {missing.map((row) => t(`criteriaShort.${row.key}`)).join(", ")}</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <p className="text-[11.5px] text-muted">{t("score")}</p>
          <p className="font-mono text-[18px] font-semibold tabular leading-tight">
            {p.score ?? "—"}
            {need != null && p.score != null && <span className="text-[11.5px] font-normal text-faint"> / {t("needShort", { need })}</span>}
          </p>
        </div>
        <Link href="/seller/tier" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">
          {t("details")} <ArrowRight size={13} />
        </Link>
      </div>
    </Card>
  );
}
