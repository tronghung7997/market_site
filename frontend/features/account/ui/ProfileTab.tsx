"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney, type DisplayCurrency } from "@/lib/money";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { ProfileUpdate } from "@/lib/types";
import { Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Panel, Row, SaveBar, Segmented } from "./shared";

type Form = { display_name: string; phone: string; telegram_username: string };

const phoneOk = (v: string) => v.trim() === "" || /^\+?[0-9]{8,15}$/.test(v.replace(/[^0-9+]/g, ""));
const telegramOk = (v: string) => v.trim() === "" || /^[A-Za-z0-9_]{5,32}$/.test(v.trim().replace(/^@/, ""));

/** Who you are + how the site should look for you. Language and currency only
 *  appear when the admin allows visitors to switch them (Cài đặt › Hiển thị). */
export function ProfileTab() {
  const t = useTranslations("account");
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const { account, refresh } = useAuth();
  const locale = useLocale() as "vi" | "en";
  const router = useRouter();
  const pathname = usePathname();
  const { currency, setCurrency, allowToggle, allowLocaleToggle } = useMoney();

  const baseline = React.useMemo<Form>(() => ({
    display_name: account?.display_name ?? "",
    phone: account?.phone ?? "",
    telegram_username: account?.telegram_username ?? "",
  }), [account?.display_name, account?.phone, account?.telegram_username]);
  const [form, setForm] = React.useState<Form>(baseline);
  React.useEffect(() => { setForm(baseline); }, [baseline]);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const problem = !phoneOk(form.phone) ? t("phoneInvalid") : !telegramOk(form.telegram_username) ? t("telegramInvalid") : form.display_name.trim().length > 80 ? t("nameTooLong") : undefined;

  const save = useMutation({
    mutationFn: (patch: ProfileUpdate) => api.updateMe(patch),
    onSuccess: async () => { await refresh(); toast.success(t("saved")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("saveFailed"))),
  });

  /** Preference switches apply instantly (cookie) and are remembered on the account. */
  const changeLocale = (next: "vi" | "en") => {
    if (next === locale) return;
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;SameSite=Lax`;
    void api.updateMe({ preferred_locale: next }).catch(() => {});
    router.replace(`${pathname}?tab=profile`, { locale: next });
  };
  const changeCurrency = (next: DisplayCurrency) => {
    if (next === currency) return;
    setCurrency(next);
    api.updateMe({ preferred_currency: next }).then(() => toast.success(t("currencySaved", { currency: next })), (e) => toast.error(apiErrorMessage(e, t("saveFailed"))));
  };

  if (!account) return null;
  const showPrefs = allowLocaleToggle || allowToggle;

  return (
    <div className="space-y-5">
      <Panel title={t("profileTitle")} hint={t("profileHint")}>
        <div className="space-y-4">
          <Row label={t("displayName")} hint={t("displayNameHint")}>
            <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={80} placeholder={t("displayNamePlaceholder")} />
          </Row>
          <Row label={t("email")} hint={t("emailHint")}>
            <Input value={account.email} readOnly className="bg-raised/60 text-muted" />
          </Row>
          <Row label={t("phone")} hint={t("phoneHint")} error={phoneOk(form.phone) ? undefined : t("phoneInvalid")}>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" maxLength={32} placeholder="0901 234 567" />
          </Row>
          <Row label={t("telegram")} hint={t("telegramHint")} error={telegramOk(form.telegram_username) ? undefined : t("telegramInvalid")}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-faint">@</span>
              <Input value={form.telegram_username} onChange={(e) => setForm({ ...form, telegram_username: e.target.value.replace(/^@/, "") })} maxLength={32} className="pl-7 font-mono text-[13px]" placeholder="ten_telegram" />
            </div>
          </Row>
        </div>
        <SaveBar
          dirty={dirty}
          valid={!problem}
          problem={problem}
          saving={save.isPending}
          onReset={() => setForm(baseline)}
          onSave={() => save.mutate({ display_name: form.display_name.trim(), phone: form.phone.trim(), telegram_username: form.telegram_username.trim() })}
        />
      </Panel>

      {showPrefs && (
        <Panel title={t("prefsTitle")} hint={t("prefsHint")}>
          <div className="space-y-4">
            {allowLocaleToggle && (
              <Row label={t("language")} hint={t("languageHint")}>
                <Segmented value={locale} label={t("language")} onChange={changeLocale} options={[{ value: "vi", label: "Tiếng Việt" }, { value: "en", label: "English" }]} />
              </Row>
            )}
            {allowToggle && (
              <Row label={t("currency")} hint={t("currencyHint")}>
                <Segmented value={currency} label={t("currency")} onChange={changeCurrency} options={[{ value: "VND", label: "VND ₫" }, { value: "USD", label: "USD $" }]} />
              </Row>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
