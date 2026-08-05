"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Coins, MousePointerClick, ShoppingBag, Wallet as WalletIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useAffiliateMe } from "@/hooks/use-affiliate";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { AffiliateStatsView } from "@/components/AffiliateStatsView";

export default function AffiliatePage() {
  const t = useTranslations("affiliate");
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading, refetch } = useAffiliateMe({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  });

  const steps = [
    { icon: MousePointerClick, title: t("stepShareTitle"), body: t("stepShareBody") },
    { icon: ShoppingBag, title: t("stepBuyTitle"), body: t("stepBuyBody") },
    { icon: Coins, title: t("stepEarnTitle"), body: t("stepEarnBody") },
  ];

  useEffect(() => {
    if (authLoading) return;
    if (!account) {
      router.push("/login");
      return;
    }
  }, [account, authLoading, router]);

  if (authLoading || !account) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="w-full mx-auto max-w-[1000px] px-6 py-10">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] tracking-tight">{t("title")}</h1>
          <p className="text-[13px] text-muted mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
          <span className="text-muted text-sm">—</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            {t("filter")}
          </Button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid place-items-center py-20">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          <AffiliateStatsView data={data} />

          <Card className="p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
              <h2 className="text-[14px] font-semibold">{t("howItWorks")}</h2>
              <Link href="/wallet">
                <Button variant="secondary" size="sm">
                  <WalletIcon size={15} /> {t("withdrawFromWallet")}
                </Button>
              </Link>
            </div>
            <div className="grid sm:grid-cols-3 gap-5">
              {steps.map((s, i) => (
                <div key={i} className="flex gap-3">
                  <div className="shrink-0 grid place-items-center h-9 w-9 rounded-lg bg-iris-soft text-iris-hi">
                    <s.icon size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{s.title}</p>
                    <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
