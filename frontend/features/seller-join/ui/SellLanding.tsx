"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { FeeConfigPublic, SellerTierRule } from "@/lib/types";
import { Card } from "@/components/ui";
import {
  ArrowRight, BarChart, Check, ChevronDown, Inbox, Layers, MessageCircle, Package, ShieldCheck, TrendingUp, X,
} from "@/components/Icons";
import { useHoldLabel } from "@/lib/hold";

const TOOLS = [
  { key: "stock", icon: Package },
  { key: "api", icon: Layers },
  { key: "orders", icon: Inbox },
  { key: "messages", icon: MessageCircle },
  { key: "payouts", icon: BarChart },
  { key: "tiers", icon: TrendingUp },
] as const;
const PROCESS = ["apply", "review", "sell"] as const;
const RULES = ["identity", "shop", "goods"] as const;
const BANNED = ["stolen", "malware", "payments", "piracy", "resale"] as const;
const FAQ = ["review", "payout", "dispute", "api", "tier"] as const;
const TIER_ORDER = ["new", "verified", "trusted", "enterprise"] as const;

const ctaClass = "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium transition-colors";

export function SellLanding({ fees, tiers }: { fees: FeeConfigPublic | null; tiers: SellerTierRule[] }) {
  const t = useTranslations("sell");
  const ts = useTranslations("sellers");
  const holdLabel = useHoldLabel();
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const { account } = useAuth();
  const isSeller = !!account?.roles.includes("seller");
  const cta = isSeller
    ? { href: "/seller", label: t("ctaSeller") }
    : account
      ? { href: "/seller/apply", label: t("ctaApply") }
      : { href: "/login?next=/seller/apply", label: t("ctaLogin") };

  const money = (vnd: number) => formatLedgerMoney(vnd, locale);
  const withdrawFee = fees
    ? [fees.withdraw_fee_fixed > 0 ? money(fees.withdraw_fee_fixed) : null, fees.withdraw_fee_percent > 0 ? `${fees.withdraw_fee_percent}%` : null]
      .filter(Boolean).join(" + ") || null
    : null;
  const feeValue = (fee: number) => (fee > 0 ? t("feeTable.platformFeeValue", { fee }) : t("feeTable.platformFeeNone"));
  // The shortest hold an order can get: the platform floor or the admin minimum, whichever is higher.
  const minHold = fees ? Math.max(fees.escrow_floor_hours ?? 0, fees.escrow_min_hours) : 0;
  const holdValue = (hours: number, min: number) =>
    min > 0 ? t("feeTable.holdValue", { hold: holdLabel(hours), min: holdLabel(min) }) : t("feeTable.holdValueNoMin", { hold: holdLabel(hours) });
  const sortedTiers = [...tiers].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));

  return (
    <div className="w-full">
      <section className="aura border-b border-line">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center lg:py-14">
          <div className="max-w-[620px]">
            <h1 className="font-serif text-[clamp(2rem,4vw,3rem)] leading-[1.08] tracking-tight font-semibold">{t("title")}</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">{t("lead")}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={cta.href} className={cn(ctaClass, "bg-iris text-white hover:brightness-110")}>{cta.label} <ArrowRight size={16} /></Link>
              <a href="#fees" className={cn(ctaClass, "border border-line-2 bg-raised text-fg hover:border-faint")}>{t("ctaFees")}</a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {(["free", "reviewed", "escrow"] as const).map((key) => (
                <li key={key} className="flex items-center gap-1.5 text-[13.5px]"><Check size={15} className="text-good" /> {t(`points.${key}`)}</li>
              ))}
            </ul>
          </div>
          <Card className="p-5">
            <h2 className="text-[14px] font-semibold">{t("processTitle")}</h2>
            <ol className="mt-4 space-y-4">
              {PROCESS.map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[12px] font-semibold">{i + 1}</span>
                  <span>
                    <span className="block text-[13.5px] font-medium">{t(`process.${step}.title`)}</span>
                    <span className="block text-[12.5px] leading-relaxed text-muted">{t(`process.${step}.body`)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] space-y-12 px-4 py-10 sm:px-6">
        <section aria-labelledby="sell-tools">
          <h2 id="sell-tools" className="font-serif text-[22px] font-semibold tracking-tight">{t("toolsTitle")}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map(({ key, icon: Icon }) => (
              <Card key={key} className="p-5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-iris-soft text-iris-hi"><Icon size={16} /></span>
                <h3 className="mt-3 text-[14px] font-medium">{t(`tools.${key}.title`)}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(`tools.${key}.body`)}</p>
              </Card>
            ))}
          </div>
        </section>

        <section id="fees" aria-labelledby="sell-fees" className="scroll-mt-24">
          <h2 id="sell-fees" className="font-serif text-[22px] font-semibold tracking-tight">{t("feesTitle")}</h2>
          <p className="mt-1.5 max-w-[680px] text-[13.5px] text-muted">{t("feesLead")}</p>
          {fees ? (
            <>
              <ol className="mt-5 grid gap-3 md:grid-cols-4">
                {([
                  ["pay", "body", {}],
                  ["hold", minHold > 0 ? "body" : "bodyNoMin", { hold: holdLabel(fees.escrow_default_hours), min: holdLabel(minHold) }],
                  ["credit", fees.platform_fee_percent > 0 ? "body" : "bodyNoFee", { fee: fees.platform_fee_percent }],
                  ["withdraw", "body", {
                    min: fees.withdraw_min_amount > 0 ? t("flow.withdraw.minFrom", { amount: money(fees.withdraw_min_amount) }) : t("flow.withdraw.minNone"),
                    fee: withdrawFee ? t("flow.withdraw.feeIs", { fee: withdrawFee }) : t("flow.withdraw.feeNone"),
                  }],
                ] as const).map(([step, body, values], i) => (
                  <li key={step} className="rounded-card border border-line bg-surface p-4">
                    <span className="font-mono text-[12px] font-semibold text-faint">{String(i + 1).padStart(2, "0")}</span>
                    <h3 className="mt-1 text-[14px] font-medium">{t(`flow.${step}.title`, values)}</h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t(`flow.${step}.${body}`, values)}</p>
                  </li>
                ))}
              </ol>
              <Card className="mt-4 overflow-hidden">
                <dl className="divide-y divide-line text-[13px]">
                  {[
                    [t("feeTable.platformFee"), feeValue(fees.platform_fee_percent)],
                    [t("feeTable.hold"), holdValue(fees.escrow_default_hours, minHold)],
                    [t("feeTable.withdrawMin"), fees.withdraw_min_amount > 0 ? money(fees.withdraw_min_amount) : t("feeTable.none")],
                    [t("feeTable.withdrawFee"), withdrawFee ?? t("feeTable.free")],
                    [t("feeTable.disputeResponse"), fees.dispute_seller_response_hours > 0
                      ? t("feeTable.disputeResponseValue", { hours: fees.dispute_seller_response_hours })
                      : t("feeTable.disputeResponseOff")],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
                      <dt className="text-muted">{label}</dt>
                      <dd className="text-right font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </>
          ) : (
            <p className="mt-4 text-[13px] text-muted">{t("feesUnavailable")}</p>
          )}
        </section>

        {sortedTiers.length > 0 && (
          <section aria-labelledby="sell-tiers">
            <h2 id="sell-tiers" className="font-serif text-[22px] font-semibold tracking-tight">{t("tiersTitle")}</h2>
            <p className="mt-1.5 text-[13.5px] text-muted">{t("tiersLead")}</p>
            <Card className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="border-b border-line bg-raised/40 text-left text-[12px] text-muted">
                  <tr>
                    {(["tier", "products", "withdraw", "fee", "hold"] as const).map((col) => (
                      <th key={col} scope="col" className={cn("px-4 py-2.5 font-medium", col !== "tier" && "text-right")}>{t(`tierColumns.${col}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sortedTiers.map((tier) => (
                    <tr key={tier.tier}>
                      <th scope="row" className="px-4 py-3 text-left font-medium">{ts(`tier_${tier.tier}` as "tier_new")}</th>
                      <td className="px-4 py-3 text-right font-mono tabular">{tier.max_active_products ?? t("unlimited")}</td>
                      <td className="px-4 py-3 text-right font-mono tabular">{tier.withdraw_limit_per_request != null ? money(tier.withdraw_limit_per_request) : t("unlimited")}</td>
                      <td className="px-4 py-3 text-right font-mono tabular">{tier.fee_percent != null ? `${tier.fee_percent}%` : fees ? `${fees.platform_fee_percent}%` : t("none")}</td>
                      <td className="px-4 py-3 text-right font-mono tabular">{tier.escrow_reduction_hours > 0 ? t("days", { value: holdLabel(tier.escrow_reduction_hours) }) : t("none")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        )}

        <section aria-labelledby="sell-rules" className="grid gap-5 lg:grid-cols-2">
          <div>
            <h2 id="sell-rules" className="font-serif text-[22px] font-semibold tracking-tight">{t("rulesTitle")}</h2>
            <ul className="mt-4 space-y-3">
              {RULES.map((rule) => (
                <li key={rule} className="flex gap-3">
                  <ShieldCheck size={17} className="mt-0.5 shrink-0 text-good" />
                  <span>
                    <span className="block text-[14px] font-medium">{t(`rules.${rule}.title`)}</span>
                    <span className="block text-[13px] leading-relaxed text-muted">{t(`rules.${rule}.body`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-card border border-bad/25 bg-bad-soft/50 p-5">
            <h2 className="text-[15px] font-semibold">{t("bannedTitle")}</h2>
            <ul className="mt-3 space-y-2">
              {BANNED.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[13px] leading-relaxed">
                  <X size={14} className="mt-0.5 shrink-0 text-bad" />
                  <span>{t(`banned.${item}`)}</span>
                </li>
              ))}
            </ul>
            <Link href="/legal/terms" className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-fg underline underline-offset-2 hover:no-underline">
              {t("termsLink")} <ArrowRight size={13} />
            </Link>
          </div>
        </section>

        <section aria-labelledby="sell-faq">
          <h2 id="sell-faq" className="font-serif text-[22px] font-semibold tracking-tight">{t("faqTitle")}</h2>
          <Card className="mt-4 overflow-hidden">
            <ul className="divide-y divide-line">
              {FAQ.map((item) => (
                <li key={item}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[14px] font-medium hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris [&::-webkit-details-marker]:hidden">
                      <span>{t(`faq.${item}.q`)}</span>
                      <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="-mt-1 max-w-[760px] px-5 pb-4 text-[13.5px] leading-relaxed text-muted">{t(`faq.${item}.a`)}</p>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section className="rounded-card border border-line bg-surface px-5 py-8 text-center sm:px-8">
          <h2 className="font-serif text-[24px] font-semibold tracking-tight">{t("finalTitle")}</h2>
          <p className="mx-auto mt-2 max-w-[520px] text-[14px] text-muted">{t("finalBody")}</p>
          <Link href={cta.href} className={cn(ctaClass, "mt-5 bg-iris text-white hover:brightness-110")}>{cta.label} <ArrowRight size={16} /></Link>
        </section>
      </div>
    </div>
  );
}
