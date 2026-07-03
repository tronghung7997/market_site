"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(searchParams.get("expired") ? "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại." : null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await login(email, password);
      const me = await api.me();
      router.push(next || (me.roles.includes("admin") ? "/admin" : me.roles.includes("seller") ? "/seller" : "/"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[380px] p-7">
        <div className="flex flex-col items-center gap-3 mb-7 text-center">
          <Logo withName={false} />
          <h2 className="font-serif text-[26px] tracking-tight">Đăng nhập</h2>
          <p className="text-[13px] text-muted">Chào mừng quay lại Proxora.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@congty.com" autoComplete="email" /></Field>
          <Field label="Mật khẩu"><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" /></Field>
          {error && <p className="text-bad text-[13px]">{error}</p>}
          <Button type="submit" block size="lg" disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</Button>
        </form>
        <p className="text-center text-[13px] text-muted mt-6">
          Chưa có tài khoản? <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="text-iris-hi hover:underline">Đăng ký</Link>
        </p>
      </Card>
    </div>
  );
}
