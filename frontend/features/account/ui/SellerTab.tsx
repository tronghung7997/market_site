"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { MySellerProfile } from "@/lib/types";
import { Input, Spinner, Tag, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ExternalLink } from "@/components/Icons";
import { Panel, Row, SaveBar } from "./shared";

type Form = { business_name: string; description: string; contact: string };
const toForm = (p: MySellerProfile): Form => ({ business_name: p.business_name, description: p.description ?? "", contact: p.contact ?? "" });

/** Shop identity sellers edit themselves (no re-approval) plus their tier and its allowances. */
export function SellerTab() {
  const t = useTranslations("account");
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ["me", "seller-profile"], queryFn: api.mySellerProfile });
  const tiers = useQuery({ queryKey: ["public-seller-tiers"], queryFn: api.sellerTiers, staleTime: 60_000 });
  const baseline = React.useMemo(() => (profile.data ? toForm(profile.data) : null), [profile.data]);
  const [form, setForm] = React.useState<Form | null>(null);
  React.useEffect(() => { if (baseline) setForm(baseline); }, [baseline]);

  const save = useMutation({
    mutationFn: (f: Form) => api.updateMySellerProfile({ business_name: f.business_name.trim(), description: f.description.trim(), contact: f.contact.trim() }),
    onSuccess: (next) => { queryClient.setQueryData(["me", "seller-profile"], next); toast.success(t("shopSaved")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("saveFailed"))),
  });

  if (profile.isError) return <p className="rounded-card border border-line bg-card p-5 text-[13px] text-bad">{t("loadFailed")}</p>;
  if (profile.isPending || !profile.data || !form || !baseline) return <div className="grid place-items-center py-16"><Spinner /></div>;
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const problem = form.business_name.trim().length < 2 ? t("shopNameShort") : form.description.length > 1000 ? t("shopBioLong") : undefined;
  const rule = tiers.data?.tiers.find((r) => r.tier === profile.data.seller_tier);
  const tierLabel = { new: t("tierNew"), verified: t("tierVerified"), trusted: t("tierTrusted"), enterprise: t("tierEnterprise") }[profile.data.seller_tier] ?? profile.data.seller_tier;

  return (
    <div className="space-y-5">
      <Panel
        title={t("shopTitle")}
        hint={t("shopHint")}
        aside={baseline.business_name ? <Link href={profile.data.canonical_path} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">{t("shopView")} <ExternalLink size={12} /></Link> : undefined}
      >
        <div className="space-y-4">
          <Row label={t("shopName")} hint={dirty && form.business_name.trim() !== baseline.business_name ? t("shopNameHandleNote") : t("shopNameHint")} error={form.business_name.trim().length < 2 ? t("shopNameShort") : undefined}>
            <Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} maxLength={255} />
          </Row>
          <Row label={t("shopBio")} hint={t("shopBioHint", { count: form.description.length })}>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} maxLength={1000} />
          </Row>
          <Row label={t("shopContact")} hint={t("shopContactHint")}>
            <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} maxLength={255} />
          </Row>
        </div>
        <SaveBar dirty={dirty} valid={!problem} problem={problem} saving={save.isPending} onReset={() => setForm(baseline)} onSave={() => save.mutate(form)} />
      </Panel>

      <Panel title={t("tierTitle")} hint={t("tierHint")} aside={<Tag tone={profile.data.seller_tier === "new" ? "neutral" : "good"}>{tierLabel}</Tag>}>
        {rule ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-[12px] text-muted">{t("tierProducts")}</dt><dd className="mt-0.5 font-mono text-[15px] font-semibold text-fg">{rule.max_active_products ?? t("unlimited")}</dd></div>
            <div><dt className="text-[12px] text-muted">{t("tierWithdraw")}</dt><dd className="mt-0.5 font-mono text-[15px] font-semibold text-fg">{rule.withdraw_limit_per_request != null ? rule.withdraw_limit_per_request.toLocaleString() + " ₫" : t("unlimited")}</dd></div>
            <div><dt className="text-[12px] text-muted">{t("tierFeeDiscount")}</dt><dd className="mt-0.5 font-mono text-[15px] font-semibold text-fg">{rule.fee_discount_pp ? `−${rule.fee_discount_pp} pp` : "—"}</dd></div>
            <div><dt className="text-[12px] text-muted">{t("tierEscrow")}</dt><dd className="mt-0.5 font-mono text-[15px] font-semibold text-fg">{rule.escrow_reduction_days ? t("tierEscrowDays", { days: rule.escrow_reduction_days }) : "—"}</dd></div>
          </dl>
        ) : (
          <p className="text-[12.5px] text-muted">{t("tierUnknown")}</p>
        )}
      </Panel>
    </div>
  );
}
