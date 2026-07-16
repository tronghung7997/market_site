export interface EvidenceField {
  key: string;
  label: string;
  placeholder: string;
}

export const EVIDENCE_TYPES: Record<string, { label: string; fields: EvidenceField[] }> = {
  account: {
    label: "Tài khoản (mạng xã hội / email)",
    fields: [
      { key: "username", label: "Tên đăng nhập / handle", placeholder: "@username hoặc email" },
      { key: "issue", label: "Vấn đề gặp phải", placeholder: "Ví dụ: bị khoá, sai mật khẩu, không khôi phục được" },
    ],
  },
  proxy: {
    label: "Proxy / VPN",
    fields: [
      { key: "ip", label: "Địa chỉ IP được cấp", placeholder: "1.2.3.4:8080" },
      { key: "error", label: "Lỗi khi kết nối", placeholder: "Ví dụ: timeout, sai xác thực" },
    ],
  },
  server: {
    label: "Server / Cloud",
    fields: [
      { key: "server_ip", label: "IP / host server", placeholder: "vd: 203.0.113.5" },
      { key: "error", label: "Lỗi khi truy cập / SSH", placeholder: "Mô tả lỗi cụ thể" },
    ],
  },
  payment: {
    label: "Thanh toán / Credit",
    fields: [
      { key: "transaction_id", label: "Mã giao dịch", placeholder: "vd: TXN123456" },
      { key: "error", label: "Lỗi / sai lệch", placeholder: "Ví dụ: sai số tiền, không nhận được credit" },
    ],
  },
  other: { label: "Khác", fields: [] },
};

export function evidenceFieldLabel(evidenceType: string | null | undefined, key: string): string {
  if (!evidenceType) return key;
  return EVIDENCE_TYPES[evidenceType]?.fields.find((f) => f.key === key)?.label ?? key;
}

export function evidenceTypeLabel(evidenceType: string | null | undefined): string {
  if (!evidenceType) return "";
  return EVIDENCE_TYPES[evidenceType]?.label ?? evidenceType;
}
