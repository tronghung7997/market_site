/** Rules for `<input type="date">` filters. While a buyer types a date by
 *  hand the browser already reports every intermediate value ("0002-10-06",
 *  "0020-10-06"…), so a filter must only take a complete, plausible date. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Years a marketplace filter can mean; anything else is a half-typed year. */
export const DATE_INPUT_MIN_YEAR = 2000;
export const DATE_INPUT_MAX_YEAR = 2099;

/** A real calendar day in `YYYY-MM-DD` with a plausible year. */
export function isCompleteDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < DATE_INPUT_MIN_YEAR || year > DATE_INPUT_MAX_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The value a date filter may apply: "" (cleared) or a complete date inside
 *  [min, max]; null means "still typing, keep the current filter". ISO dates
 *  compare correctly as strings. */
export function committableDate(value: string, bounds: { min?: string | null; max?: string | null } = {}): string | null {
  if (value === "") return "";
  if (!isCompleteDate(value)) return null;
  if (bounds.min && isCompleteDate(bounds.min) && value < bounds.min) return null;
  if (bounds.max && isCompleteDate(bounds.max) && value > bounds.max) return null;
  return value;
}

/** A from/to pair in order: a "from" after "to" swaps them rather than
 *  silently returning nothing. */
export function orderedDateRange(from: string, to: string): { from: string; to: string } {
  return from && to && from > to ? { from: to, to: from } : { from, to };
}
