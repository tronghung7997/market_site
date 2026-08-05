/** Evidence type field keys — labels live in messages/orders.evidence*. */

export const EVIDENCE_TYPE_KEYS: Record<string, string[]> = {
  account: ["username", "issue"],
  proxy: ["ip", "error"],
  server: ["server_ip", "error"],
  payment: ["transaction_id", "error"],
  other: [],
};

/** Legacy shape kept for seller/admin call sites that still read labels here. */
export interface EvidenceField {
  key: string;
  label: string;
  placeholder: string;
}

export const EVIDENCE_TYPES: Record<string, { label: string; fields: EvidenceField[] }> = {
  account: {
    label: "Account (social / email)",
    fields: [
      { key: "username", label: "Username / handle", placeholder: "@username or email" },
      { key: "issue", label: "Issue encountered", placeholder: "e.g. locked, wrong password" },
    ],
  },
  proxy: {
    label: "Proxy / VPN",
    fields: [
      { key: "ip", label: "Issued IP address", placeholder: "1.2.3.4:8080" },
      { key: "error", label: "Connection error", placeholder: "e.g. timeout, auth failed" },
    ],
  },
  server: {
    label: "Server / Cloud",
    fields: [
      { key: "server_ip", label: "Server IP / host", placeholder: "e.g. 203.0.113.5" },
      { key: "error", label: "Access / SSH error", placeholder: "Describe the error" },
    ],
  },
  payment: {
    label: "Payment / Credit",
    fields: [
      { key: "transaction_id", label: "Transaction ID", placeholder: "e.g. TXN123456" },
      { key: "error", label: "Error / mismatch", placeholder: "e.g. wrong amount" },
    ],
  },
  other: { label: "Other", fields: [] },
};

export function evidenceFieldLabel(evidenceType: string | null | undefined, key: string): string {
  if (!evidenceType) return key;
  return EVIDENCE_TYPES[evidenceType]?.fields.find((f) => f.key === key)?.label ?? key;
}

export function evidenceTypeLabel(evidenceType: string | null | undefined): string {
  if (!evidenceType) return "";
  return EVIDENCE_TYPES[evidenceType]?.label ?? evidenceType;
}
