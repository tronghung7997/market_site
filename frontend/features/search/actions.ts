/**
 * Quick actions for the command palette: role-gated navigation and a couple
 * of app commands (switch language, sign out). Pure data — the palette
 * resolves labels through `search.actions.*` and decides how to run them.
 *
 * `keywords` hold bilingual synonyms so "don hang", "orders" and "purchases"
 * all reach "My orders" regardless of the active locale (matching is
 * accent-folded, see `matchesLabel`).
 */

export type ActionAudience = "everyone" | "anonymous" | "signedIn" | "seller" | "notSeller" | "admin";

export type QuickActionKind = "link" | "switchLocale" | "signOut";

export type QuickAction = {
  id: string;
  /** Key under the `search.actions` namespace. */
  labelKey: string;
  kind: QuickActionKind;
  href?: string;
  audience: ActionAudience;
  keywords: readonly string[];
  /** Name of an icon in `@/components/Icons`. */
  icon: "Home" | "Grid" | "Sparkles" | "Package" | "Wallet" | "Plus" | "ArrowLeftRight" | "MessageCircle" | "Percent" | "User" | "LogOut" | "Store" | "Layers" | "ClipboardList" | "Shield" | "Languages";
};

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: "home", labelKey: "home", kind: "link", href: "/", audience: "everyone", icon: "Home", keywords: ["trang chu", "marketplace", "san", "start"] },
  { id: "categories", labelKey: "categories", kind: "link", href: "/categories", audience: "everyone", icon: "Grid", keywords: ["danh muc", "browse", "shelf", "category"] },
  { id: "solutions", labelKey: "solutions", kind: "link", href: "/solutions", audience: "everyone", icon: "Sparkles", keywords: ["giai phap", "cong cu", "tools", "tiktok id", "facebook id"] },
  { id: "orders", labelKey: "orders", kind: "link", href: "/orders", audience: "signedIn", icon: "Package", keywords: ["don hang", "purchases", "mua", "order"] },
  { id: "wallet", labelKey: "wallet", kind: "link", href: "/wallet", audience: "signedIn", icon: "Wallet", keywords: ["vi", "so du", "balance", "deposit", "nap"] },
  { id: "topUp", labelKey: "topUp", kind: "link", href: "/wallet", audience: "signedIn", icon: "Plus", keywords: ["nap tien", "deposit", "top up", "add funds"] },
  { id: "transactions", labelKey: "transactions", kind: "link", href: "/transactions", audience: "signedIn", icon: "ArrowLeftRight", keywords: ["giao dich", "history", "lich su", "ledger"] },
  { id: "messages", labelKey: "messages", kind: "link", href: "/messages", audience: "signedIn", icon: "MessageCircle", keywords: ["tin nhan", "chat", "inbox", "support"] },
  { id: "affiliate", labelKey: "affiliate", kind: "link", href: "/affiliate", audience: "signedIn", icon: "Percent", keywords: ["gioi thieu", "referral", "hoa hong", "commission"] },
  { id: "becomeSeller", labelKey: "becomeSeller", kind: "link", href: "/seller/apply", audience: "notSeller", icon: "Store", keywords: ["ban hang", "sell", "mo gian hang", "apply"] },
  { id: "sellerDashboard", labelKey: "sellerDashboard", kind: "link", href: "/seller", audience: "seller", icon: "Store", keywords: ["nha ban", "seller", "dashboard", "gian hang"] },
  { id: "sellerProducts", labelKey: "sellerProducts", kind: "link", href: "/seller/products", audience: "seller", icon: "Layers", keywords: ["san pham", "products", "listing"] },
  { id: "sellerNewProduct", labelKey: "sellerNewProduct", kind: "link", href: "/seller/products/new", audience: "seller", icon: "Plus", keywords: ["tao san pham", "dang ban", "new product", "create listing"] },
  { id: "sellerOrders", labelKey: "sellerOrders", kind: "link", href: "/seller/orders", audience: "seller", icon: "ClipboardList", keywords: ["don ban", "seller orders", "fulfil"] },
  { id: "sellerInventory", labelKey: "sellerInventory", kind: "link", href: "/seller/inventory", audience: "seller", icon: "Layers", keywords: ["kho", "ton kho", "stock", "inventory", "resources"] },
  { id: "admin", labelKey: "admin", kind: "link", href: "/admin", audience: "admin", icon: "Shield", keywords: ["quan tri", "console", "control room"] },
  { id: "adminOrders", labelKey: "adminOrders", kind: "link", href: "/admin/orders", audience: "admin", icon: "Shield", keywords: ["quan tri don hang", "admin orders"] },
  { id: "adminProducts", labelKey: "adminProducts", kind: "link", href: "/admin/products", audience: "admin", icon: "Shield", keywords: ["quan tri san pham", "admin products"] },
  { id: "adminDisputes", labelKey: "adminDisputes", kind: "link", href: "/admin/disputes", audience: "admin", icon: "Shield", keywords: ["khieu nai", "dispute", "tranh chap"] },
  { id: "switchLocale", labelKey: "switchLocale", kind: "switchLocale", audience: "everyone", icon: "Languages", keywords: ["ngon ngu", "language", "tieng viet", "english", "locale"] },
  { id: "signIn", labelKey: "signIn", kind: "link", href: "/login", audience: "anonymous", icon: "User", keywords: ["dang nhap", "login", "log in"] },
  { id: "register", labelKey: "register", kind: "link", href: "/register", audience: "anonymous", icon: "User", keywords: ["dang ky", "sign up", "tao tai khoan", "create account"] },
  { id: "signOut", labelKey: "signOut", kind: "signOut", audience: "signedIn", icon: "LogOut", keywords: ["dang xuat", "logout", "log out", "thoat"] },
];

export type ActionViewer = { roles: readonly string[] } | null;

export function actionVisible(action: QuickAction, viewer: ActionViewer): boolean {
  const roles = viewer?.roles ?? [];
  switch (action.audience) {
    case "everyone":
      return true;
    case "anonymous":
      return viewer === null;
    case "signedIn":
      return viewer !== null;
    case "seller":
      return roles.includes("seller");
    case "notSeller":
      return viewer !== null && !roles.includes("seller");
    case "admin":
      return roles.includes("admin");
  }
}

export function visibleActions(viewer: ActionViewer): QuickAction[] {
  return QUICK_ACTIONS.filter((action) => actionVisible(action, viewer));
}
