/** Caret bookkeeping for inputs that reformat digits while typing (e.g.
 *  100000 → 100.000). React re-renders the reformatted value and the browser
 *  drops the caret at the end; these helpers keep it after the same digit. */

/** How many digits sit before `caret` in `text`. */
export function digitsBefore(text: string, caret: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(caret, text.length); i++) if (text[i] >= "0" && text[i] <= "9") n++;
  return n;
}

/** Caret index in `formatted` that has exactly `count` digits before it. */
export function caretForDigits(formatted: string, count: number): number {
  if (count <= 0) {
    const first = formatted.search(/\d/);
    return first < 0 ? formatted.length : first;
  }
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] >= "0" && formatted[i] <= "9" && ++seen === count) return i + 1;
  }
  return formatted.length;
}
