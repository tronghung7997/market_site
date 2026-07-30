"use client";

import Markdown from "markdown-to-jsx";
import { cn } from "@/lib/cn";

/* Seller gõ Enter là muốn xuống dòng, nhưng chuẩn markdown coi 1 newline là
   soft break — "dòng 1\ndòng 2" bị nối thành một dòng. markdown-to-jsx không
   có option breaks kiểu GFM, nên chèn hard break (2 dấu cách cuối dòng) trước
   khi parse. Bỏ qua bên trong code fence — thêm trailing space vào đó là sửa
   nội dung code seller viết. */
function withHardBreaks(md: string): string {
  let fence: "`" | "~" | null = null;
  return md
    .split("\n")
    .map((line) => {
      const open = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
      if (open) {
        const ch = open[0] as "`" | "~";
        if (!fence) fence = ch;
        else if (ch === fence) fence = null;
        return line;
      }
      if (fence || line.trim() === "") return line;
      return line.replace(/\s*$/, "  ");
    })
    .join("\n");
}

/* Render markdown (mô tả sản phẩm do seller viết) đồng nhất ở mọi nơi hiển
   thị — preview lúc soạn (trang seller) và trang mua thật (trang buyer) phải
   ra cùng một kết quả, nếu không preview coi như nói dối.

   disableParsingRawHTML=true: markdown-to-jsx mặc định PARSE thẻ HTML thô lẫn
   trong markdown (khác react-markdown vốn an toàn mặc định) — seller không
   phải người đáng tin tuyệt đối, nội dung này hiển thị cho buyer khác đọc,
   nên tắt hẳn đường này thay vì tin seller không gõ <script>/onerror=...  */
export function MarkdownContent({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none",
        "prose-headings:font-serif prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-fg",
        "prose-p:text-muted prose-li:text-muted prose-strong:text-fg prose-strong:font-semibold",
        "prose-a:text-iris-hi prose-a:no-underline hover:prose-a:underline",
        "prose-code:text-iris-hi prose-code:bg-iris-soft prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
        "prose-blockquote:border-iris/30 prose-blockquote:text-muted prose-blockquote:not-italic prose-blockquote:font-normal",
        "prose-hr:border-line prose-img:rounded-lg prose-table:text-[0.9em]",
        className,
      )}
    >
      <Markdown options={{ disableParsingRawHTML: true, forceBlock: true }}>{withHardBreaks(children)}</Markdown>
    </div>
  );
}
