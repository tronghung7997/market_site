"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getCookie } from "@/lib/utils";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { Logo } from "@/components/Icons";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="py-20"><Spinner /></div>}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const ref = getCookie("aff_ref");
      await register(email, password, ref ?? undefined);
      router.push(next || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng ký thất bại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[380px] p-7">
        <div className="flex flex-col items-center gap-3 mb-7 text-center">
          <Logo withName={false} />
          <h2 className="font-serif text-[26px] tracking-tight">Tạo tài khoản</h2>
          <p className="text-[13px] text-muted">Mở tài khoản doanh nghiệp trong vài phút.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@congty.com" autoComplete="email" /></Field>
          <Field label="Mật khẩu" hint="Tối thiểu 8 ký tự"><Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></Field>
          {error && <p className="text-bad text-[13px]">{error}</p>}
          <Button type="submit" block size="lg" disabled={busy}>{busy ? "Đang tạo…" : "Tạo tài khoản"}</Button>
        </form>
        <p className="text-center text-[13px] text-muted mt-6">
          Đã có tài khoản? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-iris-hi hover:underline">Đăng nhập</Link>
        </p>
      </Card>
    </div>
  );
}
