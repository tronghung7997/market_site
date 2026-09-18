"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth-validation";
import { authenticatedLoginRedirect, safeInternalRedirect } from "@/lib/safe-redirect";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { validateEmail } from "../model/password";
import { AuthNotice } from "./AuthNotice";
import { AuthShell } from "./AuthShell";
import { PasswordInput } from "./PasswordInput";

export function LoginForm({ variant = "storefront" }: { variant?: "storefront" | "admin" }) {
  const t = useTranslations("auth");
  const apiErrorMessage = useApiErrorMessage();
  const { account, loading, login, adminLogin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const admin = variant === "admin";
  const requestedNext = searchParams.get("next");
  const next = admin
    ? (() => {
        const safe = safeInternalRedirect(requestedNext);
        return safe === "/admin" || safe?.startsWith("/admin/") ? safe : "/admin";
      })()
    : requestedNext;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(searchParams.get("expired") ? t("sessionExpired") : null);
  const [busy, setBusy] = useState(false);
  const justVerified = searchParams.get("verified") === "1";
  const justReset = searchParams.get("reset") === "1";

  const destination = account
    ? admin
      ? account.roles.includes("admin") ? next : null
      : authenticatedLoginRedirect(next, account.roles)
    : null;
  useEffect(() => {
    if (!loading && destination) router.replace(destination);
  }, [destination, loading, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { email?: string; password?: string } = {};
    const emailIssue = validateEmail(email);
    if (emailIssue) errors.email = emailIssue === "required" ? t("emailRequired") : t("emailInvalid");
    if (!password) errors.password = t("passwordRequired");
    else if (password.length > PASSWORD_MAX_LENGTH) errors.password = t("passwordTooLong", { max: PASSWORD_MAX_LENGTH });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      if (admin) {
        await adminLogin(email.trim(), password);
        router.replace(next ?? "/admin");
      } else {
        await login(email.trim(), password);
        const me = await api.me();
        router.replace(authenticatedLoginRedirect(next, me.roles));
      }
    } catch (err) {
      setError(apiErrorMessage(err, t("loginFailed")));
    } finally {
      setBusy(false);
    }
  };

  if (loading || destination) {
    return <div className="grid flex-1 place-items-center py-24"><Spinner /></div>;
  }

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <AuthShell
      variant={variant}
      title={admin ? t("adminLoginTitle") : t("loginTitle")}
      subtitle={admin ? t("adminLoginSubtitle") : t("loginSubtitle")}
      footer={admin ? undefined : (
        <>
          {t("noAccount")}{" "}
          <Link href={registerHref} className="font-medium text-iris-hi hover:underline">{t("register")}</Link>
        </>
      )}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {justVerified && <AuthNotice tone="good">{t("verifiedNowLogin")}</AuthNotice>}
        {justReset && <AuthNotice tone="good">{t("resetAck")}</AuthNotice>}
        <Field label={t("email")} error={fieldErrors.email}>
          <Input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setFieldErrors((c) => ({ ...c, email: undefined })); }}
            placeholder={admin ? "admin@company.com" : "you@company.com"}
            autoComplete={admin ? "username" : "email"}
            aria-invalid={Boolean(fieldErrors.email)}
            autoFocus
          />
        </Field>
        <PasswordInput
          label={t("password")}
          value={password}
          onChange={(v) => { setPassword(v); setFieldErrors((c) => ({ ...c, password: undefined })); }}
          autoComplete="current-password"
          error={fieldErrors.password}
          trailing={admin ? undefined : (
            <Link href="/forgot-password" className="text-[12px] font-medium text-iris-hi hover:underline">{t("forgotPassword")}</Link>
          )}
        />
        {error && <AuthNotice tone="bad">{error}</AuthNotice>}
        <Button type="submit" block size="lg" disabled={busy} className="mt-1">
          {busy ? (admin ? t("adminSigningIn") : t("signingIn")) : (admin ? t("adminLoginTitle") : t("loginTitle"))}
        </Button>
      </form>
    </AuthShell>
  );
}
