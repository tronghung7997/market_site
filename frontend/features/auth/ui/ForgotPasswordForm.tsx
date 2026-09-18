"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Field, Input } from "@/components/ui";
import { validateEmail } from "../model/password";
import { AuthNotice } from "./AuthNotice";
import { AuthShell } from "./AuthShell";
import { TurnstileWidget, useCaptchaGate } from "./TurnstileWidget";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const captcha = useCaptchaGate(captchaToken);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const issue = validateEmail(email);
    if (issue) { setFieldError(issue === "required" ? t("emailRequired") : t("emailInvalid")); return; }
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim(), locale, captchaToken ?? undefined);
      setSentTo(email.trim());
    } catch (err) {
      setError(apiErrorMessage(err, t("forgotFailed")));
      setCaptchaToken(null);
      setCaptchaReset((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  const backLink = <Link href="/login" className="font-medium text-iris-hi hover:underline">{t("backToLogin")}</Link>;

  if (sentTo) {
    return (
      <AuthShell title={t("forgotSentTitle")} footer={backLink}>
        <AuthNotice tone="good">{t("forgotAck", { email: sentTo })}</AuthNotice>
        <p className="mt-4 text-[13px] leading-relaxed text-muted">{t("forgotSentHint")}</p>
        <Button variant="secondary" block className="mt-5" onClick={() => { setSentTo(null); setEmail(""); }}>
          {t("forgotTryAnother")}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("forgotTitle")} subtitle={t("forgotSubtitle")} footer={backLink}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t("email")} error={fieldError}>
          <Input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setFieldError(undefined); }}
            placeholder="you@company.com"
            autoComplete="email"
            aria-invalid={Boolean(fieldError)}
            autoFocus
          />
        </Field>
        <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaReset} />
        {error && <AuthNotice tone="bad">{error}</AuthNotice>}
        <Button type="submit" block size="lg" disabled={busy || !captcha.ready} className="mt-1">
          {busy ? t("forgotSubmitting") : t("forgotSubmit")}
        </Button>
      </form>
    </AuthShell>
  );
}
