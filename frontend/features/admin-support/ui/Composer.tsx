"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { IMAGE_ACCEPT, imageFilesFrom } from "@/lib/media";
import { useSendChatMessage } from "@/hooks/use-chat";
import { Button } from "@/components/ui";
import { PendingImages } from "@/components/media/PendingImages";
import { useImageUploads } from "@/components/media/useImageUploads";
import { ImageIcon, Sparkles } from "@/components/Icons";
import { useAddTicketNote, useCannedReplies } from "../data";
import {
  applySlashInsert, isSendShortcut, matchCanned, MESSAGE_MAX, NOTE_MAX, renderPlaceholders, slashQuery, unfilledPlaceholders,
  type PlaceholderValues,
} from "../model";

/** Backend MAX_ATTACHMENTS_PER_MESSAGE. */
const MAX_CHAT_IMAGES = 4;
const PICKER_LIMIT = 8;

type Mode = "reply" | "note";

export function Composer({ conversationId, placeholders, canResolve, onResolveAfterSend, onManageCanned, onSent }: {
  conversationId: string;
  placeholders: PlaceholderValues;
  /** Whether "Gửi và đánh dấu xong" applies (ticket is open). */
  canResolve: boolean;
  onResolveAfterSend: () => Promise<void>;
  onManageCanned: () => void;
  onSent: () => void;
}) {
  const apiErrorMessage = useApiErrorMessage();
  const [mode, setMode] = React.useState<Mode>("reply");
  const [drafts, setDrafts] = React.useState<Record<Mode, string>>({ reply: "", note: "" });
  const [caret, setCaret] = React.useState(0);
  const [pickerIndex, setPickerIndex] = React.useState(0);
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);
  const [resolveAfter, setResolveAfter] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const attachInput = React.useRef<HTMLInputElement>(null);
  const send = useSendChatMessage();
  const addNote = useAddTicketNote(conversationId);
  const uploads = useImageUploads("chat_attachment", MAX_CHAT_IMAGES);
  const canned = useCannedReplies();

  // A different ticket starts with a clean composer.
  React.useEffect(() => {
    setDrafts({ reply: "", note: "" });
    setMode("reply");
    setResolveAfter(false);
    setError(null);
    uploads.reset();
  }, [conversationId]);

  const draft = drafts[mode];
  const setDraft = (value: string) => setDrafts((d) => ({ ...d, [mode]: value }));
  const isNote = mode === "note";

  const slash = !isNote ? slashQuery(draft, caret) : null;
  const pickerOpen = !!slash && slash.start !== dismissedAt;
  const options = React.useMemo(
    () => (pickerOpen && slash ? matchCanned(canned.data ?? [], slash.query).slice(0, PICKER_LIMIT) : []),
    [pickerOpen, slash, canned.data],
  );
  React.useEffect(() => { setPickerIndex(0); }, [slash?.query]);

  const syncCaret = () => setCaret(textarea.current?.selectionStart ?? 0);

  const insertCanned = (index: number) => {
    const reply = options[index];
    if (!reply || !slash) return;
    const body = renderPlaceholders(reply.body, placeholders);
    const next = applySlashInsert(draft, slash.start, caret, body);
    setDraft(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const openPicker = () => {
    const el = textarea.current;
    const at = el?.selectionStart ?? draft.length;
    const needsSpace = at > 0 && !/\s/.test(draft[at - 1]);
    const next = applySlashInsert(draft, at, at, needsSpace ? " /" : "/");
    setDraft(next.text);
    setCaret(next.caret);
    setDismissedAt(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(next.caret, next.caret); });
  };

  const busy = send.isPending || addNote.isPending;
  const body = draft.trim();
  // A customer must never receive a raw "{ma_don}": unfilled placeholders block sending.
  const unfilled = !isNote ? unfilledPlaceholders(draft) : [];
  const canSubmit = isNote
    ? body.length > 0 && body.length <= NOTE_MAX && !busy
    : (body.length > 0 || uploads.images.length > 0) && uploads.uploading === 0 && unfilled.length === 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    if (isNote) {
      try {
        await addNote.mutateAsync(body);
        setDrafts((d) => ({ ...d, note: "" }));
        onSent();
      } catch (e) {
        setError(apiErrorMessage(e, "Không lưu được ghi chú"));
      }
      return;
    }
    const images = uploads.images;
    setDrafts((d) => ({ ...d, reply: "" }));
    uploads.reset();
    onSent();
    try {
      await send.mutateAsync({ conversationId, body, clientMessageId: crypto.randomUUID(), attachments: images.map((i) => i.id) });
    } catch (e) {
      setDrafts((d) => ({ ...d, reply: body }));
      uploads.restore(images);
      setError(apiErrorMessage(e, "Không gửi được tin nhắn"));
      return;
    }
    if (resolveAfter && canResolve) {
      try {
        await onResolveAfterSend();
        setResolveAfter(false);
      } catch (e) {
        setError(apiErrorMessage(e, "Đã gửi nhưng chưa đánh dấu xong được"));
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && options.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        insertCanned(pickerIndex);
        return;
      }
    }
    if (pickerOpen && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissedAt(slash?.start ?? null);
      return;
    }
    if (isSendShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      void submit();
    }
  };

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => { setMode(m); setError(null); requestAnimationFrame(() => textarea.current?.focus()); }}
      className={cn(
        "h-8 border-b-2 px-2.5 text-[12.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
        mode === m ? (m === "note" ? "border-warn text-warn" : "border-iris text-iris-hi") : "border-transparent text-muted hover:text-fg",
      )}
    >
      {label}
    </button>
  );

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      onDragOver={(e) => { if (!isNote) e.preventDefault(); }}
      onDrop={(e) => { if (isNote) return; e.preventDefault(); void uploads.addFiles(imageFilesFrom(e.dataTransfer)); }}
      className={cn("shrink-0 border-t border-line p-2 sm:p-3", isNote ? "bg-warn-soft/30" : "bg-surface")}
    >
      <div role="tablist" aria-label="Kiểu soạn" className="mb-1.5 flex gap-1 border-b border-line">
        {tab("reply", "Trả lời khách")}
        {tab("note", "Ghi chú nội bộ")}
      </div>
      {!isNote && (
        <div className="mb-1.5 empty:hidden">
          <PendingImages images={uploads.images} uploading={uploads.uploading} errors={uploads.errors} onRemove={uploads.remove} />
        </div>
      )}
      <div className="relative">
        {pickerOpen && (
          <div className="absolute bottom-full left-0 z-20 mb-1 w-full max-w-md overflow-hidden rounded-lg border border-line bg-card shadow-card">
            <p className="border-b border-line px-3 py-1.5 text-[11px] text-faint">Trả lời mẫu · ↑↓ chọn · Enter chèn · Esc đóng</p>
            {canned.isPending ? (
              <p className="px-3 py-3 text-[12.5px] text-faint">Đang tải…</p>
            ) : canned.isError ? (
              <p className="px-3 py-3 text-[12.5px] text-bad">Không tải được mẫu.</p>
            ) : options.length === 0 ? (
              <p className="px-3 py-3 text-[12.5px] text-faint">{(canned.data ?? []).length === 0 ? "Chưa có mẫu nào." : "Không có mẫu khớp."}</p>
            ) : (
              <ul id="canned-options" role="listbox" aria-label="Trả lời mẫu" className="max-h-60 overflow-y-auto py-1">
                {options.map((r, i) => (
                  <li
                    key={r.id}
                    id={`canned-${r.id}`}
                    role="option"
                    aria-selected={i === pickerIndex}
                    onMouseDown={(e) => { e.preventDefault(); insertCanned(i); }}
                    onMouseEnter={() => setPickerIndex(i)}
                    className={cn("cursor-pointer px-3 py-1.5 text-[12.5px]", i === pickerIndex ? "bg-iris-soft/70" : "")}
                  >
                    <span className="font-mono text-iris-hi">/{r.shortcut}</span>
                    <span className="text-muted"> — {r.title}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-faint">{r.body}</span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onManageCanned}
              className="block w-full border-t border-line px-3 py-1.5 text-left text-[11.5px] font-medium text-iris hover:bg-raised"
            >
              Quản lý trả lời mẫu
            </button>
          </div>
        )}
        <label htmlFor="support-composer" className="sr-only">{isNote ? "Ghi chú nội bộ" : "Trả lời"}</label>
        <textarea
          id="support-composer"
          ref={textarea}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart); if (dismissedAt !== null && !slashQuery(e.target.value, e.target.selectionStart)) setDismissedAt(null); }}
          onSelect={syncCaret}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (isNote) return;
            const files = imageFilesFrom(e.clipboardData);
            if (files.length) { e.preventDefault(); void uploads.addFiles(files); }
          }}
          role={pickerOpen ? "combobox" : undefined}
          aria-expanded={pickerOpen ? true : undefined}
          aria-controls={pickerOpen && options.length ? "canned-options" : undefined}
          aria-activedescendant={pickerOpen && options[pickerIndex] ? `canned-${options[pickerIndex].id}` : undefined}
          rows={3}
          maxLength={isNote ? NOTE_MAX : MESSAGE_MAX}
          placeholder={isNote ? "Ghi chú chỉ admin thấy — không gửi cho khách" : "Nhập / để chèn trả lời mẫu"}
          className={cn(
            "block max-h-48 min-h-[76px] w-full resize-y rounded-lg border px-3 py-2 text-[13px] text-fg outline-none transition-colors placeholder:text-placeholder",
            "focus:ring-2",
            isNote ? "border-warn/40 bg-surface focus:border-warn focus:ring-warn/15" : "border-line bg-raised/50 focus:border-iris focus:bg-surface focus:ring-iris/15",
          )}
        />
      </div>
      {unfilled.length > 0 && (
        <p className="mt-1 text-[11px] text-warn">Sửa hoặc xoá {unfilled.map((p) => `{${p}}`).join(" ")} trước khi gửi — ticket này không có giá trị để điền.</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {!isNote && (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => attachInput.current?.click()} disabled={uploads.full}>
              <ImageIcon size={14} />Ảnh
            </Button>
            <input
              ref={attachInput}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void uploads.addFiles(files); }}
            />
            <Button type="button" size="sm" variant="ghost" onClick={openPicker}><Sparkles size={14} />Trả lời mẫu</Button>
          </>
        )}
        <div className="flex-1" />
        {!isNote && canResolve && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" className="accent-[var(--color-iris)]" checked={resolveAfter} onChange={(e) => setResolveAfter(e.target.checked)} />
            Gửi và đánh dấu xong
          </label>
        )}
        <Button type="submit" size="sm" disabled={!canSubmit} loading={busy} className={cn(isNote && "bg-warn text-white")}>
          {isNote ? "Lưu ghi chú" : "Gửi"}
          <kbd className="ml-1 hidden font-mono text-[10.5px] opacity-75 sm:inline">⌘↵</kbd>
        </Button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-[11.5px] text-bad">{error}</p>}
    </form>
  );
}
