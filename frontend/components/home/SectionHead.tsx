/** Đầu section trang chủ: heading serif + một dòng phụ. Khác SectionHead của
 *  trang sản phẩm (header card) — đây là đầu SECTION toàn trang. */
export function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3.5">
      <h2 className="font-serif text-[19px] tracking-tight">{title}</h2>
      <p className="text-[12.5px] text-muted mt-0.5">{sub}</p>
    </div>
  );
}
