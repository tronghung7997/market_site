"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { BCRYPT_MAX_BYTES, isCommonPassword, isValidEmail, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordBytes } from "@/lib/auth-validation";
import { getCookie } from "@/lib/utils";
import { safeInternalRedirect } from "@/lib/safe-redirect";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { Logo } from "@/components/Icons";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth-validation";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="py-20"><Spinner /></div>}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const t = useTranslations("auth");
  const apiErrorMessage = useApiErrorMessage();
  const { register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeInternalRedirect(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { email?: string; password?: string; confirmPassword?: string } = {};
    if (!email.trim()) errors.email = t("emailRequired");
    else if (!isValidEmail(email)) errors.email = t("emailInvalid");
    if (!password) errors.password = t("passwordRequired");
    else if (password.length < PASSWORD_MIN_LENGTH) errors.password = t("passwordMin", { min: PASSWORD_MIN_LENGTH });
    else if (password.length > PASSWORD_MAX_LENGTH) errors.password = t("passwordTooLong", { max: PASSWORD_MAX_LENGTH });
    else if (passwordBytes(password) > BCRYPT_MAX_BYTES) errors.password = t("passwordByteLimit", { max: BCRYPT_MAX_BYTES });
    else if (isCommonPassword(password)) errors.password = t("passwordCommon");
    if (!confirmPassword) errors.confirmPassword = t("confirmPasswordRequired");
    else if (confirmPassword !== password) errors.confirmPassword = t("passwordMismatch");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const ref = getCookie("aff_ref");
      await register(email.trim(), password, ref ?? undefined);
      router.push(next || "/");
    } catch (err) {
      setError(apiErrorMessage(err, t("registerFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[380px] p-7">
        <div className="flex flex-col items-center gap-3 mb-7 text-center">
          <Logo withName={false} />
          <h2 className="font-serif text-[26px] tracking-tight">{t("registerTitle")}</h2>
          <p className="text-[13px] text-muted">{t("registerSubtitle")}</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("email")}><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" /></Field>
          <Field label={t("password")} hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}><Input type="password" required minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></Field>
          {error && <p className="text-bad text-[13px]">{error}</p>}
          <Button type="submit" block size="lg" disabled={busy}>{busy ? t("creating") : t("registerTitle")}</Button>
        </form>
        <p className="text-center text-[13px] text-muted mt-6">
          {t("hasAccount")} <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-iris-hi hover:underline">{t("loginTitle")}</Link>
        </p>
      </Card>
    </div>
  );
}
