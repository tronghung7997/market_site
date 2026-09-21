"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { NotificationPrefKey } from "@/lib/types";
import { Switch } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Panel } from "./shared";

const KEYS: NotificationPrefKey[] = ["orders", "disputes", "wallet", "marketing"];

/** Per-category e-mail switches; each flips immediately. Security mail cannot be turned off. */
export function NotificationsTab() {
  const t = useTranslations("account");
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const { account, refresh } = useAuth();
  const prefs = account?.notification_prefs ?? {};
  const toggle = useMutation({
    mutationFn: ({ key, on }: { key: NotificationPrefKey; on: boolean }) => api.updateMe({ notification_prefs: { [key]: on } }),
    onSuccess: async (_, { key, on }) => { await refresh(); toast.success(on ? t("notifOn", { name: t(`notif_${key}`) }) : t("notifOff", { name: t(`notif_${key}`) })); },
    onError: (e) => toast.error(apiErrorMessage(e, t("saveFailed"))),
  });
  if (!account) return null;
  return (
    <div className="space-y-5">
      <Panel title={t("notifTitle")} hint={t("notifHint", { email: account.email })}>
        <ul className="divide-y divide-line">
          {KEYS.map((key) => {
            const on = prefs[key] !== false;
            return (
              <li key={key} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[13.5px] font-medium", on ? "text-fg" : "text-muted")}>{t(`notif_${key}`)}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted">{t(`notif_${key}_hint`)}</p>
                </div>
                <Switch checked={on} disabled={toggle.isPending} onChange={(v) => toggle.mutate({ key, on: v })} label={t(`notif_${key}`)} />
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[12px] text-faint">{t("notifSecurityNote")}</p>
      </Panel>
    </div>
  );
}
