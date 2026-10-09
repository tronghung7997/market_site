"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adminMediaSource, formatBytes } from "@/lib/media";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AdminMediaRow, MediaPurpose, MediaStatus } from "@/lib/types";
import { Card, Input, Select, Spinner, Tag, Textarea, Button } from "@/components/ui";
import { ConfirmModal, Pagination, SlidePanel, StatsCard } from "@/components/admin";
import { useToast } from "@/components/toast";
import { MediaImage } from "@/components/media/MediaImage";
import { useDebounce } from "@/lib/hooks/useDebounce";

const PURPOSE_LABEL: Record<MediaPurpose, string> = {
  product_image: "Ảnh sản phẩm",
  category_image: "Ảnh danh mục",
  seller_logo: "Logo gian hàng",
  seller_banner: "Ảnh bìa gian hàng",
  avatar: "Ảnh đại diện",
  chat_attachment: "Ảnh trong chat",
  dispute_evidence: "Bằng chứng khiếu nại",
  payout_receipt: "Biên lai rút tiền",
  adjustment_proof: "Bằng chứng cộng tiền",
  tier_badge: "Huy hiệu hạng",
  post_cover: "Ảnh bìa bài viết",
  review_image: "Ảnh đánh giá",
};

const STATUS_META: Record<MediaStatus, { label: string; tone: "good" | "neutral" | "warn" | "bad" }> = {
  attached: { label: "Đang dùng", tone: "good" },
  pending: { label: "Chưa lưu", tone: "neutral" },
  detached: { label: "Chờ xoá", tone: "warn" },
  removed: { label: "Đã gỡ", tone: "bad" },
};

const dateTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });

/** Admin › Sản phẩm › Hình ảnh: storage usage for sizing R2, and the
 *  moderation queue — newest uploads first, with takedown. */
export function AdminMediaConsole() {
  const [purpose, setPurpose] = React.useState<MediaPurpose | "">("");
  const [status, setStatus] = React.useState<MediaStatus | "">("");
  const [owner, setOwner] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<AdminMediaRow | null>(null);
  const debouncedOwner = useDebounce(owner, 300);

  const stats = useQuery({ queryKey: ["admin", "media", "stats"], queryFn: api.adminMediaStats });
  const list = useQuery({
    queryKey: ["admin", "media", "list", purpose, status, debouncedOwner, page],
    queryFn: () => api.adminMedia({ purpose, status, owner: debouncedOwner, page }),
    placeholderData: (previous) => previous,
  });

  React.useEffect(() => { setPage(1); }, [purpose, status, debouncedOwner]);

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-muted">
        Ảnh người dùng tải lên: dung lượng theo mục đích và nơi lưu, danh sách mới nhất để kiểm duyệt, gỡ ảnh vi phạm.
      </p>

      {stats.data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatsCard label="Ảnh đang lưu" value={stats.data.count.toLocaleString("vi-VN")} />
          <StatsCard label="Dung lượng" value={formatBytes(stats.data.bytes)} sub="Tổng các cỡ (full + thumb)" />
          <StatsCard
            label="Ảnh mới lưu ở"
            value={stats.data.storage_for_new_uploads === "s3" ? "S3 / R2" : "Postgres"}
            sub={stats.data.by_storage.map((row) => `${row.key === "s3" ? "S3" : "Postgres"}: ${formatBytes(row.bytes)}`).join(" · ") || "Chưa có ảnh"}
          />
          <StatsCard label="Giới hạn mỗi ảnh" value={formatBytes(stats.data.upload_limit_bytes)} sub="Đổi ở Cài đặt › Hệ thống" />
        </div>
      )}

      {stats.data && stats.data.by_purpose.length > 0 && (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-[13px]">
            <thead className="bg-raised/60 text-left text-[11.5px] uppercase tracking-wide text-faint">
              <tr><th className="px-4 py-2 font-medium">Mục đích</th><th className="px-4 py-2 text-right font-medium">Số ảnh</th><th className="px-4 py-2 text-right font-medium">Dung lượng</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stats.data.by_purpose.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-2 text-fg">{PURPOSE_LABEL[row.key] ?? row.key}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.count.toLocaleString("vi-VN")}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{formatBytes(row.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-[repeat(2,minmax(0,200px))_minmax(0,1fr)]">
          <Select aria-label="Mục đích" value={purpose} onChange={(e) => setPurpose(e.target.value as MediaPurpose | "")}>
            <option value="">Mọi mục đích</option>
            {(Object.keys(PURPOSE_LABEL) as MediaPurpose[]).map((key) => <option key={key} value={key}>{PURPOSE_LABEL[key]}</option>)}
          </Select>
          <Select aria-label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value as MediaStatus | "")}>
            <option value="">Mọi trạng thái</option>
            {(Object.keys(STATUS_META) as MediaStatus[]).map((key) => <option key={key} value={key}>{STATUS_META[key].label}</option>)}
          </Select>
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Lọc theo email người tải lên" />
        </div>

        {list.isPending ? (
          <div className="grid place-items-center py-12"><Spinner /></div>
        ) : list.isError ? (
          <p className="text-[13px] text-bad">Không tải được danh sách ảnh.</p>
        ) : list.data.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-10 text-center text-[13px] text-muted">Không có ảnh nào khớp bộ lọc.</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {list.data.items.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    className="group block w-full overflow-hidden rounded-lg border border-line bg-surface text-left transition-colors hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/60"
                  >
                    <span className="block aspect-square bg-raised">
                      {row.status === "removed"
                        ? <span className="flex h-full items-center justify-center px-2 text-center text-[12px] text-bad">Đã gỡ</span>
                        : <MediaImage image={adminMediaSource(row)} alt="" className="h-full w-full" />}
                    </span>
                    <span className="block space-y-1 px-2.5 py-2">
                      <span className="block truncate text-[12px] font-medium text-fg">{PURPOSE_LABEL[row.purpose] ?? row.purpose}</span>
                      <span className="block truncate text-[11px] text-faint">{row.owner_email ?? "—"}</span>
                      <span className="flex items-center justify-between gap-1">
                        <Tag tone={STATUS_META[row.status].tone}>{STATUS_META[row.status].label}</Tag>
                        <span className="font-mono text-[10.5px] text-faint">{formatBytes(row.bytes)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={page} perPage={list.data.per_page} total={list.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <MediaDetail row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function MediaDetail({ row, onClose }: { row: AdminMediaRow | null; onClose: () => void }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const remove = useMutation({
    mutationFn: () => api.adminRemoveMedia(row!.id, reason.trim()),
    onSuccess: () => {
      toast.success("Đã gỡ ảnh");
      setConfirming(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Gỡ ảnh thất bại")),
  });

  return (
    <SlidePanel isOpen={row !== null} onClose={onClose} title="Chi tiết ảnh" width="lg">
      {row && (
        <div className="space-y-4">
          <div className="flex max-h-[60vh] items-center justify-center overflow-hidden rounded-lg border border-line bg-raised">
            {row.status === "removed"
              ? <p className="px-4 py-16 text-center text-[13px] text-bad">Ảnh đã bị gỡ: {row.removed_reason}</p>
              : <MediaImage image={adminMediaSource(row)} variant="full" fit="contain" eager alt="" className="max-h-[60vh] w-full" />}
          </div>
          <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
            <dt className="text-faint">Mục đích</dt><dd className="text-fg">{PURPOSE_LABEL[row.purpose] ?? row.purpose} · {row.visibility === "public" ? "công khai" : "riêng tư"}</dd>
            <dt className="text-faint">Người tải lên</dt><dd className="break-all text-fg">{row.owner_email ?? "—"}</dd>
            <dt className="text-faint">Gắn với</dt><dd className="font-mono text-fg">{row.subject_type ? `${row.subject_type} #${row.subject_id}` : "chưa gắn"}</dd>
            <dt className="text-faint">Kích thước</dt><dd className="font-mono text-fg">{row.w} × {row.h} · {formatBytes(row.bytes)}</dd>
            <dt className="text-faint">Nơi lưu</dt><dd className="text-fg">{row.storage === "s3" ? "S3 / R2" : "Postgres"}</dd>
            <dt className="text-faint">Tải lên lúc</dt><dd className="text-fg">{dateTime(row.created_at)}</dd>
            {row.taken_at && (<><dt className="text-faint">Chụp lúc (EXIF)</dt><dd className="text-fg">{dateTime(row.taken_at)}</dd></>)}
            <dt className="text-faint">Trạng thái</dt><dd><Tag tone={STATUS_META[row.status].tone}>{STATUS_META[row.status].label}</Tag></dd>
          </dl>
          {row.status !== "removed" && (
            <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>Gỡ ảnh vi phạm</Button>
          )}
        </div>
      )}
      <ConfirmModal
        isOpen={confirming}
        onClose={() => { setConfirming(false); setReason(""); }}
        onConfirm={() => remove.mutate()}
        title="Gỡ ảnh này?"
        description="Ảnh bị xoá khỏi kho ngay, mọi nơi đang dùng sẽ hiện ô trống. Nếu đang dùng CDN, bản đã cache có thể còn tới khi purge. Lý do được ghi vào nhật ký."
        confirmText="Gỡ ảnh"
        variant="danger"
        isLoading={remove.isPending}
        confirmDisabled={reason.trim().length < 3}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="Lý do (bắt buộc) — vd: lộ số điện thoại, ảnh không liên quan…" />
      </ConfirmModal>
    </SlidePanel>
  );
}
