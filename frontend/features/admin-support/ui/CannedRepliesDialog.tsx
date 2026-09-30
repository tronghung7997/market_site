"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { CannedReply } from "@/lib/types";
import { Button, Input, Spinner, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/toast";
import { Plus, Search } from "@/components/Icons";
import { useCannedReplies, useDeleteCannedReply, useSaveCannedReply } from "../data";
import { CANNED_BODY_MAX, CANNED_TITLE_MAX, matchCanned, normalizeCanned, validateCanned, type CannedErrors } from "../model";

const EMPTY = { shortcut: "", title: "", body: "" };

/** Shared canned replies (all admins): list + search on the left, editor on the right. */
export function CannedRepliesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const list = useCannedReplies();
  const save = useSaveCannedReply();
  const remove = useDeleteCannedReply();
  const [search, setSearch] = React.useState("");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState(EMPTY);
  const [errors, setErrors] = React.useState<CannedErrors>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const replies = React.useMemo(() => list.data ?? [], [list.data]);
  const shown = React.useMemo(() => matchCanned(replies, search), [replies, search]);

  const edit = (r: CannedReply | null) => {
    setEditingId(r?.id ?? null);
    setForm(r ? { shortcut: r.shortcut, title: r.title, body: r.body } : EMPTY);
    setErrors({});
    setConfirmDelete(false);
  };

  React.useEffect(() => { if (open) { setSearch(""); edit(null); } }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateCanned(form, replies, editingId);
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const saved = await save.mutateAsync({ id: editingId, input: normalizeCanned(form) });
      toast.success(editingId === null ? `Đã tạo mẫu /${saved.shortcut}` : "Đã lưu mẫu");
      edit(saved);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Không lưu được mẫu"));
    }
  };

  const doDelete = async () => {
    if (editingId === null) return;
    try {
      await remove.mutateAsync(editingId);
      toast.success("Đã xoá mẫu");
      edit(null);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Không xoá được mẫu"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-line bg-surface text-fg">
        <DialogHeader>
          <DialogTitle className="text-[16px] text-fg">Trả lời mẫu</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            Dùng chung cho mọi admin. Trong ô trả lời gõ “/” và lối tắt rồi Enter để chèn.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm mẫu…" aria-label="Tìm mẫu" className="h-8 pl-8 text-[12.5px]" />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
              {list.isPending ? (
                <div className="grid place-items-center py-8"><Spinner /></div>
              ) : list.isError ? (
                <div className="px-3 py-6 text-center text-[12.5px] text-bad">
                  Không tải được mẫu.
                  <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void list.refetch()}>Thử lại</Button></div>
                </div>
              ) : shown.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12.5px] text-faint">{replies.length === 0 ? "Chưa có mẫu nào. Tạo mẫu đầu tiên ở bên phải." : "Không có mẫu khớp."}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {shown.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        aria-current={editingId === r.id || undefined}
                        onClick={() => edit(r)}
                        className={cn(
                          "block w-full px-3 py-2 text-left text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris/40",
                          editingId === r.id ? "bg-iris-soft/60" : "hover:bg-raised/60",
                        )}
                      >
                        <span className="font-mono text-iris-hi">/{r.shortcut}</span>
                        <span className="text-muted"> — {r.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button size="sm" variant="secondary" block onClick={() => edit(null)}><Plus size={13} />Mẫu mới</Button>
          </div>

          <form onSubmit={submit} className="min-w-0 space-y-3" noValidate>
            <p className="text-[12px] font-medium text-faint">{editingId === null ? "Mẫu mới" : "Sửa mẫu"}</p>
            <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <label className="block">
                <span className="text-[12.5px] font-medium text-muted">Lối tắt</span>
                <div className="relative mt-1.5">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[12.5px] text-faint">/</span>
                  <Input
                    value={form.shortcut}
                    onChange={(e) => setForm({ ...form, shortcut: e.target.value.toLowerCase() })}
                    maxLength={32}
                    aria-invalid={!!errors.shortcut}
                    className="h-9 pl-5 font-mono text-[12.5px]"
                    placeholder="chao"
                  />
                </div>
                {errors.shortcut && <span role="alert" className="mt-1 block text-[11px] text-bad">{errors.shortcut}</span>}
              </label>
              <label className="block">
                <span className="text-[12.5px] font-medium text-muted">Tiêu đề</span>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  maxLength={CANNED_TITLE_MAX}
                  aria-invalid={!!errors.title}
                  className="mt-1.5 h-9 text-[12.5px]"
                  placeholder="Chào hỏi"
                />
                {errors.title && <span role="alert" className="mt-1 block text-[11px] text-bad">{errors.title}</span>}
              </label>
            </div>
            <label className="block">
              <span className="text-[12.5px] font-medium text-muted">Nội dung</span>
              <Textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                maxLength={CANNED_BODY_MAX}
                aria-invalid={!!errors.body}
                className="mt-1.5 min-h-[140px] text-[12.5px]"
                placeholder="Chào {ten}, cảm ơn bạn đã liên hệ. Mình đang kiểm tra đơn {ma_don} và phản hồi trong ít phút nhé."
              />
              <span className="mt-1 flex justify-between text-[11px]">
                {errors.body ? <span role="alert" className="text-bad">{errors.body}</span> : <span className="text-faint">Biến: <code>{"{ten}"}</code> <code>{"{ma_don}"}</code> <code>{"{shop}"}</code></span>}
                <span className="font-mono text-faint">{form.body.length}/{CANNED_BODY_MAX}</span>
              </span>
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {editingId !== null && (confirmDelete ? (
                <>
                  <span className="mr-auto text-[12px] text-bad">Xoá mẫu này?</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Không</Button>
                  <Button type="button" size="sm" variant="danger" loading={remove.isPending} onClick={() => void doDelete()}>Xoá</Button>
                </>
              ) : (
                <Button type="button" size="sm" variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Xoá mẫu</Button>
              ))}
              <Button type="button" size="sm" variant="secondary" onClick={onClose}>Đóng</Button>
              <Button type="submit" size="sm" loading={save.isPending}>Lưu mẫu</Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
