"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";

/* @uiw/react-md-editor vẫn cần nạp client-only vì đụng document/clipboard
   lúc khởi tạo — nhưng khác MDXEditor, đây là textarea thật + controlled
   value/onChange bình thường, không có trick key-remount hay lo mất chữ
   lúc blur. */
const MDRichEditor = dynamic(() => import("@/components/MDRichEditor"), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] rounded-lg border border-line bg-surface grid place-items-center">
      <Spinner label="Đang tải trình soạn thảo…" />
    </div>
  ),
});

export function MarkdownEditor({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return <MDRichEditor value={value} onChange={onChange} placeholder={placeholder} />;
}
