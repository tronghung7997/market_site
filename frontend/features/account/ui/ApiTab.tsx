"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { ApiKeyCreated, ApiKeyRow, ApiKeyScope } from "@/lib/types";
import { Banner, Button, CopyButton, Field, Input, Skeleton, Tag, Textarea } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/toast";
import { AlertTriangle, BookOpenCheck, Edit2, Key, Plus, Trash } from "@/components/Icons";
import { Panel, relativeTime } from "./shared";
import { parseAllowedIps, parseDailyLimit } from "../model";

const QUERY_KEY = ["me", "api-keys"] as const;
const DEFAULT_DAILY_LIMIT = 1_000_000;

type KeyForm = { name: string; write: boolean; ips: string; limit: string };

function DocsLink() {
  const t = useTranslations("account");
  return (
    <Link href="/docs/api" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">
      <BookOpenCheck size={13} /> {t("apiDocsLink")}
    </Link>
  );
}

/** Buyer API keys for the public sales API (/v1): list, create (shown once), edit limits/IPs, revoke. */
export function ApiTab() {
  const t = useTranslations("account");
  const locale = useLocale();
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: QUERY_KEY, queryFn: api.myApiKeys });
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<ApiKeyCreated | null>(null);
  const [editing, setEditing] = React.useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = React.useState<ApiKeyRow | null>(null);

  const revoke = useMutation({
    mutationFn: (id: number) => api.revokeApiKey(id),
    onSuccess: () => {
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success(t("apiRevoked"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("apiRevokeFailed"))),
  });

  if (keys.isError) {
    return (
      <Panel title={t("apiTitle")}>
        <Banner tone="bad" action={<Button size="sm" variant="secondary" onClick={() => void keys.refetch()}>{t("apiRetry")}</Button>}>
          {apiErrorMessage(keys.error, t("loadFailed"))}
        </Banner>
      </Panel>
    );
  }
  if (keys.isPending) {
    return (
      <Panel title={t("apiTitle")} hint={t("apiHint")}>
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Panel>
    );
  }

  const data = keys.data;
  if (!data.enabled) {
    return (
      <Panel title={t("apiTitle")} hint={t("apiHint")} aside={<DocsLink />}>
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-muted"><Key size={16} /></span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-fg">{t("apiDisabledTitle")}</p>
            <p className="mt-1 max-w-[60ch] text-[12.5px] leading-relaxed text-muted">{t("apiDisabledBody")}</p>
            <Link href="/support" className="mt-3 inline-flex text-[12.5px] font-medium text-iris-hi hover:underline">{t("apiContactSupport")}</Link>
          </div>
        </div>
      </Panel>
    );
  }

  const atCap = data.items.length >= data.max_active;
  return (
    <div className="space-y-5">
      <Panel
        title={t("apiTitle")}
        hint={t("apiHint")}
        aside={
          <div className="flex flex-wrap items-center gap-3">
            <DocsLink />
            <Button size="sm" onClick={() => setCreating(true)} disabled={atCap || !data.email_verified}>
              <Plus size={14} /> {t("apiCreate")}
            </Button>
          </div>
        }
      >
        {!data.email_verified && (
          <Banner tone="warn" icon={<AlertTriangle size={14} />} className="mb-4">{t("apiVerifyEmail")}</Banner>
        )}
        {atCap && <p className="mb-3 text-[12.5px] text-muted">{t("apiCapReached", { max: data.max_active })}</p>}
        <TierRateLimit />
        {data.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
            <p className="text-[13px] font-medium text-fg">{t("apiEmptyTitle")}</p>
            <p className="mt-1 text-[12.5px] text-muted">{t("apiEmptyBody")}</p>
          </div>
        ) : (
          <div role="table" aria-label={t("apiTitle")} className="text-[13px]">
            <div role="row" className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-4 border-b border-line pb-2 text-[11.5px] font-medium text-muted md:grid">
              <span role="columnheader">{t("apiColKey")}</span>
              <span role="columnheader">{t("apiColLastUsed")}</span>
              <span role="columnheader" className="text-right">{t("apiColLimit")}</span>
              <span role="columnheader" className="sr-only">{t("apiColActions")}</span>
            </div>
            {data.items.map((k) => (
              <div key={k.id} role="row" className="grid gap-2 border-b border-line py-3 last:border-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-center md:gap-4">
                <div role="cell" className="min-w-0">
                  <p className="truncate font-medium text-fg">{k.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] text-muted">pk_live_{k.prefix}_…</span>
                    {!k.scopes.includes("orders:write") && <Tag>{t("apiReadOnly")}</Tag>}
                    {k.allowed_ips?.length ? <Tag tone="iris">{t("apiIpCount", { count: k.allowed_ips.length })}</Tag> : null}
                  </p>
                </div>
                <div role="cell" className="text-[12.5px] text-muted">
                  <span className="md:hidden">{t("apiColLastUsed")}: </span>
                  {relativeTime(k.last_used_at, locale, t("apiNeverUsed"))}
                  {k.last_used_ip && <span className="block font-mono text-[11.5px] text-faint">{k.last_used_ip}</span>}
                </div>
                <div role="cell" className="text-[12.5px] md:text-right">
                  <span className="md:hidden text-muted">{t("apiColLimit")}: </span>
                  <span className="font-mono tabular-nums text-fg">{vnd(k.spent_today, locale)}</span>
                  <span className="text-muted"> / {k.daily_spend_limit == null ? t("apiNoLimit") : <span className="font-mono tabular-nums">{vnd(k.daily_spend_limit, locale)}</span>}</span>
                </div>
                <div role="cell" className="flex items-center gap-1 md:justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(k)} aria-label={t("apiEditNamed", { name: k.name })}>
                    <Edit2 size={14} /> {t("apiEdit")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-bad" onClick={() => setRevoking(k)} aria-label={t("apiRevokeNamed", { name: k.name })}>
                    <Trash size={14} /> {t("apiRevoke")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <CreateKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(key) => {
          setCreating(false);
          setCreated(key);
          void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        }}
      />
      <CreatedKeyDialog created={created} onClose={() => setCreated(null)} />
      <EditKeyDialog
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          toast.success(t("apiSaved"));
        }}
      />
      <ConfirmDialog
        open={revoking !== null}
        title={t("apiRevokeTitle", { name: revoking?.name ?? "" })}
        description={t("apiRevokeBody")}
        confirmLabel={t("apiRevoke")}
        cancelLabel={t("apiCancel")}
        tone="danger"
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}

function KeyFields({ form, setForm, errors, showScopes }: {
  form: KeyForm; setForm: (f: KeyForm) => void; errors: { ips?: string; limit?: string; name?: string }; showScopes: boolean;
}) {
  const t = useTranslations("account");
  return (
    <div className="space-y-4">
      <Field label={t("apiName")} error={errors.name}>
        <Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("apiNamePlaceholder")} aria-invalid={Boolean(errors.name)} />
      </Field>
      {showScopes && (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-fg">{t("apiScopes")}</legend>
          <label className="flex items-start gap-2 text-[12.5px] text-muted">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-iris)]" checked={form.write} onChange={(e) => setForm({ ...form, write: e.target.checked })} />
            <span>{t("apiScopeWrite")}</span>
          </label>
          <p className="mt-1 text-[12px] text-faint">{t("apiScopeReadNote")}</p>
        </fieldset>
      )}
      <Field label={t("apiIps")} hint={t("apiIpsHint")} error={errors.ips}>
        <Textarea rows={3} value={form.ips} onChange={(e) => setForm({ ...form, ips: e.target.value })} placeholder="203.0.113.10&#10;198.51.100.0/24" className="font-mono text-[12.5px]" aria-invalid={Boolean(errors.ips)} />
      </Field>
      <Field label={t("apiLimit")} hint={t("apiLimitHint")} error={errors.limit}>
        <Input inputMode="numeric" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} className="font-mono" aria-invalid={Boolean(errors.limit)} />
      </Field>
    </div>
  );
}

function validate(form: KeyForm, t: ReturnType<typeof useTranslations>) {
  const ips = parseAllowedIps(form.ips);
  const limit = parseDailyLimit(form.limit);
  const errors = {
    name: form.name.trim() ? undefined : t("apiNameRequired"),
    ips: ips.invalid.length ? t("apiIpsInvalid", { value: ips.invalid[0] }) : undefined,
    limit: limit === "invalid" ? t("apiLimitInvalid") : undefined,
  };
  return { ips: ips.values, limit: limit === "invalid" ? null : limit, errors, ok: !errors.name && !errors.ips && !errors.limit };
}

function CreateKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (k: ApiKeyCreated) => void }) {
  const t = useTranslations("account");
  const apiErrorMessage = useApiErrorMessage();
  const blank: KeyForm = { name: "", write: true, ips: "", limit: String(DEFAULT_DAILY_LIMIT) };
  const [form, setForm] = React.useState<KeyForm>(blank);
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setForm(blank); setTouched(false); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const checked = validate(form, t);
  const create = useMutation({
    mutationFn: () => {
      const scopes: ApiKeyScope[] = form.write ? ["orders:read", "orders:write"] : ["orders:read"];
      return api.createApiKey({ name: form.name.trim(), scopes, allowed_ips: checked.ips.length ? checked.ips : null, daily_spend_limit: checked.limit });
    },
    onSuccess: onCreated,
    onError: (e) => setError(apiErrorMessage(e, t("apiCreateFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !create.isPending) onClose(); }}>
      <DialogContent className="max-w-lg border-line bg-surface p-5 text-fg">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-fg">{t("apiCreateTitle")}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">{t("apiCreateBody")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); setTouched(true); if (checked.ok) create.mutate(); }}
          className="space-y-4"
        >
          <KeyFields form={form} setForm={setForm} errors={touched ? checked.errors : {}} showScopes />
          {error && <p className="text-[12.5px] text-bad" role="alert">{error}</p>}
          <DialogFooter className="flex-row justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={create.isPending}>{t("apiCancel")}</Button>
            <Button type="submit" size="sm" loading={create.isPending}>{t("apiCreate")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreatedKeyDialog({ created, onClose }: { created: ApiKeyCreated | null; onClose: () => void }) {
  const t = useTranslations("account");
  return (
    <Dialog open={created !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-lg border-line bg-surface p-5 text-fg">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-fg">{t("apiCreatedTitle")}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">{t("apiCreatedBody")}</DialogDescription>
        </DialogHeader>
        {created && (
          <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
            <code className="block break-all font-mono text-[12.5px] text-fg">{created.key}</code>
            <CopyButton text={created.key} className="mt-2 text-[12px]" />
          </div>
        )}
        <Banner tone="warn" icon={<AlertTriangle size={14} />}>{t("apiCreatedWarning")}</Banner>
        <DialogFooter className="flex-row justify-end">
          <Button size="sm" onClick={onClose}>{t("apiCreatedDone")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditKeyDialog({ row, onClose, onSaved }: { row: ApiKeyRow | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("account");
  const apiErrorMessage = useApiErrorMessage();
  const [form, setForm] = React.useState<KeyForm>({ name: "", write: true, ips: "", limit: "" });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (row) {
      setForm({
        name: row.name, write: row.scopes.includes("orders:write"),
        ips: (row.allowed_ips ?? []).join("\n"), limit: row.daily_spend_limit == null ? "" : String(row.daily_spend_limit),
      });
      setError(null);
    }
  }, [row]);
  const checked = validate(form, t);
  const save = useMutation({
    mutationFn: () => api.updateApiKey(row!.id, {
      name: form.name.trim(), allowed_ips: checked.ips.length ? checked.ips : null, daily_spend_limit: checked.limit,
    }),
    onSuccess: onSaved,
    onError: (e) => setError(apiErrorMessage(e, t("saveFailed"))),
  });
  return (
    <Dialog open={row !== null} onOpenChange={(next) => { if (!next && !save.isPending) onClose(); }}>
      <DialogContent className="max-w-lg border-line bg-surface p-5 text-fg">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-fg">{t("apiEditTitle", { name: row?.name ?? "" })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (checked.ok) save.mutate(); }} className="space-y-4">
          <KeyFields form={form} setForm={setForm} errors={checked.errors} showScopes={false} />
          {error && <p className="text-[12.5px] text-bad" role="alert">{error}</p>}
          <DialogFooter className="flex-row justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={save.isPending}>{t("apiCancel")}</Button>
            <Button type="submit" size="sm" loading={save.isPending} disabled={!checked.ok}>{t("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Per-key request limits come from the owner's member tier (L1–L3). */
function TierRateLimit() {
  const t = useTranslations("account");
  const locale = useLocale();
  const tier = useQuery({ queryKey: ["account", "buyer-tier"], queryFn: () => api.myBuyerTier(), staleTime: 60_000 });
  if (!tier.data) return null;
  const level = tier.data.current;
  const name = locale === "vi" ? level.name_vi : level.name_en;
  return (
    <p className="mb-3 text-[12.5px] text-muted">
      {level.api_requests_per_minute == null
        ? t("apiTierUnlimited", { tier: tier.data.tier.toUpperCase(), name })
        : t("apiTierLimit", { tier: tier.data.tier.toUpperCase(), name, requests: level.api_requests_per_minute, orders: level.api_orders_per_minute ?? "∞" })}{" "}
      <Link href="/account?tab=tier" className="font-medium text-iris-hi hover:underline">{t("apiTierLink")}</Link>
    </p>
  );
}
