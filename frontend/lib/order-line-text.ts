/** Delivered-line text helpers with no transport (see `lib/order-lines.ts`). */

export type LineRow = { id: number; data?: string | null; data_preview?: string | null };

/** What a list shows for a delivered line: the full text when the API sent it,
 *  otherwise its head (long lines — cookie exports — are clipped in lists). */
export function lineDisplayText(row: LineRow): string {
  return row.data ?? row.data_preview ?? "";
}

/** True when the list carries only the head of this line. */
export function isClippedLine(row: LineRow): boolean {
  return row.data == null && row.data_preview != null;
}

/** `user|pass` per line (the "user|pass" copy format); other lines unchanged. */
export function userPassLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[|:]/);
      return parts[0] && parts[1] ? `${parts[0]}|${parts[1]}` : line;
    })
    .join("\n");
}
