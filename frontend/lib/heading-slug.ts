/* Heading ids for markdown pages: dùng chung giữa mục lục (server) và
   markdown-to-jsx (client) để link #anchor khớp nhau. Bỏ dấu tiếng Việt
   (NFD) và đ→d thay vì slugify mặc định của lib — cái đó chỉ biết dấu Latin
   Tây Âu, "Điều khoản" ra "iu-khon". */
export function headingSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

export type MarkdownHeading = { level: 2 | 3; text: string; id: string };

/* Heading trùng tên phải có id khác nhau, nếu không mục lục bấm vào đâu cũng
   nhảy về cái đầu tiên. Mỗi lần render markdown dùng một slugger mới: lần
   đầu giữ nguyên slug, các lần sau thêm -1, -2… theo thứ tự xuất hiện. */
export function createHeadingSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = headingSlug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/* Lấy ## / ### ngoài code fence cho mục lục. Heading mọi cấp đều đi qua
   slugger (markdown-to-jsx slugify cả # và ####) để hậu tố khử trùng khớp
   với id trên trang thật. */
export function extractHeadings(md: string): MarkdownHeading[] {
  const out: MarkdownHeading[] = [];
  const slug = createHeadingSlugger();
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "").trim();
    const id = slug(text);
    if (m[1].length === 2 || m[1].length === 3) out.push({ level: m[1].length as 2 | 3, text, id });
  }
  return out;
}
