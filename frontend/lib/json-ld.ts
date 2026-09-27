/* JSON-LD đi vào <script> qua dangerouslySetInnerHTML: một chuỗi "</script>"
   trong tiêu đề seller hay admin viết sẽ đóng thẻ sớm và chèn được HTML. Thoát
   mọi "<" thành escape unicode của nó (cách guide JSON-LD của Next làm) —
   JSON vẫn parse ra đúng chuỗi gốc. */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
