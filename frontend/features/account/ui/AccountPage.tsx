"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import { Spinner, Tag } from "@/components/ui";
import { Bell, Percent, ShieldCheck, Store, User } from "@/components/Icons";
import { ProfileTab } from "./ProfileTab";
import { SecurityTab } from "./SecurityTab";
import { NotificationsTab } from "./NotificationsTab";
import { ReferralTab } from "./ReferralTab";
import { SellerTab } from "./SellerTab";

const TABS = ["profile", "security", "notifications", "referral", "seller"] as const;
export type AccountTab = (typeof TABS)[number];
const parseTab = (raw: string | null): AccountTab => (TABS.includes(raw as AccountTab) ? (raw as AccountTab) : "profile");

export function initials(name: string | null | undefined, email: string): string {
  const source = (name && name.trim()) || email;
  const parts = source.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** `/account`: one page for everything about the signed-in user, tabs in the URL. */
export function AccountPage() {
  const t = useTranslations("account");
  const locale = useLocale();
  const { account, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState<AccountTab>(() => parseTab(searchParams.get("tab")));
  const isSeller = Boolean(account?.roles.includes("seller"));

  React.useEffect(() => {
    if (!loading && !account) router.replace(`/login?next=/account${tab !== "profile" ? `?tab=${tab}` : ""}`);
  }, [account, loading, router, tab]);
  React.useEffect(() => { setTab(parseTab(searchParams.get("tab"))); }, [searchParams]);

  const select = (next: AccountTab) => {
    setTab(next);
    // replaceState keeps this a pure client-side switch: no RSC round-trip.
    const url = new URL(window.location.href);
    if (next === "profile") url.searchParams.delete("tab"); else url.searchParams.set("tab", next);
    url.searchParams.delete("setup");
    window.history.replaceState(window.history.state, "", url.toString());
  };

  if (loading || !account) return <div className="grid flex-1 place-items-center py-24"><Spinner /></div>;

  const items: { key: AccountTab; label: string; icon: typeof User; hidden?: boolean }[] = [
    { key: "profile", label: t("tabProfile"), icon: User },
    { key: "security", label: t("tabSecurity"), icon: ShieldCheck },
    { key: "notifications", label: t("tabNotifications"), icon: Bell },
    { key: "referral", label: t("tabReferral"), icon: Percent },
    { key: "seller", label: t("tabSeller"), icon: Store, hidden: !isSeller },
  ];
  const activeTab = tab === "seller" && !isSeller ? "profile" : tab;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-iris-soft font-serif text-[20px] font-semibold text-iris-hi">
          {initials(account.display_name, account.email)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-[26px] tracking-tight text-fg">{account.display_name?.trim() || account.email}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            {account.display_name?.trim() && <span className="truncate">{account.email}</span>}
            {account.email_verified ? <Tag tone="good">{t("emailVerified")}</Tag> : <Tag tone="warn">{t("emailUnverified")}</Tag>}
            {account.totp_enabled && <Tag tone="iris">2FA</Tag>}
            {account.created_at && <span className="text-faint">{t("memberSince", { date: formatDate(account.created_at, locale) })}</span>}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label={t("title")} className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
          {items.filter((i) => !i.hidden).map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => select(i.key)}
              aria-current={activeTab === i.key ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition-colors",
                activeTab === i.key ? "bg-iris-soft text-iris-hi" : "text-muted hover:bg-raised hover:text-fg",
              )}
            >
              <i.icon size={16} className="shrink-0" />
              {i.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "security" && <SecurityTab autoStart2fa={searchParams.get("setup") === "2fa"} />}
          {activeTab === "notifications" && <NotificationsTab />}
          {activeTab === "referral" && <ReferralTab />}
          {activeTab === "seller" && isSeller && <SellerTab />}
        </div>
      </div>
    </div>
  );
}
