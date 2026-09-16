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

/* Lấy ## / ### ngoài code fence; id trùng thì thêm hậu tố như trên trang
   thật (markdown-to-jsx không khử trùng nên ta khử ở cả hai phía). */
export function extractHeadings(md: string): MarkdownHeading[] {
  const out: MarkdownHeading[] = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "").trim();
    out.push({ level: m[1].length as 2 | 3, text, id: headingSlug(text) });
  }
  return out;
}
