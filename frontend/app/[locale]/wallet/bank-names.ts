/** Display names for the bank codes a deposit rail reports (VietQR short
 *  codes, SePay's names). Unknown codes show as sent. */

const BANK_NAMES: Record<string, string> = {
  TPB: "TPBank", TPBANK: "TPBank",
  MB: "MB Bank", MBB: "MB Bank", MBBANK: "MB Bank",
  VCB: "Vietcombank", VIETCOMBANK: "Vietcombank",
  ACB: "ACB",
  TCB: "Techcombank", TECHCOMBANK: "Techcombank",
  BIDV: "BIDV",
  ICB: "VietinBank", CTG: "VietinBank", VIETINBANK: "VietinBank",
  VPB: "VPBank", VPBANK: "VPBank",
  STB: "Sacombank", SACOMBANK: "Sacombank",
  VBA: "Agribank", AGRIBANK: "Agribank",
  HDB: "HDBank", HDBANK: "HDBank",
  VIB: "VIB",
  MSB: "MSB",
  OCB: "OCB",
  SHB: "SHB",
  SEAB: "SeABank", SEABANK: "SeABank",
  LPB: "LPBank", LPBANK: "LPBank",
  EIB: "Eximbank", EXIMBANK: "Eximbank",
  NAB: "Nam A Bank", NAMABANK: "Nam A Bank",
  KLB: "KienlongBank",
  BVB: "BVBank",
  CAKE: "CAKE by VPBank",
  TIMO: "Timo",
};

export function bankName(code: string | null | undefined): string | null {
  if (!code) return null;
  return BANK_NAMES[code.replace(/[\s_-]/g, "").toUpperCase()] ?? code;
}
