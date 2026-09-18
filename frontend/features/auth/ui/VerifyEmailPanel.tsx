"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { safeInternalRedirect } from "@/lib/safe-redirect";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Spinner } from "@/components/ui";
import { AuthNotice } from "./AuthNotice";
import { AuthShell } from "./AuthShell";

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * `/verify-email`:
 * - with `?token=` → confirms the mailbox and shows the outcome;
 * - otherwise (right after sign-up, or from the banner) → "check your inbox"
 *   with a rate-limited resend button.
 */
export function VerifyEmailPanel() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const next = safeInternalRedirect(searchParams.get("next"));
  const { account, loading, refresh } = useAuth();

  const [state, setState] = useState<"idle" | "confirming" | "confirmed" | "invalid">(token ? "confirming" : "idle");
  const [resendMsg, setResendMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const confirmedOnce = useRef(false);

  useEffect(() => {
    if (!token || confirmedOnce.current) return;
    confirmedOnce.current = true;
    api.verifyEmail(token)
      .then(async () => { setState("confirmed"); await refresh(); })
      .catch(() => setState("invalid"));
  }, [token, refresh]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const resend = async () => {
    setResending(true);
    setResendMsg(null);
    try {
      await api.resendVerification(locale);
      setResendMsg({ tone: "good", text: t("verifyResent") });
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setResendMsg({ tone: "bad", text: apiErrorMessage(err, t("verifyResendFailed")) });
    } finally {
      setResending(false);
    }
  };

  const continueHref = next ?? "/";

  if (state === "confirming") {
    return (
      <AuthShell title={t("verifyConfirmingTitle")}>
        <div className="grid place-items-center py-8"><Spinner /></div>
      </AuthShell>
    );
  }

  if (state === "confirmed") {
    return (
      <AuthShell title={t("verifyDoneTitle")} subtitle={t("verifyDoneSubtitle")}>
        <AuthNotice tone="good">{t("verifyDoneNotice")}</AuthNotice>
        <div className="mt-5 flex flex-col gap-2">
          {account ? (
            <Button block size="lg" onClick={() => router.replace(continueHref)}>{t("verifyContinue")}</Button>
          ) : (
            <Link href="/login?verified=1" className="block"><Button block size="lg">{t("loginTitle")}</Button></Link>
          )}
        </div>
      </AuthShell>
    );
  }

  if (state === "invalid") {
    return (
      <AuthShell title={t("verifyInvalidTitle")} subtitle={t("verifyInvalidSubtitle")}>
        <AuthNotice tone="bad">{t("verifyInvalidNotice")}</AuthNotice>
        <div className="mt-5 flex flex-col gap-2">
          {account && !account.email_verified ? (
            <Button block size="lg" disabled={resending || cooldown > 0} onClick={resend}>
              {resending ? t("verifyResending") : cooldown > 0 ? t("verifyResendIn", { seconds: cooldown }) : t("verifyResend")}
            </Button>
          ) : (
            <Link href="/login" className="block"><Button block size="lg">{t("loginTitle")}</Button></Link>
          )}
          {resendMsg && <AuthNotice tone={resendMsg.tone}>{resendMsg.text}</AuthNotice>}
        </div>
      </AuthShell>
    );
  }

  // idle: "check your inbox"
  if (loading) return <div className="grid flex-1 place-items-center py-24"><Spinner /></div>;
  if (!account) {
    return (
      <AuthShell title={t("verifyPendingTitle")} subtitle={t("verifyPendingGuest")}>
        <Link href="/login" className="block"><Button block size="lg">{t("loginTitle")}</Button></Link>
      </AuthShell>
    );
  }
  if (account.email_verified) {
    return (
      <AuthShell title={t("verifyDoneTitle")}>
        <AuthNotice tone="good">{t("verifyAlreadyDone")}</AuthNotice>
        <Button block size="lg" className="mt-5" onClick={() => router.replace(continueHref)}>{t("verifyContinue")}</Button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t("verifyPendingTitle")} subtitle={t("verifyPendingSubtitle", { email: account.email })}>
      <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-muted">
        <li>{t("verifyStep1")}</li>
        <li>{t("verifyStep2")}</li>
        <li>{t("verifyStep3")}</li>
      </ol>
      <div className="mt-6 flex flex-col gap-2">
        <Button block size="lg" variant="secondary" disabled={resending || cooldown > 0} onClick={resend}>
          {resending ? t("verifyResending") : cooldown > 0 ? t("verifyResendIn", { seconds: cooldown }) : t("verifyResend")}
        </Button>
        {resendMsg && <AuthNotice tone={resendMsg.tone}>{resendMsg.text}</AuthNotice>}
        <Link href={continueHref} className="text-center text-[13px] font-medium text-iris-hi hover:underline">{t("verifyLater")}</Link>
      </div>
    </AuthShell>
  );
}
