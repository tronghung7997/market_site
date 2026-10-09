"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import type { ConfigChangeRequest } from "@/lib/types";
import { Button, Tag, buttonClass } from "@/components/ui";
import { ArrowRight, Clock } from "@/components/Icons";
import { useToast } from "@/components/toast";
import { personLabel } from "../model";
import { useRefreshConfigChanges } from "../use-config-approval";
import { ChangeRows } from "./ChangeRows";

/** Shown on a settings panel while its section has a change waiting for a second admin. */
export function PendingChangeNotice({ request }: { request: ConfigChangeRequest | null }) {
  const t = useTranslations("adminConfigApproval");
  const locale = useLocale();
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const refresh = useRefreshConfigChanges();
  const cancel = useMutation({
    mutationFn: (id: number) => api.adminDecideConfigChange(id, "cancel"),
    onSuccess: () => { refresh(); toast.success(t("cancelled")); },
    onError: (err) => { refresh(); toast.error(apiErrorMessage(err, t("actionFailed"))); },
  });
  if (!request) return null;
  return (
    <section className="overflow-hidden rounded-card border border-warn/30 bg-card shadow-card" aria-labelledby={`pending-change-${request.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warn/25 bg-warn-soft px-5 py-3">
        <h2 id={`pending-change-${request.id}`} className="flex items-center gap-2 text-[13.5px] font-semibold text-warn">
          <Clock size={15} />{t("noticeTitle")}
          <Tag tone="warn">{request.section_label}</Tag>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {request.can_cancel && (
            <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(request.id)}>
              {t("cancel")}
            </Button>
          )}
          {request.can_approve && (
            <Link href={`/admin/config-changes?id=${request.id}`} className={buttonClass({ size: "sm" })}>
              {t("noticeOpen")} <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>
      <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-x-10">
        <div className="space-y-1 text-[12.5px]">
          <p className="text-muted">{t("requestedBy", { who: personLabel(request.requested_by), at: formatDateTime(request.requested_at, locale) })}</p>
          <p className="text-faint">{t("expires", { at: formatDateTime(request.expires_at, locale) })}</p>
          <p className="pt-1 text-fg"><span className="text-muted">{t("reasonLabel")}: </span>{request.reason}</p>
          {request.is_mine && <p className="pt-1 text-muted">{t("mineHint")}</p>}
        </div>
        <div className="min-w-0"><ChangeRows request={request} /></div>
      </div>
    </section>
  );
}
