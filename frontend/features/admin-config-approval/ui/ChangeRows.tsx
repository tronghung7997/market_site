"use client";

import { useTranslations } from "next-intl";
import type { ConfigChangeRequest } from "@/lib/types";
import { requestChanges } from "@/features/admin-logs";

/** The request's before → after values, labelled like the settings history. */
export function ChangeRows({ request }: { request: Pick<ConfigChangeRequest, "settings_event" | "diff" | "context"> }) {
  const t = useTranslations("adminConfigApproval");
  const rows = requestChanges(request);
  if (rows.length === 0) return <p className="text-[12.5px] text-faint">{t("noChanges")}</p>;
  // A list, not a table: long texts (announcement, links) wrap and phones stack label over values.
  return (
    <ul className="space-y-1.5 text-[12.5px]">
      {rows.map((c) => (
        <li key={c.key} className="grid gap-0.5 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)] sm:gap-3">
          <span className="text-muted">{c.label}</span>
          <span className="min-w-0 break-words">
            <span className="font-mono tabular-nums text-bad line-through decoration-bad/40">{c.before}</span>
            <span className="px-2 text-faint" aria-label="→">→</span>
            <span className="font-mono font-medium tabular-nums text-good">{c.after}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
