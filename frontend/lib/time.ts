/** Countdown labels — locale-aware (en default, vi secondary). */

/** "23 hours left" / "3 days left" — null when expired. */
export function timeLeftLabel(expiresAt: string, locale: string = "en"): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const vi = locale === "vi";
  if (minutes < 60) {
    const n = Math.max(1, minutes);
    return vi ? `còn ${n} phút` : `${n} min left`;
  }
  if (minutes < 48 * 60) {
    const n = Math.floor(minutes / 60);
    return vi ? `còn ${n} giờ` : `${n}h left`;
  }
  const n = Math.floor(minutes / (24 * 60));
  return vi ? `còn ${n} ngày` : `${n}d left`;
}

/** "45 seconds left" / "12 min left" — null when expired. Fine grain for QR deposits. */
export function timeLeftFine(expiresAt: string, locale: string = "en"): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const vi = locale === "vi";
  if (ms < 60_000) {
    const n = Math.ceil(ms / 1000);
    return vi ? `còn ${n} giây` : `${n}s left`;
  }
  const n = Math.ceil(ms / 60_000);
  return vi ? `còn ${n} phút` : `${n} min left`;
}
