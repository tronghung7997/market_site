/** /orders/123 — redirects to filtered list. Locale-preserving via i18n router. */
"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui";

export default function OrderDetailRedirect() {
  const t = useTranslations("orders");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  useEffect(() => {
    if (!id) return;
    router.replace(/^\d+$/.test(id) ? `/orders?search=%23${id}` : "/orders");
  }, [id, router]);

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-20">
      <Spinner label={t("opening")} />
    </div>
  );
}
