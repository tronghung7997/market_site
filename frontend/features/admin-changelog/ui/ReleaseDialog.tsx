"use client";

import * as React from "react";

import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { ChangeAudience, ChangeItem, ChangelogRelease, ChangelogWrite } from "@/lib/types";
import { Banner, Button, Input, Select, Textarea } from "@/components/ui";
import { Plus, X } from "@/components/Icons";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { AUDIENCES, AUDIENCE_LABEL, KINDS, KIND_META, nextVersion, parseChangeLines, todayIso } from "../model";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = new release. */
  release: ChangelogRelease | null;
  latestVersion?: string;
  onSaved: () => Promise<void> | void;
};

const MAX_TEXT = 300;

const blankItem = (): ChangeItem => ({ kind: "new", text: "", audience: ["admin"] });

function initialDraft(release: ChangelogRelease | null, latestVersion?: string): ChangelogWrite {
  if (release) {
    const { version, released_on, title, items, dev_notes, status } = release;
    return { version, released_on, title, items: items.length ? items : [blankItem()], dev_notes, status };
  }
  return {
    version: nextVersion(latestVersion), released_on: todayIso(), title: "",
    items: [blankItem()], dev_notes: "", status: "draft",
  };
}

export function ReleaseDialog({ open, onOpenChange, release, latestVersion, onSaved }: Props) {
  const apiErrorMessage = useApiErrorMessage();
  const [draft, setDraft] = React.useState<ChangelogWrite>(() => initialDraft(release, latestVersion));
  const [saving, setSaving] = React.useState<"draft" | "published" | null>(null);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setDraft(initialDraft(release, latestVersion));
      setErr("");
    }
  }, [open, release, latestVersion]);

  const setItem = (i: number, patch: Partial<ChangeItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const removeItem = (i: number) =>
    setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
  const addItem = () => {
    setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }));
    setFocusRow(draft.items.length);
  };

  // Keyboard-first entry: Enter adds a row below, Backspace on an empty row
  // removes it, and pasting several lines splits them into rows.
  const textRefs = React.useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focusRow, setFocusRow] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (focusRow === null) return;
    const el = textRefs.current[focusRow];
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setFocusRow(null);
  }, [focusRow]);

  const insertAfter = (i: number, rows: ChangeItem[]) =>
    setDraft((d) => ({ ...d, items: [...d.items.slice(0, i + 1), ...rows, ...d.items.slice(i + 1)] }));

  const onRowKeyDown = (i: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // Vietnamese IME still composing
    const item = draft.items[i];
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      insertAfter(i, [{ kind: item.kind, text: "", audience: item.audience }]);
      setFocusRow(i + 1);
    } else if (e.key === "Backspace" && item.text === "" && draft.items.length > 1) {
      e.preventDefault();
      removeItem(i);
      setFocusRow(Math.max(0, i - 1));
    }
  };

  const onRowPaste = (i: number, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/\r?\n/.test(text.trim())) return; // one line: normal paste
    e.preventDefault();
    const item = draft.items[i];
    const rows = parseChangeLines(text, item.kind)
      .map((r) => ({ kind: r.kind, text: r.text.slice(0, MAX_TEXT), audience: item.audience }));
    if (!rows.length) return;
    if (item.text.trim() === "") {
      setDraft((d) => ({ ...d, items: [...d.items.slice(0, i), ...rows, ...d.items.slice(i + 1)] }));
      setFocusRow(i + rows.length - 1);
    } else {
      insertAfter(i, rows);
      setFocusRow(i + rows.length);
    }
  };

  const items = draft.items.filter((it) => it.text.trim());
  const canSave = draft.version.trim() !== "" && draft.title.trim() !== "" && draft.released_on !== "";

  const save = async (status: "draft" | "published") => {
    setSaving(status);
    setErr("");
    const body: ChangelogWrite = { ...draft, version: draft.version.trim(), title: draft.title.trim(), items, status };
    try {
      if (release) await api.adminUpdateRelease(release.id, body);
      else await api.adminCreateRelease(body);
      await onSaved();
      onOpenChange(false);
    } catch (e) {
      setErr(apiErrorMessage(e, "Lưu không thành công."));
    } finally {
      setSaving(null);
    }
  };

  const published = release?.status === "published";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{release ? `Sửa ${release.version}` : "Thêm phiên bản"}</DialogTitle>
          <DialogDescription>Viết cho người không đọc code: thay đổi gì, ai được ảnh hưởng.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-[13px] font-medium text-fg">
              Phiên bản
              <Input
                value={draft.version}
                onChange={(e) => setDraft({ ...draft, version: e.target.value })}
                maxLength={32}
                className="font-mono"
              />
            </label>
            <label className="grid gap-1.5 text-[13px] font-medium text-fg">
              Ngày cập nhật
              <Input
                type="date"
                value={draft.released_on}
                onChange={(e) => setDraft({ ...draft, released_on: e.target.value })}
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-[13px] font-medium text-fg">
            Tiêu đề
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Điều quan trọng nhất của lần cập nhật này"
              maxLength={200}
            />
          </label>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-[13px] font-medium text-fg">Các thay đổi</legend>
            {draft.items.map((item, i) => (
              <div key={i} className="grid grid-cols-[110px_minmax(0,1fr)_32px] items-start gap-2 sm:grid-cols-[110px_minmax(0,1fr)_130px_32px]">
                <Select
                  aria-label="Loại"
                  value={item.kind}
                  onChange={(e) => setItem(i, { kind: e.target.value as ChangeItem["kind"] })}
                  className="h-9"
                >
                  {KINDS.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
                </Select>
                <Textarea
                  ref={(el) => { textRefs.current[i] = el; }}
                  aria-label="Mô tả thay đổi"
                  rows={1}
                  value={item.text}
                  onChange={(e) => setItem(i, { text: e.target.value.replace(/\r?\n/g, " ") })}
                  onKeyDown={(e) => onRowKeyDown(i, e)}
                  onPaste={(e) => onRowPaste(i, e)}
                  maxLength={MAX_TEXT}
                  className="field-sizing-content min-h-9 resize-none px-3 py-[7px] leading-5"
                />
                <Select
                  aria-label="Ảnh hưởng tới"
                  value={item.audience[0] ?? ""}
                  onChange={(e) => setItem(i, { audience: e.target.value ? [e.target.value as ChangeAudience] : [] })}
                  className="col-span-2 h-9 sm:col-span-1"
                >
                  <option value="">Không rõ</option>
                  {AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
                </Select>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  aria-label="Xoá dòng"
                  className="row-start-1 grid h-9 w-8 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg sm:row-start-auto [grid-column:3] sm:[grid-column:auto]"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button type="button" variant="ghost" size="sm" onClick={addItem} className="text-iris">
                <Plus size={14} /> Thêm dòng
              </Button>
              <span className="text-[12px] text-muted">
                Enter để xuống dòng mới · dán nhiều dòng sẽ tự tách, dòng &quot;Cải tiến:&quot; / &quot;Sửa lỗi:&quot; tự đổi loại
              </span>
            </div>
          </fieldset>

          <label className="grid gap-1.5 text-[13px] font-medium text-fg">
            Chi tiết cho dev
            <span className="text-[12px] font-normal text-muted">Commit, migration, việc cần chạy tay. Admin chỉ thấy khi mở rộng.</span>
            <Textarea
              rows={3}
              value={draft.dev_notes}
              onChange={(e) => setDraft({ ...draft, dev_notes: e.target.value })}
              maxLength={5000}
              className="font-mono text-[12px]"
            />
          </label>

          {err && <Banner tone="bad">{err}</Banner>}
        </div>

        <DialogFooter className="gap-2">
          {!published && (
            <Button variant="secondary" onClick={() => save("draft")} disabled={!canSave || saving !== null} loading={saving === "draft"}>
              Lưu nháp
            </Button>
          )}
          <Button onClick={() => save("published")} disabled={!canSave || saving !== null} loading={saving === "published"}>
            {published ? "Lưu thay đổi" : "Đăng phiên bản"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
