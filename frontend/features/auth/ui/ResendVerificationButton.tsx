"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button } from "@/components/ui";
import { AuthNotice } from "./AuthNotice";

const RESEND_COOLDOWN_SECONDS = 60;

/** Resend the confirmation link to an address that cannot sign in yet. The
 * backend answers the same for unknown addresses, so the copy never claims
 * the account exists. */
export function ResendVerificationButton({ email, variant = "secondary" }: { email: string; variant?: "primary" | "secondary" }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const resend = async () => {
    setSending(true);
    setMsg(null);
    try {
      await api.resendVerificationPublic(email, locale);
      setMsg({ tone: "good", text: t("verifyResent") });
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setMsg({ tone: "bad", text: apiErrorMessage(err, t("verifyResendFailed")) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" block size="lg" variant={variant} disabled={sending || cooldown > 0} onClick={resend}>
        {sending ? t("verifyResending") : cooldown > 0 ? t("verifyResendIn", { seconds: cooldown }) : t("verifyResend")}
      </Button>
      {msg && <AuthNotice tone={msg.tone}>{msg.text}</AuthNotice>}
    </div>
  );
}
