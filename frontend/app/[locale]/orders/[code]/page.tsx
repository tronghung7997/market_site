/** /orders/ORD-XXXXXXXX (or a legacy /orders/123) — redirects to the filtered list. */
"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui";

const ORDER_REF = /^(\d+|(ORD-)?[0-9A-Za-z]{8})$/;

export default function OrderDetailRedirect() {
  const t = useTranslations("orders");
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params?.code;

  useEffect(() => {
    if (!code) return;
    router.replace(ORDER_REF.test(code) ? `/orders?order=${encodeURIComponent(code)}` : "/orders");
  }, [code, router]);

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-20">
      <Spinner label={t("opening")} />
    </div>
  );
}
