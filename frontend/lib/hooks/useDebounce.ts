import { useEffect, useState } from "react";

/** Trả về `value` sau khi nó đứng yên đủ `delay` ms — dùng cho ô tìm kiếm
 * gọi API theo từng phím. Một bản duy nhất, thay cho 7 bản chép tay từng
 * nằm rải ở orders + 6 trang admin. */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
