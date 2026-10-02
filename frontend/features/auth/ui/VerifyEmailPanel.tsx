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
import { ResendVerificationButton } from "./ResendVerificationButton";
import { forgetPendingVerification, readPendingVerification } from "../model/pending-verification";

const RESEND_COOLDOWN_SECONDS = 60;
/** "Check your inbox" asks whether the link was confirmed (maybe on a phone). */
const CLAIM_POLL_MS = 4000;
const CLAIM_POLL_MAX_MS = 30 * 60 * 1000;

/**
 * `/verify-email`:
 * - with `?token=` → confirms the mailbox and shows the outcome;
 * - otherwise (right after sign-up, or from the banner) → "check your inbox"
 *   with a rate-limited resend button. A strict sign-up has no session yet,
 *   so that screen works from the address remembered for this tab.
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
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    setPendingEmail(readPendingVerification());
  }, []);

  useEffect(() => {
    if (!token || confirmedOnce.current || loading) return;
    // Signing in on confirmation re-mounts the app for the new account; the
    // link is single-use, so the re-mounted panel must not post it again.
    if (account?.email_verified) { setState("confirmed"); return; }
    confirmedOnce.current = true;
    api.verifyEmail(token)
      .then(async () => { forgetPendingVerification(); setState("confirmed"); await refresh(); })
      .catch(() => setState("invalid"));
  }, [token, refresh, loading, account]);

  // Strict sign-up waiting here with no session: once the link is confirmed —
  // in another tab or on a phone — this browser signs itself in.
  const waitingForLink = !token && !loading && !account && Boolean(pendingEmail);
  useEffect(() => {
    if (!waitingForLink) return;
    let stopped = false;
    const started = Date.now();
    let timer: number | undefined;
    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const claim = await api.claimSignupHandoff();
          if (stopped) return;
          if (claim.signed_in) { forgetPendingVerification(); await refresh(); return; }
          // Spent here — typically the link was opened in another tab of this
          // browser, which is now signed in: pick that session up.
          if (claim.status === "invalid") { await refresh(); return; }
        } catch { /* transient: keep waiting */ }
      }
      if (!stopped && Date.now() - started < CLAIM_POLL_MAX_MS) timer = window.setTimeout(poll, CLAIM_POLL_MS);
    };
    timer = window.setTimeout(poll, CLAIM_POLL_MS);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [waitingForLink, refresh]);

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
  const loginHref = (extra?: string) => {
    const params = new URLSearchParams(extra);
    if (next) params.set("next", next);
    const qs = params.toString();
    return qs ? `/login?${qs}` : "/login";
  };

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
        <AuthNotice tone="good">{account ? t("verifySignedInNotice") : t("verifyDoneNotice")}</AuthNotice>
        <div className="mt-5 flex flex-col gap-2">
          {account ? (
            <Button block size="lg" onClick={() => router.replace(continueHref)}>{t("verifyContinue")}</Button>
          ) : (
            <Link href={loginHref("verified=1")} className="block"><Button block size="lg">{t("loginTitle")}</Button></Link>
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
          ) : pendingEmail ? (
            <ResendVerificationButton email={pendingEmail} variant="primary" />
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
  if (!account && pendingEmail) {
    return (
      <AuthShell title={t("verifyPendingTitle")} subtitle={t("verifyPendingSubtitle", { email: pendingEmail })}>
        <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-muted">
          <li>{t("verifyStep1")}</li>
          <li>{t("verifyStep2")}</li>
          <li>{t("verifyStepAuto")}</li>
        </ol>
        <div className="mt-6 flex flex-col gap-2">
          <ResendVerificationButton email={pendingEmail} />
          <Link href={loginHref()} className="text-center text-[13px] font-medium text-iris-hi hover:underline">{t("verifyHaveConfirmed")}</Link>
        </div>
      </AuthShell>
    );
  }
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
