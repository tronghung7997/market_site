import type { ComponentProps } from "react";
import Markdown from "markdown-to-jsx";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { createHeadingSlugger } from "@/lib/heading-slug";

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

/* Bảng nhiều cột cuộn ngang trong khung riêng thay vì kéo cả trang tràn ra
   ngoài màn hình. Dưới sm bảng rộng theo nội dung, mỗi ô tối đa 14rem — không
   thì chữ bị bóp thành cột hẹp, hàng cao ngất. Khung có nhãn và tabIndex để
   cuộn được bằng bàn phím. */
function ScrollTable({ className, ...props }: ComponentProps<"table">) {
  const t = useTranslations("common");
  return (
    <div
      role="region"
      aria-label={t("scrollableTable")}
      tabIndex={0}
      className="my-8 overflow-x-auto rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iris"
    >
      <table
        {...props}
        className={cn("my-0 w-max min-w-full sm:w-full [&_:is(th,td)]:max-w-56 sm:[&_:is(th,td)]:max-w-none", className)}
      />
    </div>
  );
}

/* Ảnh trong bài không có kích thước lưu sẵn: ít nhất đừng tải trước khi
   người đọc cuộn tới. */
function LazyImage(props: ComponentProps<"img">) {
  return <img {...props} loading="lazy" decoding="async" />;
}

const OVERRIDES = { table: ScrollTable, img: LazyImage };

/* Render markdown (mô tả sản phẩm do seller viết) đồng nhất ở mọi nơi hiển
   thị — preview lúc soạn (trang seller) và trang mua thật (trang buyer) phải
   ra cùng một kết quả, nếu không preview coi như nói dối.

   disableParsingRawHTML=true: markdown-to-jsx mặc định PARSE thẻ HTML thô lẫn
   trong markdown (khác react-markdown vốn an toàn mặc định) — seller không
   phải người đáng tin tuyệt đối, nội dung này hiển thị cho buyer khác đọc,
   nên tắt hẳn đường này thay vì tin seller không gõ <script>/onerror=...

   Không có "use client" có chủ ý: trang server (blog, trang chính sách) render
   markdown ngay trên server nên markdown-to-jsx không bị gửi xuống trình duyệt;
   editor/preview của seller import từ component client thì vẫn chạy phía client.

   variant "article" là cỡ chữ đọc dài (blog): 17–18px, dòng thoáng, tiêu đề
   mục lớn hơn và link có gạch chân để không chỉ phân biệt bằng màu. Ảnh cao
   (chụp màn hình điện thoại) bị giới hạn chiều cao và căn giữa. */
const VARIANTS = {
  compact: "prose-sm",
  article: cn(
    "prose-lg text-[17px] leading-[1.75] sm:text-[18px]",
    "prose-h2:text-[1.4em] prose-h2:leading-snug prose-h3:text-[1.2em] prose-h3:leading-snug",
    "prose-headings:scroll-mt-24 prose-a:underline prose-a:decoration-iris/40 prose-a:underline-offset-2 prose-a:hover:decoration-iris",
    "prose-img:mx-auto prose-img:w-auto prose-img:max-h-[min(70vh,640px)] prose-img:rounded-card prose-img:border prose-img:border-line",
  ),
} as const;

export function MarkdownContent({ children, className, variant = "compact" }: {
  children: string;
  className?: string;
  variant?: keyof typeof VARIANTS;
}) {
  return (
    <div
      className={cn(
        "prose max-w-none",
        "prose-headings:font-serif prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-fg prose-th:font-sans prose-th:tracking-normal",
        "prose-p:text-muted prose-li:text-muted prose-strong:text-fg prose-strong:font-semibold",
        "prose-a:text-iris-hi prose-a:no-underline hover:prose-a:underline",
        "prose-code:text-iris-hi prose-code:bg-iris-soft prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
        "prose-blockquote:border-iris/30 prose-blockquote:text-muted prose-blockquote:not-italic prose-blockquote:font-normal",
        "prose-hr:border-line prose-img:rounded-lg prose-table:text-[0.9em]",
        VARIANTS[variant],
        className,
      )}
    >
      <Markdown options={{ disableParsingRawHTML: true, forceBlock: true, slugify: createHeadingSlugger(), overrides: OVERRIDES }}>{withHardBreaks(children)}</Markdown>
    </div>
  );
}
