"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth-validation";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Field, Input, Tag } from "@/components/ui";
import { Copy, ShieldCheck } from "@/components/Icons";
import { validateEmail, validateNewPassword } from "../model/password";
import { AuthNotice } from "./AuthNotice";
import { PasswordInput } from "./PasswordInput";

type Msg = { tone: "good" | "bad" | "info"; text: string } | null;

export function Section({ title, hint, children, aside }: { title: string; hint: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
          <p className="mt-0.5 max-w-[60ch] text-[12.5px] leading-relaxed text-muted">{hint}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ── Password ────────────────────────────────────────────────────────────────

export function ChangePasswordSection() {
  const t = useTranslations("security");
  const ta = useTranslations("auth");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ next?: string; confirm?: string }>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    const issue = validateNewPassword(next);
    if (issue === "required") errs.next = ta("passwordRequired");
    else if (issue === "min") errs.next = ta("passwordMin", { min: PASSWORD_MIN_LENGTH });
    else if (issue === "max") errs.next = ta("passwordTooLong", { max: 128 });
    else if (issue === "byte") errs.next = ta("passwordByteLimit", { max: 72 });
    if (confirm !== next) errs.confirm = ta("passwordMismatch");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setMsg(null);
    try {
      await api.changePassword(current, next, locale);
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ tone: "good", text: t("passwordChanged") });
    } catch (err) {
      setMsg({ tone: "bad", text: apiErrorMessage(err, t("passwordChangeFailed")) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t("passwordTitle")} hint={t("passwordHint")}>
      <form onSubmit={submit} className="grid gap-4 sm:max-w-[420px]" noValidate>
        <PasswordInput label={t("currentPassword")} value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordInput label={ta("newPassword")} value={next} onChange={(v) => { setNext(v); setErrors((c) => ({ ...c, next: undefined })); }} autoComplete="new-password" error={errors.next} showStrength hint={ta("passwordHint", { min: PASSWORD_MIN_LENGTH })} />
        <PasswordInput label={ta("confirmPassword")} value={confirm} onChange={(v) => { setConfirm(v); setErrors((c) => ({ ...c, confirm: undefined })); }} autoComplete="new-password" error={errors.confirm} />
        {msg && <AuthNotice tone={msg.tone}>{msg.text}</AuthNotice>}
        <div>
          <Button type="submit" disabled={busy || !current || !next || !confirm}>{busy ? t("saving") : t("passwordSubmit")}</Button>
        </div>
      </form>
    </Section>
  );
}

// ── Email ───────────────────────────────────────────────────────────────────

export function ChangeEmailSection({ currentEmail }: { currentEmail: string }) {
  const t = useTranslations("security");
  const ta = useTranslations("auth");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const issue = validateEmail(email);
    if (issue) { setEmailError(issue === "required" ? ta("emailRequired") : ta("emailInvalid")); return; }
    setBusy(true); setMsg(null);
    try {
      await api.changeEmail(email.trim(), password, locale);
      setMsg({ tone: "good", text: t("emailSent", { email: email.trim() }) });
      setEmail(""); setPassword("");
    } catch (err) {
      setMsg({ tone: "bad", text: apiErrorMessage(err, t("emailChangeFailed")) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t("emailTitle")} hint={t("emailHint", { email: currentEmail })}>
      <form onSubmit={submit} className="grid gap-4 sm:max-w-[420px]" noValidate>
        <Field label={t("newEmail")} error={emailError}>
          <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(undefined); }} placeholder="new@company.com" autoComplete="off" aria-invalid={Boolean(emailError)} />
        </Field>
        <PasswordInput label={t("confirmWithPassword")} value={password} onChange={setPassword} autoComplete="current-password" />
        {msg && <AuthNotice tone={msg.tone}>{msg.text}</AuthNotice>}
        <div>
          <Button type="submit" variant="secondary" disabled={busy || !email || !password}>{busy ? t("sending") : t("emailSubmit")}</Button>
        </div>
      </form>
    </Section>
  );
}

// ── Two-factor ──────────────────────────────────────────────────────────────

export function TwoFactorSection({ enabled, autoStart, onChanged }: { enabled: boolean; autoStart: boolean; onChanged: () => Promise<void> }) {
  const t = useTranslations("security");
  const apiErrorMessage = useApiErrorMessage();
  const [step, setStep] = useState<"idle" | "password" | "scan" | "done" | "disable" | "regen">(autoStart && !enabled ? "password" : "idle");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reset = () => { setStep("idle"); setPassword(""); setSetup(null); setCode(""); setMsg(null); };

  const startSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      setSetup(await api.totpSetup(password));
      setPassword("");
      setStep("scan");
    } catch (err) {
      setMsg({ tone: "bad", text: apiErrorMessage(err, t("totpSetupFailed")) });
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await api.totpEnable(code);
      setBackupCodes(res.backup_codes);
      setStep("done");
      setCode("");
      await onChanged();
    } catch (err) {
      setMsg({ tone: "bad", text: apiErrorMessage(err, t("totpCodeInvalid")) });
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api.totpDisable(password, code);
      reset();
      setMsg({ tone: "good", text: t("totpDisabled") });
      await onChanged();
    } catch (err) {
      setMsg({ tone: "bad", text: apiErrorMessage(err, t("totpCodeInvalid")) });
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await api.totpBackupCodes(code);
      setBackupCodes(res.backup_codes);
      setStep("done");
      setCode("");
    } catch (err) {
      setMsg({ tone: "bad", text: apiErrorMessage(err, t("totpCodeInvalid")) });
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    if (!backupCodes) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const codeInput = (
    <Field label={t("totpCodeLabel")}>
      <Input value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z-]/g, "").slice(0, 16))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="font-mono text-[18px] tracking-[0.25em] sm:max-w-[220px]" autoFocus />
    </Field>
  );

  const statusTag = enabled ? <Tag tone="good">{t("totpOn")}</Tag> : <Tag tone="warn">{t("totpOff")}</Tag>;

  return (
    <Section title={t("totpTitle")} hint={t("totpHint")} aside={statusTag}>
      {msg && step === "idle" && <div className="mb-4"><AuthNotice tone={msg.tone}>{msg.text}</AuthNotice></div>}

      {step === "idle" && (
        <div className="flex flex-wrap gap-2">
          {enabled ? (
            <>
              <Button variant="secondary" onClick={() => { setStep("regen"); setMsg(null); }}>{t("totpRegenerate")}</Button>
              <Button variant="ghost" onClick={() => { setStep("disable"); setMsg(null); }}>{t("totpDisable")}</Button>
            </>
          ) : (
            <Button onClick={() => { setStep("password"); setMsg(null); }}>
              <ShieldCheck size={15} className="mr-1.5" />{t("totpEnable")}
            </Button>
          )}
        </div>
      )}

      {step === "password" && (
        <form onSubmit={startSetup} className="grid gap-4 sm:max-w-[420px]" noValidate>
          <p className="text-[13px] text-muted">{t("totpStepPassword")}</p>
          <PasswordInput label={t("confirmWithPassword")} value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          {msg && <AuthNotice tone={msg.tone}>{msg.text}</AuthNotice>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !password}>{busy ? t("saving") : t("continue")}</Button>
            <Button type="button" variant="ghost" onClick={reset}>{t("cancel")}</Button>
          </div>
        </form>
      )}

      {step === "scan" && setup && (
        <form onSubmit={confirmSetup} className="grid gap-5" noValidate>
          <ol className="grid gap-4 text-[13px] leading-relaxed text-muted sm:grid-cols-[auto_1fr] sm:items-start">
            <li className="sm:row-span-2">
              <div className="inline-block rounded-lg border border-line bg-surface p-3">
                <QRCodeSVG value={setup.otpauth_uri} size={168} level="M" />
              </div>
            </li>
            <li>
              <span className="font-medium text-fg">{t("totpStepScanTitle")}</span> — {t("totpStepScan")}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-line bg-raised px-2 py-1 font-mono text-[12.5px] tracking-wider text-fg">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                <span className="text-[12px] text-faint">{t("totpSecretHint")}</span>
              </div>
            </li>
            <li>
              <span className="font-medium text-fg">{t("totpStepCodeTitle")}</span> — {t("totpStepCode")}
              <div className="mt-2">{codeInput}</div>
            </li>
          </ol>
          {msg && <AuthNotice tone={msg.tone}>{msg.text}</AuthNotice>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length < 6}>{busy ? t("saving") : t("totpConfirm")}</Button>
            <Button type="button" variant="ghost" onClick={reset}>{t("cancel")}</Button>
          </div>
        </form>
      )}

      {step === "done" && backupCodes && (
        <div className="grid gap-4">
          <AuthNotice tone="good">{t("totpEnabledNotice")}</AuthNotice>
          <div>
            <p className="text-[13px] font-medium text-fg">{t("backupTitle")}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("backupHint")}</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-line bg-raised/50 p-4 font-mono text-[13px] tabular-nums text-fg sm:grid-cols-[repeat(2,max-content)]">
              {backupCodes.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={copyCodes}><Copy size={14} className="mr-1.5" />{copied ? t("copied") : t("copyCodes")}</Button>
            <Button variant="ghost" onClick={() => { setBackupCodes(null); reset(); }}>{t("backupSaved")}</Button>
          </div>
        </div>
      )}

      {step === "disable" && (
        <form onSubmit={disable} className="grid gap-4 sm:max-w-[420px]" noValidate>
          <p className="text-[13px] text-muted">{t("totpDisableHint")}</p>
          <PasswordInput label={t("confirmWithPassword")} value={password} onChange={setPassword} autoComplete="current-password" />
          {codeInput}
          {msg && <AuthNotice tone={msg.tone}>{msg.text}</AuthNotice>}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={busy || !password || code.length < 6}>{busy ? t("saving") : t("totpDisable")}</Button>
            <Button type="button" variant="ghost" onClick={reset}>{t("cancel")}</Button>
          </div>
        </form>
      )}

      {step === "regen" && (
        <form onSubmit={regenerate} className="grid gap-4 sm:max-w-[420px]" noValidate>
          <p className="text-[13px] text-muted">{t("totpRegenerateHint")}</p>
          {codeInput}
          {msg && <AuthNotice tone={msg.tone}>{msg.text}</AuthNotice>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length < 6}>{busy ? t("saving") : t("totpRegenerate")}</Button>
            <Button type="button" variant="ghost" onClick={reset}>{t("cancel")}</Button>
          </div>
        </form>
      )}
    </Section>
  );
}

// ── Sessions ────────────────────────────────────────────────────────────────

export function SessionsSection() {
  const t = useTranslations("security");
  const { logout } = useAuth();
  const apiErrorMessage = useApiErrorMessage();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const signOutAll = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.logoutAll();
      logout();
    } catch (err) {
      setMsg({ tone: "bad", text: apiErrorMessage(err, t("sessionsFailed")) });
      setBusy(false);
    }
  };

  return (
    <Section title={t("sessionsTitle")} hint={t("sessionsHint")}>
      {msg && <div className="mb-3"><AuthNotice tone={msg.tone}>{msg.text}</AuthNotice></div>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={signOutAll}>{busy ? t("saving") : t("sessionsSignOutAll")}</Button>
        <span className="text-[12.5px] text-faint">{t("sessionsNote")}</span>
      </div>
    </Section>
  );
}
