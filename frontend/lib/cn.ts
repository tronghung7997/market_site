/** Một nguồn cn() duy nhất: bản clsx + tailwind-merge ở lib/utils/cn.
 * Khác bản nối-chuỗi cũ ở chỗ: hai class Tailwind xung đột (vd "p-4 p-5")
 * thì class sau thắng thay vì phụ thuộc thứ tự CSS — đúng ý người viết hơn.
 * File này chỉ còn là re-export cho các chỗ import đường cũ. */
export { cn } from "./utils/cn";
