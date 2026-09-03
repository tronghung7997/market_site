"use client";

import { Link } from "@/i18n/navigation";
import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { requestPasswordReset } from "@/features/auth-password";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Card, Field, Input } from "@/components/ui";
import { Logo } from "@/components/Icons";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const apiErrorMessage = useApiErrorMessage();
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email, locale);
      setAck(true);
    } catch (err) {
      setError(apiErrorMessage(err, t("forgotFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[380px] p-7">
        <div className="flex flex-col items-center gap-3 mb-7 text-center">
          <Logo withName={false} />
          <h2 className="font-serif text-[26px] tracking-tight">{t("forgotTitle")}</h2>
          <p className="text-[13px] text-muted">{t("forgotSubtitle")}</p>
        </div>
        {ack ? (
          <p className="text-[13px] text-fg text-center leading-relaxed">{t("forgotAck")}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label={t("email")}>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
            </Field>
            {error && <p className="text-bad text-[13px]" role="alert">{error}</p>}
            <Button type="submit" block size="lg" disabled={busy}>{busy ? t("forgotSubmitting") : t("forgotSubmit")}</Button>
          </form>
        )}
        <p className="text-center text-[13px] text-muted mt-6">
          <Link href="/login" className="text-iris-hi hover:underline">{t("backToLogin")}</Link>
        </p>
      </Card>
    </div>
  );
}
