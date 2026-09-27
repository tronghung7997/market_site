"use client";

import * as React from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Category, SellerApplication } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { Button, Card, Spinner, Tag, Textarea } from "@/components/ui";
import { ConfirmModal } from "@/components/admin";

const STATUS_TONE: Record<SellerApplication["status"], "warn" | "good" | "bad"> = {
  pending: "warn",
  approved: "good",
  rejected: "bad",
  needs_info: "warn",
};
const STATUS_LABEL: Record<SellerApplication["status"], string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  needs_info: "Chờ bổ sung",
};
const SELLER_TYPE_LABEL: Record<string, string> = { individual: "Cá nhân", business: "Doanh nghiệp" };
const EXPERIENCE_LABEL: Record<string, string> = { none: "Mới bắt đầu", under_1y: "< 1 năm", "1_3y": "1–3 năm", over_3y: "> 3 năm" };
const REFERRAL_LABEL: Record<string, string> = {
  search: "Tìm kiếm", social: "Mạng xã hội", friend: "Bạn bè", community: "Hội nhóm", ads: "Quảng cáo", other: "Khác",
};

function categoryNames(tree: Category[]): Map<number, string> {
  const names = new Map<number, string>();
  const walk = (list: Category[]) => list.forEach((c) => { names.set(c.id, c.name); walk(c.children ?? []); });
  walk(tree);
  return names;
}

export default function AdminSellerApplicationsPage() {
  const apiErrorMessage = useApiErrorMessage();
  const [apps, setApps] = React.useState<SellerApplication[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [rejectModal, setRejectModal] = React.useState<{ id: number } | null>(null);
  const [reason, setReason] = React.useState("");
  const [infoModal, setInfoModal] = React.useState<{ id: number } | null>(null);
  const [infoNote, setInfoNote] = React.useState("");
  const [categories, setCategories] = React.useState<Map<number, string>>(new Map());
  React.useEffect(() => {
    api.categories().then((tree) => setCategories(categoryNames(tree))).catch(() => {});
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setApps(await api.adminSellerApplications());
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const approve = async (id: number) => {
    setErr(null); setBusyId(id);
    try {
      const updated = await api.adminApproveSellerApplication(id);
      setApps((cur) => cur?.map((a) => (a.id === id ? updated : a)) ?? cur);
    } catch (e) {
      setErr(apiErrorMessage(e, "Duyệt đơn thất bại"));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejectModal) return;
    setErr(null); setBusyId(rejectModal.id);
    try {
      const updated = await api.adminRejectSellerApplication(rejectModal.id, reason.trim() || "Không đạt yêu cầu");
      setApps((cur) => cur?.map((a) => (a.id === updated.id ? updated : a)) ?? cur);
      setRejectModal(null);
      setReason("");
    } catch (e) {
      setErr(apiErrorMessage(e, "Từ chối đơn thất bại"));
    } finally {
      setBusyId(null);
    }
  };

  const requestInfo = async () => {
    if (!infoModal || !infoNote.trim()) return;
    setErr(null); setBusyId(infoModal.id);
    try {
      const updated = await api.adminRequestSellerApplicationInfo(infoModal.id, infoNote.trim());
      setApps((cur) => cur?.map((a) => (a.id === updated.id ? updated : a)) ?? cur);
      setInfoModal(null);
      setInfoNote("");
    } catch (e) {
      setErr(apiErrorMessage(e, "Gửi yêu cầu bổ sung thất bại"));
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = apps?.filter((a) => a.status === "pending").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[18px] font-semibold text-slate-900">Đơn đăng ký nhà bán</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">
          {pendingCount > 0 ? `${pendingCount} đơn đang chờ duyệt` : "Không có đơn chờ duyệt"}
        </p>
      </div>

      {err && <p className="text-[13px] text-red-600">{err}</p>}

      {loading || !apps ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-5 py-2.5 font-medium">Gian hàng</th>
                    <th className="px-5 py-2.5 font-medium">Liên hệ</th>
                    <th className="px-5 py-2.5 font-medium">Ngày gửi</th>
                    <th className="px-5 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-5 py-2.5 font-medium w-48" />
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-700">{a.business_name}</div>
                        {(a.seller_type || a.experience) && (
                          <div className="text-[12px] text-slate-500 mt-0.5">
                            {[a.seller_type && SELLER_TYPE_LABEL[a.seller_type], a.experience && `Kinh nghiệm: ${EXPERIENCE_LABEL[a.experience]}`].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        {a.category_ids && a.category_ids.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1 max-w-[320px]">
                            {a.category_ids.map((id) => <Tag key={id}>{categories.get(id) ?? `#${id}`}</Tag>)}
                          </div>
                        )}
                        {a.description && <div className="text-[12px] text-slate-500 mt-1 max-w-[320px] whitespace-pre-line">{a.description}</div>}
                        {a.warranty_policy && <div className="text-[12px] text-slate-500 mt-1 max-w-[320px] whitespace-pre-line">Bảo hành: {a.warranty_policy}</div>}
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        <div>{a.contact || "—"}</div>
                        {a.phone && <div className="font-mono text-[12px] text-slate-500 mt-0.5">{a.phone}</div>}
                        {a.referral_source && <div className="text-[12px] text-slate-400 mt-0.5">Biết qua: {REFERRAL_LABEL[a.referral_source]}</div>}
                        {a.rules_accepted_at && <div className="text-[12px] text-slate-400 mt-0.5">Đồng ý cam kết {formatDateTime(a.rules_accepted_at)}</div>}
                      </td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{formatDateTime(a.created_at)}</td>
                      <td className="px-5 py-3">
                        <Tag tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Tag>
                        {a.status === "rejected" && a.reject_reason && (
                          <div className="text-[12px] text-slate-500 mt-1 max-w-[220px]">Lý do: {a.reject_reason}</div>
                        )}
                        {a.info_request && (a.status === "needs_info" || a.info_responded_at) && (
                          <div className="text-[12px] text-slate-500 mt-1 max-w-[220px] whitespace-pre-line">
                            Đã yêu cầu: {a.info_request}
                            {a.info_responded_at && <span className="block text-slate-400">Đã bổ sung {formatDateTime(a.info_responded_at)}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {a.status === "pending" && (
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" disabled={busyId === a.id} onClick={() => approve(a.id)}>
                              {busyId === a.id ? "…" : "Duyệt"}
                            </Button>
                            <Button size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => setInfoModal({ id: a.id })}>
                              Yêu cầu bổ sung
                            </Button>
                            <Button size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => setRejectModal({ id: a.id })}>
                              Từ chối
                            </Button>
                          </div>
                        )}
                        {a.status === "needs_info" && (
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => setRejectModal({ id: a.id })}>
                              Từ chối
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {apps.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500">Chưa có đơn đăng ký nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      )}

      <ConfirmModal
        isOpen={infoModal !== null}
        onClose={() => { setInfoModal(null); setInfoNote(""); }}
        onConfirm={requestInfo}
        title="Yêu cầu bổ sung thông tin"
        description="Người đăng ký nhận ghi chú này qua email và trên trang đăng ký, sửa đơn rồi gửi lại."
        confirmText="Gửi yêu cầu"
        isLoading={busyId !== null}
      >
        <Textarea
          placeholder="VD: Cho biết nguồn hàng và chính sách bảo hành"
          value={infoNote}
          onChange={(e) => setInfoNote(e.target.value)}
          maxLength={1000}
          className="min-h-[80px]"
        />
      </ConfirmModal>

      <ConfirmModal
        isOpen={rejectModal !== null}
        onClose={() => { setRejectModal(null); setReason(""); }}
        onConfirm={reject}
        title="Từ chối đơn đăng ký"
        description="Người dùng sẽ thấy lý do này và có thể gửi lại đơn mới."
        confirmText="Từ chối"
        variant="danger"
        isLoading={busyId !== null}
      >
        <Textarea
          placeholder="Lý do từ chối"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-[60px]"
        />
      </ConfirmModal>
    </div>
  );
}
