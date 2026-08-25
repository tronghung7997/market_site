"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { Logo } from "@/components/Icons";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="py-20"><Spinner /></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const t = useTranslations("auth");
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("expired") ? t("sessionExpired") : null,
  );
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await login(email, password);
      const me = await api.me();
      router.push(next || (me.roles.includes("admin") ? "/admin" : me.roles.includes("seller") ? "/seller" : "/"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[380px] p-7">
        <div className="flex flex-col items-center gap-3 mb-7 text-center">
          <Logo withName={false} />
          <h2 className="font-serif text-[26px] tracking-tight">{t("loginTitle")}</h2>
          <p className="text-[13px] text-muted">{t("loginSubtitle")}</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("email")}><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" /></Field>
          <Field label={t("password")}><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" /></Field>
          <p className="text-right -mt-2">
            <Link href="/forgot-password" className="text-[13px] text-iris-hi hover:underline">{t("forgotPassword")}</Link>
          </p>
          {error && <p className="text-bad text-[13px]">{error}</p>}
          <Button type="submit" block size="lg" disabled={busy}>{busy ? t("signingIn") : t("loginTitle")}</Button>
        </form>
        <p className="text-center text-[13px] text-muted mt-6">
          {t("noAccount")} <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="text-iris-hi hover:underline">{t("register")}</Link>
        </p>
      </Card>
    </div>
  );
}
