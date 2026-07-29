/** Icon ỔN ĐỊNH cho danh mục — map theo từ khoá trong tên, một danh mục một
 *  icon ở mọi nơi. Thay cho trò gán icon theo vị trí mảng (iconFor(i)) từng
 *  làm cùng một danh mục mang hai icon khác nhau ngay trên một trang.
 *  DB có field Category.icon nhưng hiện toàn null — khi nào admin đặt icon
 *  thật thì ưu tiên nó ở đây. */

import type { ComponentType } from "react";
import { Bolt, Grid, Package, Shield, Store, Users, Wallet } from "@/components/Icons";

const KEYWORD_ICONS: Array<[RegExp, ComponentType<{ size?: number; className?: string }>]> = [
  [/mạng xã hội|social/i, Users],
  [/proxy|vpn/i, Bolt],
  [/cloud|server/i, Package],
  [/thanh toán|credit|payment/i, Wallet],
  [/takedown|bảo vệ/i, Shield],
];

export function categoryIcon(name: string) {
  for (const [re, icon] of KEYWORD_ICONS) {
    if (re.test(name)) return icon;
  }
  return Store;
}

export { Grid as CategoryFallbackIcon };
