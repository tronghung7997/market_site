"use client";

/** Warns while a seller types a listing that it carries a phone number, an
 *  outside link or a restricted word — buyers reach shops only through GMMO,
 *  so this is said before saving instead of after. */

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { AlertTriangle } from "@/components/Icons";

export function ContactWarning({ text }: { text: string }) {
  const t = useTranslations("sellerProductForm.contactCheck");
  const debounced = useDebounce(text.trim(), 600);
  const check = useQuery({
    queryKey: ["seller-content-check", debounced],
    queryFn: () => api.sellerContentCheck(debounced.slice(0, 4000)),
    enabled: debounced.length >= 3,
    staleTime: 60_000,
    retry: false,
  });
  const matches = debounced === text.trim() ? check.data?.matches ?? [] : [];
  if (matches.length === 0) return null;
  const parts = matches.map((m) => (m === "phone" ? t("phone") : m === "link" ? t("link") : t("word", { word: m })));
  return (
    <p role="status" className="mt-1.5 flex items-start gap-1.5 text-[12px] font-medium text-warn">
      <AlertTriangle size={13} className="mt-px shrink-0" />
      <span>{t("found", { what: parts.join(", ") })}</span>
    </p>
  );
}
