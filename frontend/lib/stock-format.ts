/** Stock lines read under their batch's format (`UID|PASS|2FA`): the column
 *  names are the format's `|` fields, in order. Shared by the buyer's order
 *  view and the seller's stock console. */

const MASK = "••••••••";

/** A line's fields under the format's column names, or null when the line has
 *  another number of `|` fields than the format (it is then shown as it is).
 *  With `masked`, only the first field stays readable. */
export function labelledFields(raw: string, format: string, masked = false): { label: string; value: string }[] | null {
  const labels = format.split("|").map((label) => label.trim());
  const values = raw.split("|");
  if (values.length !== labels.length) return null;
  return labels.map((label, index) => ({
    label: label || `#${index + 1}`,
    value: masked && index > 0 && values[index] ? MASK : values[index],
  }));
}
