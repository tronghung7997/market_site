/** The viewer's IANA time zone, so "from/to" date filters mean their calendar
 *  days. The API falls back to Asia/Ho_Chi_Minh when it is missing. */
export function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
