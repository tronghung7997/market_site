"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sellerTierLabel } from "@/lib/seller-tier";
import type { SellerApiKey } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { Check, Copy, Plug, Shield, Trash } from "@/components/Icons";

const MIN_TIER_FOR_API = "trusted";
const MIN_TIER_LABEL = sellerTierLabel(MIN_TIER_FOR_API);
const API_BASE_PLACEHOLDER = "https://api-market.taskforces.info";

const API_OPERATIONS: {
  method: "GET" | "POST";
  path: string;
  description: string;
  curl: string;
}[] = [
  {
    method: "GET",
    path: "/seller/orders",
    description: "Lấy danh sách đơn hàng của bạn.",
    curl: `curl "${API_BASE_PLACEHOLDER}/seller/orders" \\\n  -H "X-Seller-Api-Key: <API_KEY>"`,
  },
  {
    method: "POST",
    path: "/seller/orders/{order_id}/accept",
    description: "Nhận xử lý một đơn đang chờ (chuyển trạng thái sang \"đang xử lý\").",
    curl: `curl -X POST "${API_BASE_PLACEHOLDER}/seller/orders/123/accept" \\\n  -H "X-Seller-Api-Key: <API_KEY>"`,
  },
  {
    method: "POST",
    path: "/seller/orders/{order_id}/deliver",
    description: "Giao dữ liệu cho đơn giao thủ công (đơn phải đang ở trạng thái \"đang xử lý\").",
    curl: `curl -X POST "${API_BASE_PLACEHOLDER}/seller/orders/123/deliver" \\\n  -H "X-Seller-Api-Key: <API_KEY>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"data": "uid|password"}'`,
  },
  {
    method: "POST",
    path: "/seller/variants/{variant_id}/resources",
    description: "Nạp hàng loạt tài nguyên (proxy/tài khoản...) cho một gói sản phẩm giao ngay.",
    curl: `curl -X POST "${API_BASE_PLACEHOLDER}/seller/variants/456/resources" \\\n  -H "X-Seller-Api-Key: <API_KEY>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"items": ["uid1|pass1", "uid2|pass2"]}'`,
  },
];

function ApiOperationRow({ op }: { op: (typeof API_OPERATIONS)[number] }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(op.curl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Tag tone={op.method === "GET" ? "neutral" : "iris"} className="font-mono shrink-0">{op.method}</Tag>
          <code className="text-[13px] font-mono truncate">{op.path}</code>
        </div>
        <Button size="sm" variant="ghost" onClick={copy} className="shrink-0">
          {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
          {copied ? "Đã sao chép" : "Sao chép lệnh curl"}
        </Button>
      </div>
      <p className="text-[12.5px] text-muted">{op.description}</p>
      <pre className="rounded-lg bg-fg text-surface text-[11.5px] p-3 overflow-x-auto whitespace-pre">{op.curl}</pre>
    </div>
  );
}

function CreatedKeyModal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <Card className="w-full max-w-[480px] p-6 flex flex-col gap-4">
        <div>
          <h3 className="text-[16px] font-semibold">API key đã được tạo</h3>
          <p className="text-[13px] text-bad mt-1">
            Đây là lần duy nhất bạn xem được key này ở dạng đầy đủ — hãy lưu lại ngay.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-raised border border-line px-3 py-2.5">
          <code className="flex-1 min-w-0 font-mono text-[13px] break-all">{apiKey}</code>
          <Button size="sm" variant="secondary" onClick={copy} className="shrink-0">
            {copied ? <Check size={14} className="text-good" /> : <Copy size={14} />}
            {copied ? "Đã sao chép" : "Sao chép"}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Đã lưu, đóng lại</Button>
        </div>
      </Card>
    </div>
  );
}

function RevokeConfirmModal({ onConfirm, onClose, loading }: { onConfirm: () => void; onClose: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <Card className="w-full max-w-[400px] p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-[16px] font-semibold">Thu hồi API key</h3>
          <p className="text-[13px] text-muted mt-1">
            Mọi request dùng key này sẽ ngừng hoạt động ngay lập tức. Hành động này không thể hoàn tác.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button variant="danger" onClick={onConfirm} disabled={loading}>
            {loading ? "Đang thu hồi…" : "Thu hồi"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function SellerApiSettingsPage() {
  const { account } = useAuth();
  const [keys, setKeys] = useState<SellerApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");

  const eligible = account?.seller_tier === "trusted" || account?.seller_tier === "enterprise";

  const load = async () => {
    setLoading(true);
    try {
      setKeys(await api.listSellerApiKeys());
    } catch {
      // seller chưa đủ tier hoặc chưa có key nào — để danh sách trống
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await api.createSellerApiKey();
      setCreatedKey(res.key);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tạo API key thất bại");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (revokeId === null) return;
    setRevoking(true);
    try {
      await api.revokeSellerApiKey(revokeId);
      setRevokeId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thu hồi thất bại");
    } finally {
      setRevoking(false);
    }
  };

  if (loading) return <div className="py-16"><Spinner /></div>;

  if (!eligible) {
    return (
      <Card className="p-8 text-center">
        <Shield size={40} className="mx-auto text-faint mb-3" />
        <h2 className="text-[16px] font-semibold mb-1.5">Cần nâng cấp lên {MIN_TIER_LABEL}</h2>
        <p className="text-[13px] text-muted max-w-md mx-auto">
          Tính năng API tự tích hợp dành cho seller cấp {MIN_TIER_LABEL} trở lên.
          Cấp hiện tại của bạn: <strong>{sellerTierLabel(account?.seller_tier)}</strong>.
          Liên hệ admin để được xét duyệt nâng cấp.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">API key</h2>
          <p className="text-[13px] text-muted">
            Dùng để tra cứu đơn, nhận/giao đơn và nạp hàng loạt tài nguyên từ hệ
            thống bên ngoài (header <code className="font-mono text-[12px]">X-Seller-Api-Key</code>).
            Xem chi tiết các thao tác bên dưới.
          </p>
        </div>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? "Đang tạo…" : "Tạo API key mới"}
        </Button>
      </div>

      {error && <p className="text-[13px] text-bad">{error}</p>}

      {keys.length === 0 ? (
        <Card className="p-8 text-center">
          <Plug size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] text-muted">Bạn chưa có API key nào</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[12px] text-faint border-b border-line">
                <th className="font-medium px-5 py-3">Key</th>
                <th className="font-medium px-5 py-3">Tạo lúc</th>
                <th className="font-medium px-5 py-3">Dùng lần cuối</th>
                <th className="font-medium px-5 py-3">Trạng thái</th>
                <th className="font-medium px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-0 text-[13px]">
                  <td className="px-5 py-3 font-mono">{k.key_prefix}</td>
                  <td className="px-5 py-3 text-muted">{new Date(k.created_at).toLocaleDateString("vi-VN")}</td>
                  <td className="px-5 py-3 text-muted">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString("vi-VN") : "Chưa dùng"}
                  </td>
                  <td className="px-5 py-3">
                    {k.revoked_at ? (
                      <span className="text-faint">Đã thu hồi</span>
                    ) : (
                      <span className="text-good">Hoạt động</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!k.revoked_at && (
                      <Button size="sm" variant="ghost" onClick={() => setRevokeId(k.id)}>
                        <Trash size={14} /> Thu hồi
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div>
        <h3 className="text-[14px] font-semibold mb-1">Các thao tác hỗ trợ</h3>
        <p className="text-[12.5px] text-muted mb-3">
          Chỉ 4 endpoint dưới đây chấp nhận <code className="font-mono text-[12px]">X-Seller-Api-Key</code>.
          Các thao tác khác (sản phẩm, khuyến mãi, ví...) vẫn cần đăng nhập thường.
        </p>
        <Card className="divide-y divide-line overflow-hidden">
          {API_OPERATIONS.map((op) => (
            <ApiOperationRow key={op.path + op.method} op={op} />
          ))}
        </Card>
      </div>

      {createdKey && <CreatedKeyModal apiKey={createdKey} onClose={() => setCreatedKey(null)} />}
      {revokeId !== null && (
        <RevokeConfirmModal
          loading={revoking}
          onClose={() => setRevokeId(null)}
          onConfirm={handleRevoke}
        />
      )}
    </div>
  );
}
