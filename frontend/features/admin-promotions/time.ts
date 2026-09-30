/** Campaign times are entered and shown in Vietnam time (GMT+7, no DST),
 *  whatever the admin's own machine timezone is. Stored as ISO UTC. */

const OFFSET_MS = 7 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant → `datetime-local` value in GMT+7. */
export function toVnInput(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** `datetime-local` value read as GMT+7 → ISO instant. */
export function fromVnInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}:00+07:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** "31/10/2026 23:59" in GMT+7. */
export function formatVn(iso: string, withYear = true): string {
  const v = toVnInput(iso);
  if (!v) return "";
  const [date, time] = v.split("T");
  const [y, m, d] = date.split("-");
  return `${d}/${m}${withYear ? `/${y}` : ""} ${time}`;
}

/** Quick buttons of the end field. `now` injectable for tests. */
export function plusDaysVn(fromInput: string, days: number, now: number = Date.now()): string {
  const base = fromVnInput(fromInput);
  const t = (base ? Date.parse(base) : now) + days * 86_400_000;
  return toVnInput(new Date(t).toISOString());
}

/** Last minute of the current Vietnam month: "2026-10-31T23:59". */
export function endOfMonthVn(now: number = Date.now()): string {
  const d = new Date(now + OFFSET_MS);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}T23:59`;
}
