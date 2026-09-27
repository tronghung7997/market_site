/** Lower-case, accent-free text so "hoan tien" matches "Hoàn tiền". */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every word of `query` occurs in `text`, accent/case-insensitively. */
export function matchesAllWords(text: string, query: string): boolean {
  const words = foldText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldText(text);
  return words.every((word) => haystack.includes(word));
}
