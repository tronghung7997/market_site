"use client";

import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import {
  bold, italic, title, link, quote,
  unorderedListCommand, orderedListCommand, divider, fullscreen,
} from "@uiw/react-md-editor/commands";

/* Textarea thật (không phải contentEditable) — không có lớp đồng bộ DOM
   phức tạp như MDXEditor (Lexical) nên không có chuyện mất chữ lúc blur hay
   giật khi gõ nhanh; value/onChange là controlled prop bình thường, không
   cần trick key-remount khi tải lại dữ liệu. Preview vẫn dùng chung
   MarkdownContent (markdown-to-jsx, đã khoá disableParsingRawHTML) thay vì
   preview riêng của lib này, để khớp 100% với trang mua thật. */
const TOOLBAR_COMMANDS = [
  bold, italic, divider,
  title, quote, divider,
  unorderedListCommand, orderedListCommand, divider,
  link,
];
const EXTRA_COMMANDS = [fullscreen];

export default function MDRichEditor({
  value, onChange, placeholder,
}: {
  value: string; onChange: (value: string) => void; placeholder?: string;
}) {
  return (
    <div className="proxora-md-editor" data-color-mode="light">
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? "")}
        preview="edit"
        commands={TOOLBAR_COMMANDS}
        extraCommands={EXTRA_COMMANDS}
        textareaProps={{ placeholder }}
        height={220}
        visibleDragbar={false}
      />
    </div>
  );
}
