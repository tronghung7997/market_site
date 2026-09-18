"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth-validation";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button } from "@/components/ui";
import { validateNewPassword } from "../model/password";
import { AuthNotice } from "./AuthNotice";
import { AuthShell } from "./AuthShell";
import { PasswordInput } from "./PasswordInput";

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const { logout } = useAuth();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const backLink = <Link href="/login" className="font-medium text-iris-hi hover:underline">{t("backToLogin")}</Link>;

  if (!token) {
    return (
      <AuthShell title={t("resetTitle")} footer={backLink}>
        <AuthNotice tone="bad">{t("resetInvalid")}</AuthNotice>
        <Link href="/forgot-password" className="mt-5 block">
          <Button variant="secondary" block>{t("forgotTitle")}</Button>
        </Link>
      </AuthShell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { password?: string; confirm?: string } = {};
    const issue = validateNewPassword(password);
    if (issue === "required") errors.password = t("passwordRequired");
    else if (issue === "min") errors.password = t("passwordMin", { min: PASSWORD_MIN_LENGTH });
    else if (issue === "max") errors.password = t("passwordTooLong", { max: 128 });
    else if (issue === "byte") errors.password = t("passwordByteLimit", { max: 72 });
    if (!confirm) errors.confirm = t("confirmPasswordRequired");
    else if (confirm !== password) errors.confirm = t("passwordMismatch");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password, locale);
      // The backend revoked every session, including this browser's; drop
      // the cached account so the login page does not bounce us away.
      logout();
      router.replace("/login?reset=1");
    } catch (err) {
      setError(apiErrorMessage(err, t("resetFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t("resetTitle")} subtitle={t("resetSubtitle")} footer={backLink}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <PasswordInput
          label={t("newPassword")}
          value={password}
          onChange={(v) => { setPassword(v); setFieldErrors((c) => ({ ...c, password: undefined })); }}
          autoComplete="new-password"
          error={fieldErrors.password}
          hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
          showStrength
          autoFocus
        />
        <PasswordInput
          label={t("confirmPassword")}
          value={confirm}
          onChange={(v) => { setConfirm(v); setFieldErrors((c) => ({ ...c, confirm: undefined })); }}
          autoComplete="new-password"
          error={fieldErrors.confirm}
        />
        {error && <AuthNotice tone="bad">{error}</AuthNotice>}
        <Button type="submit" block size="lg" disabled={busy} className="mt-1">
          {busy ? t("resetSubmitting") : t("resetSubmit")}
        </Button>
        <p className="text-[12px] leading-relaxed text-faint">{t("resetSignsOutNote")}</p>
      </form>
    </AuthShell>
  );
}
