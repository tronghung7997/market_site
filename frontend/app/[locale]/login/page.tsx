"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { isValidEmail, PASSWORD_MAX_LENGTH } from "@/lib/auth-validation";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { AlertCircle, Eye, EyeOff, Logo, ShieldCheck } from "@/components/Icons";
import { authenticatedLoginRedirect } from "@/lib/safe-redirect";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="py-20"><Spinner /></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const isVi = locale === "vi";
  const rawShow = t("showPassword");
  const showPasswordLabel = rawShow.startsWith("auth.") ? (isVi ? "Hiện mật khẩu" : "Show password") : rawShow;
  const rawHide = t("hidePassword");
  const hidePasswordLabel = rawHide.startsWith("auth.") ? (isVi ? "Ẩn mật khẩu" : "Hide password") : rawHide;
  const rawSecure = t("secureLogin");
  const secureLoginLabel = rawSecure.startsWith("auth.") ? (isVi ? "Kết nối bảo mật mã hóa SSL" : "SSL encrypted secure connection") : rawSecure;

  const apiErrorMessage = useApiErrorMessage();
  const { account, loading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const authenticatedDestination = account
    ? authenticatedLoginRedirect(next, account.roles)
    : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(
    searchParams.get("expired") ? t("sessionExpired") : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && authenticatedDestination) router.replace(authenticatedDestination);
  }, [authenticatedDestination, loading, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = t("emailRequired");
    else if (!isValidEmail(email)) errors.email = t("emailInvalid");
    if (!password) errors.password = t("passwordRequired");
    else if (password.length > PASSWORD_MAX_LENGTH) errors.password = t("passwordTooLong", { max: PASSWORD_MAX_LENGTH });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      const me = await api.me();
      router.replace(authenticatedLoginRedirect(next, me.roles));
    } catch (err) {
      setError(apiErrorMessage(err, t("loginFailed")));
    } finally {
      setBusy(false);
    }
  };

  if (loading || account) {
    return <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center"><Spinner /></div>;
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12 aura">
      <div className="w-full max-w-[400px]">
        <Card className="p-7 sm:p-8 shadow-card border border-line">
          <div className="flex flex-col items-center mb-7 text-center">
            <div className="mb-4">
              <Logo withName={false} />
            </div>
            <h1 className="font-serif text-[26px] font-semibold text-fg tracking-tight">
              {t("loginTitle")}
            </h1>
            <p className="text-[13px] text-muted mt-1 leading-normal">
              {t("loginSubtitle")}
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <Field label={t("email")} error={fieldErrors.email}>
              <Input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((current) => ({ ...current, email: undefined }));
                }}
                placeholder="you@company.com"
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
              />
            </Field>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-[13px] font-medium text-muted">
                  {t("password")}
                </label>
                {/* 
                  NOTE: Tạm ẩn chức năng quên mật khẩu vì hiện tại chưa có mail service để gửi email đặt lại mật khẩu.
                  Bật lại khi hạ tầng email đã sẵn sàng:
                  <Link
                    href="/forgot-password"
                    className="text-[12px] font-medium text-iris-hi hover:underline transition-colors"
                  >
                    {t("forgotPassword")}
                  </Link>
                */}
              </div>
              <div className="relative flex items-center">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((current) => ({ ...current, password: undefined }));
                  }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  aria-invalid={Boolean(fieldErrors.password)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-faint hover:text-fg focus-visible:text-iris focus-visible:outline-none transition-colors rounded cursor-pointer"
                  aria-label={showPassword ? hidePasswordLabel : showPasswordLabel}
                  title={showPassword ? hidePasswordLabel : showPasswordLabel}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {fieldErrors.password && (
                <span className="text-[12px] text-bad" role="alert">
                  {fieldErrors.password}
                </span>
              )}
            </div>

            {error && (
              <div
                className="flex items-start gap-2.5 p-3 rounded-lg bg-bad-soft border border-bad/20 text-bad text-[13px] leading-snug animate-rise"
                role="alert"
              >
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-bad" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              block
              size="lg"
              disabled={busy}
              className="mt-1 font-medium cursor-pointer"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin shrink-0" />
                  <span>{t("signingIn")}</span>
                </span>
              ) : (
                t("loginTitle")
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-line text-center text-[13px] text-muted">
            {t("noAccount")}{" "}
            <Link
              href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
              className="text-iris-hi font-medium hover:underline transition-colors"
            >
              {t("register")}
            </Link>
          </div>
        </Card>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-faint">
          <ShieldCheck size={14} className="text-good shrink-0" />
          <span>{secureLoginLabel}</span>
        </div>
      </div>
    </div>
  );
}
