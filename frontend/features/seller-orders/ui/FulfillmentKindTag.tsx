"use client";

import { useTranslations } from "next-intl";
import { Tag } from "@/components/ui";

const TONE = { instant: "good", manual: "warn", api: "iris", task: "warn", proxy: "iris" } as const;

/** How the order is fulfilled (instant stock / manual / API key / task / proxy). */
export function FulfillmentKindTag({ kind }: { kind: string }) {
  const t = useTranslations("sellerOrders");
  const known = kind in TONE ? (kind as keyof typeof TONE) : null;
  if (!known) return null;
  return <Tag tone={TONE[known]}>{t(`kind.${known}`)}</Tag>;
}
