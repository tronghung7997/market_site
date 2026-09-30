"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/utils/format";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { SellerApplication } from "@/lib/types";
import { Spinner } from "@/components/ui";
import { Store } from "@/components/Icons";
import { ApplyStatus, ApplyWizard } from "@/features/seller-join";

const APPLY_POLL_MS = 10_000;

export default function SellerApplyPage() {
  const { account, loading, refresh } = useAuth();
  const router = useRouter();
  const t = useTranslations("seller");
  const locale = useLocale();

  const [checking, setChecking] = useState(true);
  const [application, setApplication] = useState<SellerApplication | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!account) {
      router.push("/login?next=/seller/apply");
      return;
    }
    if (account.roles.includes("seller")) {
      router.push("/seller");
      return;
    }
    api.mySellerApplication()
      .then(setApplication)
      .finally(() => setChecking(false));
  }, [account, loading, router]);

  useEffect(() => {
    if (loading || !account || account.roles.includes("seller")) return;
    if (application?.status !== "pending" && application?.status !== "approved") return;

    let cancelled = false;
    const syncApproved = async () => {
      await refresh();
      if (!cancelled) router.push("/seller");
    };

    if (application.status === "approved") {
      void syncApproved();
      return () => { cancelled = true; };
    }

    const poll = async () => {
      try {
        const latest = await api.mySellerApplication();
        if (cancelled) return;
        setApplication(latest);
        if (latest?.status === "approved") await syncApproved();
      } catch {
        // keep the pending state if the poll fails
      }
    };
    const interval = setInterval(poll, APPLY_POLL_MS);
    const onFocus = () => { void poll(); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [account, application?.status, loading, refresh, router]);

  if (loading || checking) return <div className="py-20"><Spinner /></div>;
  if (!account || account.roles.includes("seller")) return null;

  const openWorkspace = () => { void refresh().then(() => router.push("/seller")); };
  // Rejected or sent back for more: the applicant edits and sends again.
  const sent = application && application.status !== "rejected" && application.status !== "needs_info";

  return (
    <div className="px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-[680px]">
        <header className="mb-6 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-iris/20 bg-iris/10">
            <Store size={18} className="text-iris-hi" />
          </span>
          <div>
            <h1 className="font-serif text-[24px] tracking-tight">{t("applyTitle")}</h1>
            <p className="mt-0.5 text-[13px] text-muted">{sent ? t("apply.sentSubtitle") : t("applySubtitle")}</p>
          </div>
        </header>

        {application?.status === "rejected" && (
          <div role="status" className="mb-4 rounded-card border border-bad/25 bg-bad-soft px-4 py-3 text-[13px]">
            <p className="font-medium text-bad">{t("rejected")}</p>
            {application.reject_reason && <p className="mt-1 text-fg/85">{t("reason", { reason: application.reject_reason })}</p>}
            {application.resubmit_after && new Date(application.resubmit_after).getTime() > Date.now()
              ? <p className="mt-1 font-medium text-fg">{t("apply.resubmitAfter", { date: formatDateTime(application.resubmit_after, locale) })}</p>
              : <p className="mt-1 text-muted">{t("resubmit")}</p>}
          </div>
        )}

        {application?.status === "needs_info" && (
          <div role="status" className="mb-4 rounded-card border border-warn/25 bg-warn-soft px-4 py-3 text-[13px]">
            <p className="font-medium text-warn">{t("apply.needsInfoTitle")}</p>
            {application.info_request && <p className="mt-1 whitespace-pre-line text-fg/85">{application.info_request}</p>}
            {application.info_fields && application.info_fields.length > 0 && (
              <p className="mt-1 font-medium text-fg">
                {t("apply.needsInfoFields", { fields: application.info_fields.map((f) => t(`apply.infoFields.${f}`)).join(", ") })}
              </p>
            )}
            <p className="mt-1 text-muted">{t("apply.needsInfoHint")}</p>
          </div>
        )}

        {sent
          ? <ApplyStatus application={application} onOpenWorkspace={openWorkspace} />
          : <ApplyWizard accountId={account.id} previous={application} onSubmitted={setApplication} />}
      </div>
    </div>
  );
}
