/** Đầu section trang chủ: heading serif + một dòng phụ. Khác SectionHead của
 *  trang sản phẩm (header card) — đây là đầu SECTION toàn trang. */
export function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-serif text-[22px] font-semibold leading-tight tracking-tight text-fg sm:text-[24px]">{title}</h2>
      <p className="mt-1 text-[13px] text-muted">{sub}</p>
    </div>
  );
}
