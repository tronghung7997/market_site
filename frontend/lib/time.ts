/** Đếm ngược "còn bao lâu" nói theo lịch người đọc — hai thang đo, hai hàm:
 *  hạn dài (proxy, ký quỹ) tính phút/giờ/ngày; hạn ngắn (lệnh nạp QR) tính
 *  giây/phút. Trước đây mỗi trang tự viết một bản. */

/** "còn 23 giờ" / "còn 3 ngày" — null khi đã quá hạn. Thang: phút → giờ (dưới
 *  48h) → ngày. Dùng cho hạn proxy/tài nguyên. */
export function timeLeftLabel(expiresAt: string): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `còn ${Math.max(1, minutes)} phút`;
  if (minutes < 48 * 60) return `còn ${Math.floor(minutes / 60)} giờ`;
  return `còn ${Math.floor(minutes / (24 * 60))} ngày`;
}

/** "còn 45 giây" / "còn 12 phút" — null khi đã quá hạn. Thang mịn cho deadline
 *  tính bằng phút (lệnh nạp chờ quét QR, poll lại mỗi nhịp). */
export function timeLeftFine(expiresAt: string): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  if (ms < 60_000) return `còn ${Math.ceil(ms / 1000)} giây`;
  return `còn ${Math.ceil(ms / 60_000)} phút`;
}
