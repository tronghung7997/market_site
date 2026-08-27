"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui";

/* @uiw/react-md-editor vẫn cần nạp client-only vì đụng document/clipboard
   lúc khởi tạo — nhưng khác MDXEditor, đây là textarea thật + controlled
   value/onChange bình thường, không có trick key-remount hay lo mất chữ
   lúc blur. */
function EditorLoading() {
  const t = useTranslations("common");
  return <div className="grid h-[220px] place-items-center rounded-lg border border-line bg-surface"><Spinner label={t("loading")} /></div>;
}

const MDRichEditor = dynamic(() => import("@/components/MDRichEditor"), { ssr: false, loading: EditorLoading });

export function MarkdownEditor({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return <MDRichEditor value={value} onChange={onChange} placeholder={placeholder} />;
}
