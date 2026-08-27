"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { SellerApplication } from "@/lib/types";
import { Button, Card, Field, Input, Spinner, Tag, Textarea } from "@/components/ui";
import { Store } from "@/components/Icons";

const APPLY_POLL_MS = 10_000;

export default function SellerApplyPage() {
  const { account, loading, refresh } = useAuth();
  const router = useRouter();
  const t = useTranslations("seller");

  const [checking, setChecking] = useState(true);
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const app = await api.sellerApply({ business_name: businessName, description: description || undefined, contact: contact || undefined });
      setApplication(app);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (loading || checking) return <div className="py-20"><Spinner /></div>;
  if (!account || account.roles.includes("seller")) return null;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[440px] p-7">
        <div className="flex flex-col items-center gap-3 mb-7 text-center">
          <span className="grid place-items-center h-11 w-11 rounded-lg bg-iris/10 border border-iris/20">
            <Store size={20} className="text-iris-hi" />
          </span>
          <h2 className="font-serif text-[24px] tracking-tight">{t("applyTitle")}</h2>
          <p className="text-[13px] text-muted">{t("applySubtitle")}</p>
        </div>

        {application && application.status === "pending" && (
          <div className="rounded-lg border border-warn/25 bg-warn-soft px-4 py-3.5 text-center">
            <Tag tone="warn" className="mb-2">{t("pending")}</Tag>
            <p className="text-[13px] text-fg font-medium">{application.business_name}</p>
            <p className="text-[12px] text-muted mt-1">
              {t("pendingDescription", { date: formatDate(application.created_at) })}
            </p>
          </div>
        )}

        {application && application.status === "approved" && (
          <div className="rounded-lg border border-good/25 bg-good-soft px-4 py-3.5 text-center">
            <Tag tone="good" className="mb-2">{t("approved")}</Tag>
            <p className="text-[13px] text-fg font-medium">{application.business_name}</p>
            <p className="text-[12px] text-muted mt-1">{t("approvedDescription")}</p>
            <Button className="mt-3" size="md" onClick={() => { void refresh().then(() => router.push("/seller")); }}>
              {t("openWorkspace")}
            </Button>
          </div>
        )}

        {(!application || application.status === "rejected") && (
          <>
            {application?.status === "rejected" && (
              <div className="rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 mb-5 text-[13px]">
                <p className="font-medium text-bad">{t("rejected")}</p>
                {application.reject_reason && <p className="text-muted mt-1">{t("reason", { reason: application.reject_reason })}</p>}
                <p className="text-muted mt-1">{t("resubmit")}</p>
              </div>
            )}
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Field label={t("businessName")}><Input required value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder={t("businessPlaceholder")} /></Field>
              <Field label={t("description")} hint={t("descriptionHint")}>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} />
              </Field>
              <Field label={t("contact")} hint={t("contactHint")}><Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="telegram @yourshop" /></Field>
              {error && <p className="text-bad text-[13px]">{error}</p>}
              <Button type="submit" block size="lg" disabled={busy}>{busy ? t("submitting") : t("submit")}</Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
