"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth-validation";
import { safeInternalRedirect } from "@/lib/safe-redirect";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { getCookie } from "@/lib/utils";
import { Button, Field, Input } from "@/components/ui";
import { validateEmail, validateNewPassword } from "../model/password";
import { AuthNotice } from "./AuthNotice";
import { AuthShell } from "./AuthShell";
import { PasswordInput } from "./PasswordInput";
import { TurnstileWidget, useCaptchaGate } from "./TurnstileWidget";

type Errors = { email?: string; password?: string; confirm?: string; terms?: string };

export function RegisterForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const { register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeInternalRedirect(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const captcha = useCaptchaGate(captchaToken);
  const clear = (key: keyof Errors) => setFieldErrors((c) => ({ ...c, [key]: undefined }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Errors = {};
    const emailIssue = validateEmail(email);
    if (emailIssue) errors.email = emailIssue === "required" ? t("emailRequired") : t("emailInvalid");
    const passwordIssue = validateNewPassword(password);
    if (passwordIssue === "required") errors.password = t("passwordRequired");
    else if (passwordIssue === "min") errors.password = t("passwordMin", { min: PASSWORD_MIN_LENGTH });
    else if (passwordIssue === "max") errors.password = t("passwordTooLong", { max: 128 });
    else if (passwordIssue === "byte") errors.password = t("passwordByteLimit", { max: 72 });
    if (!confirm) errors.confirm = t("confirmPasswordRequired");
    else if (confirm !== password) errors.confirm = t("passwordMismatch");
    if (!agreed) errors.terms = t("termsRequired");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      await register(email.trim(), password, getCookie("aff_ref") ?? undefined, locale, captchaToken ?? undefined);
      const params = new URLSearchParams({ sent: "1" });
      if (next) params.set("next", next);
      router.push(`/verify-email?${params.toString()}`);
    } catch (err) {
      setError(apiErrorMessage(err, t("registerFailed")));
      setCaptchaToken(null);
      setCaptchaReset((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <AuthShell
      title={t("registerTitle")}
      subtitle={t("registerSubtitle")}
      footer={
        <>
          {t("hasAccount")}{" "}
          <Link href={loginHref} className="font-medium text-iris-hi hover:underline">{t("loginTitle")}</Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t("email")} error={fieldErrors.email} hint={fieldErrors.email ? undefined : t("emailHint")}>
          <Input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clear("email"); }}
            placeholder="you@company.com"
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.email)}
            autoFocus
          />
        </Field>
        <PasswordInput
          label={t("password")}
          value={password}
          onChange={(v) => { setPassword(v); clear("password"); }}
          autoComplete="new-password"
          error={fieldErrors.password}
          hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
          showStrength
        />
        <PasswordInput
          label={t("confirmPassword")}
          value={confirm}
          onChange={(v) => { setConfirm(v); clear("confirm"); }}
          autoComplete="new-password"
          error={fieldErrors.confirm}
        />
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-muted">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => { setAgreed(e.target.checked); clear("terms"); }}
              aria-invalid={Boolean(fieldErrors.terms)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-2 text-iris focus-visible:ring-2 focus-visible:ring-iris/40"
            />
            <span>
              {t.rich("termsAgree", {
                terms: (chunks) => <Link href="/legal/terms" target="_blank" className="font-medium text-iris-hi hover:underline">{chunks}</Link>,
                privacy: (chunks) => <Link href="/legal/privacy" target="_blank" className="font-medium text-iris-hi hover:underline">{chunks}</Link>,
              })}
            </span>
          </label>
          {fieldErrors.terms && <span className="text-[12px] text-bad" role="alert">{fieldErrors.terms}</span>}
        </div>
        <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaReset} />
        {error && <AuthNotice tone="bad">{error}</AuthNotice>}
        <Button type="submit" block size="lg" disabled={busy || !captcha.ready} className="mt-1">
          {busy ? t("creating") : t("registerTitle")}
        </Button>
      </form>
    </AuthShell>
  );
}
