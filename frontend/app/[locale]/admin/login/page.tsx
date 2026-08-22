"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Logo } from "@/components/Icons";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { isValidEmail, PASSWORD_MAX_LENGTH } from "@/lib/auth-validation";
import { safeInternalRedirect } from "@/lib/safe-redirect";
import { useApiErrorMessage } from "@/lib/use-api-error";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="py-20"><Spinner /></div>}>
      <AdminLoginForm />
    </Suspense>
  );
}

function AdminLoginForm() {
  const t = useTranslations("auth");
  const apiErrorMessage = useApiErrorMessage();
  const { account, adminLogin, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = safeInternalRedirect(searchParams.get("next"));
  const next = requestedNext === "/admin" || requestedNext?.startsWith("/admin/")
    ? requestedNext
    : "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(
    searchParams.get("expired") ? t("sessionExpired") : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && account?.roles.includes("admin")) router.replace(next);
  }, [account, loading, next, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = t("emailRequired");
    else if (!isValidEmail(email)) errors.email = t("emailInvalid");
    if (!password) errors.password = t("passwordRequired");
    else if (password.length > PASSWORD_MAX_LENGTH) {
      errors.password = t("passwordTooLong", { max: PASSWORD_MAX_LENGTH });
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      await adminLogin(email.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(apiErrorMessage(err, t("loginFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[380px] p-7">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo withName={false} />
          <h1 className="font-serif text-[26px] tracking-tight">{t("adminLoginTitle")}</h1>
          <p className="text-[13px] text-muted">{t("adminLoginSubtitle")}</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label={t("email")} error={fieldErrors.email}>
            <Input type="email" required value={email} onChange={(event) => {
              setEmail(event.target.value);
              setFieldErrors((current) => ({ ...current, email: undefined }));
            }} placeholder="admin@company.com" autoComplete="username" aria-invalid={Boolean(fieldErrors.email)} />
          </Field>
          <Field label={t("password")} error={fieldErrors.password}>
            <Input type="password" required value={password} onChange={(event) => {
              setPassword(event.target.value);
              setFieldErrors((current) => ({ ...current, password: undefined }));
            }} placeholder="••••••••••••" autoComplete="current-password" aria-invalid={Boolean(fieldErrors.password)} />
          </Field>
          {error && <p className="text-bad text-[13px]" role="alert">{error}</p>}
          <Button type="submit" block size="lg" disabled={busy}>
            {busy ? t("adminSigningIn") : t("adminLoginTitle")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
