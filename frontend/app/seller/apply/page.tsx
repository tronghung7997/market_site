"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { SellerApplication } from "@/lib/types";
import { Button, Card, Field, Input, Spinner, Tag, Textarea } from "@/components/ui";
import { Store } from "@/components/Icons";

export default function SellerApplyPage() {
  const { account, loading } = useAuth();
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!account) {
      router.push("/login?next=/seller/apply");
      return;
    }
    if (account.roles.includes("seller")) {
      router.push("/seller");
      return;
    }
    api.mySellerApplication()
      .then(setApplication)
      .finally(() => setChecking(false));
  }, [account, loading, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const app = await api.sellerApply({ business_name: businessName, description: description || undefined, contact: contact || undefined });
      setApplication(app);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gửi đơn đăng ký thất bại");
    } finally {
      setBusy(false);
    }
  };

  if (loading || checking) return <div className="py-20"><Spinner /></div>;
  if (!account || account.roles.includes("seller")) return null;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-6 py-12 aura">
      <Card className="w-full max-w-[440px] p-7">
        <div className="flex flex-col items-center gap-3 mb-7 text-center">
          <span className="grid place-items-center h-11 w-11 rounded-lg bg-iris/10 border border-iris/20">
            <Store size={20} className="text-iris-hi" />
          </span>
          <h2 className="font-serif text-[24px] tracking-tight">Đăng ký làm nhà bán hàng</h2>
          <p className="text-[13px] text-muted">Điền thông tin gian hàng để gửi yêu cầu xét duyệt.</p>
        </div>

        {application && application.status === "pending" && (
          <div className="rounded-lg border border-warn/25 bg-warn-soft px-4 py-3.5 text-center">
            <Tag tone="warn" className="mb-2">Đang chờ duyệt</Tag>
            <p className="text-[13px] text-fg font-medium">{application.business_name}</p>
            <p className="text-[12px] text-muted mt-1">
              Đơn đăng ký của bạn đã được gửi lúc {formatDate(application.created_at)}. Quản trị viên sẽ xét duyệt trong thời gian sớm nhất.
            </p>
          </div>
        )}

        {(!application || application.status === "rejected") && (
          <>
            {application?.status === "rejected" && (
              <div className="rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 mb-5 text-[13px]">
                <p className="font-medium text-bad">Đơn đăng ký trước đã bị từ chối</p>
                {application.reject_reason && <p className="text-muted mt-1">Lý do: {application.reject_reason}</p>}
                <p className="text-muted mt-1">Bạn có thể gửi lại đơn đăng ký mới bên dưới.</p>
              </div>
            )}
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Field label="Tên gian hàng"><Input required value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Ví dụ: Kho Số Việt" /></Field>
              <Field label="Mô tả" hint="Loại sản phẩm/dịch vụ bạn dự định bán (không bắt buộc)">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tài khoản mạng xã hội, proxy, ..." />
              </Field>
              <Field label="Liên hệ" hint="Telegram, Zalo, email... (không bắt buộc)"><Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="telegram @yourshop" /></Field>
              {error && <p className="text-bad text-[13px]">{error}</p>}
              <Button type="submit" block size="lg" disabled={busy}>{busy ? "Đang gửi…" : "Gửi đơn đăng ký"}</Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
