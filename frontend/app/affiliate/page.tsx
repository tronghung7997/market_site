"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Coins, MousePointerClick, ShoppingBag, Wallet as WalletIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useAffiliateMe } from "@/hooks/use-affiliate";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { AffiliateStatsView } from "@/components/AffiliateStatsView";

const STEPS = [
  { icon: MousePointerClick, title: "Chia sẻ liên kết", body: "Gửi liên kết giới thiệu của bạn cho khách qua Facebook, Zalo, website…" },
  { icon: ShoppingBag, title: "Khách mua hàng", body: "Khách vào qua link, đăng ký và đặt đơn được gắn với mã của bạn." },
  { icon: Coins, title: "Nhận hoa hồng", body: "Khi đơn hoàn tất, hoa hồng tự động cộng vào ví — sẵn sàng để rút." },
];

export default function AffiliatePage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading, refetch } = useAffiliateMe({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  });

  useEffect(() => {
    if (authLoading) return;
    if (!account) { router.push("/login"); return; }
  }, [account, authLoading, router]);

  if (authLoading || !account) {
    return <div className="grid place-items-center py-20"><Spinner /></div>;
  }

  return (
    <div className="w-full mx-auto max-w-[1000px] px-6 py-10">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] tracking-tight">Affiliate</h1>
          <p className="text-[13px] text-muted mt-1">Giới thiệu khách hàng, nhận hoa hồng vào ví.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
          <span className="text-muted text-sm">—</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
          <Button variant="secondary" size="sm" onClick={() => refetch()}>Lọc</Button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <div className="space-y-6">
          <AffiliateStatsView data={data} />

          {/* How it works + payout */}
          <Card className="p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
              <h2 className="text-[14px] font-semibold">Cách hoạt động</h2>
              <Link href="/wallet">
                <Button variant="secondary" size="sm">
                  <WalletIcon size={15} /> Rút hoa hồng từ ví
                </Button>
              </Link>
            </div>
            <div className="grid sm:grid-cols-3 gap-5">
              {STEPS.map((s, i) => (
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
