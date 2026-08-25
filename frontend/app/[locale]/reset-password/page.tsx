"use client";

import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import {
  PASSWORD_MIN_LENGTH,
  confirmPasswordReset,
  validateResetPassword,
} from "@/features/auth-password";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { Logo } from "@/components/Icons";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="py-20"><Spinner /></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(token ? null : t("resetInvalid"));
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const issueCopy: Record<string, string> = {
    required: t("passwordRequired"),
    min: t("passwordMin", { min: PASSWORD_MIN_LENGTH }),
    mismatch: t("passwordMismatch"),
    byte: t("passwordByteLimit", { max: 72 }),
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const issue = validateResetPassword(password, confirm);
    if (issue) {
      setError(issueCopy[issue] ?? t("resetFailed"));
      return;
    }
    if (!token) {
      setError(t("resetInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(token, password);
      setAck(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("resetFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[380px] p-7">
        <div className="flex flex-col items-center gap-3 mb-7 text-center">
          <Logo withName={false} />
          <h2 className="font-serif text-[26px] tracking-tight">{t("resetTitle")}</h2>
          <p className="text-[13px] text-muted">{t("resetSubtitle")}</p>
        </div>
        {ack ? (
          <p className="text-[13px] text-fg text-center leading-relaxed">{t("resetAck")}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label={t("password")} hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </Field>
            <Field label={t("confirmPassword")}>
              <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </Field>
            {error && <p className="text-bad text-[13px]">{error}</p>}
            <Button type="submit" block size="lg" disabled={busy || !token}>{busy ? t("resetSubmitting") : t("resetSubmit")}</Button>
          </form>
        )}
        <p className="text-center text-[13px] text-muted mt-6">
          <Link href="/login" className="text-iris-hi hover:underline">{t("backToLogin")}</Link>
        </p>
      </Card>
    </div>
  );
}
