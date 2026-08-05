"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sellerTierLabel } from "@/lib/seller-tier";
import type { Provider } from "@/lib/types";
import { Button, Card, Field, Input, Spinner, Tag } from "@/components/ui";
import { ArrowRight, Check, Clock, Edit2, Info, Plug, Shield, X } from "@/components/Icons";

const MIN_TIER_FOR_PROVIDERS = "trusted";
const MIN_TIER_LABEL = sellerTierLabel(MIN_TIER_FOR_PROVIDERS);

const ADAPTER_VALUES = ["seller_gateway", "seller_task_webhook"] as const;

const REVIEW_ICON: Record<string, typeof Check> = {
  approved: Check,
  pending_review: Clock,
  rejected: X,
  disabled: X,
};

const REVIEW_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  approved: "good",
  pending_review: "warn",
  rejected: "bad",
  disabled: "neutral",
};

type EndpointEntry = { name: string; path: string };

function emptyForm() {
  return { name: "", adapter_type: "seller_gateway", base_url: "", api_key: "", webhook_secret: "", endpoint_map: [] as EndpointEntry[] };
}

function endpointEntries(map: unknown): EndpointEntry[] {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  return Object.entries(map as Record<string, unknown>).flatMap(([name, path]) =>
    typeof path === "string" ? [{ name, path }] : [],
  );
}

function buildEndpointMap(
  entries: EndpointEntry[],
  t: (key: string, values?: Record<string, string>) => string,
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const name = entry.name.trim();
    const path = entry.path.trim();
    if (!name && !path) continue;
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
      throw new Error(t("endpointNameInvalid"));
    }
    if (!path.startsWith("/")) {
      throw new Error(t("endpointPathInvalid", { name }));
    }
    if (result[name]) throw new Error(t("endpointDuplicate", { name }));
    result[name] = path;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildConfig(
  form: ReturnType<typeof emptyForm>,
  t: (key: string, values?: Record<string, string>) => string,
): Record<string, unknown> {
  const config: Record<string, unknown> = { base_url: form.base_url, api_key: form.api_key };
  if (form.adapter_type === "seller_task_webhook") config.webhook_secret = form.webhook_secret;
  const endpointMap = buildEndpointMap(form.endpoint_map, t);
  if (endpointMap) config.endpoint_map = endpointMap;
  return config;
}

function useAdapterOptions() {
  const t = useTranslations("seller");
  return [
    {
      value: "seller_gateway",
      label: t("adapterImmediate"),
      description: t("adapterImmediateDesc"),
    },
    {
      value: "seller_task_webhook",
      label: t("adapterBackground"),
      description: t("adapterBackgroundDesc"),
    },
  ] as const;
}

function useReviewTag(status: string) {
  const t = useTranslations("seller");
  const key = status in REVIEW_TONE ? status : "pending_review";
  const labels: Record<string, string> = {
    approved: t("reviewApproved"),
    pending_review: t("reviewPending"),
    rejected: t("reviewRejected"),
    disabled: t("reviewDisabled"),
  };
  return {
    tone: REVIEW_TONE[key] ?? "warn",
    label: labels[key] ?? t("reviewPending"),
    icon: REVIEW_ICON[key] ?? Clock,
  };
}

function reviewMessage(note: string, t: ReturnType<typeof useTranslations<"seller">>) {
  const jsonStart = note.indexOf("{");
  if (jsonStart < 0) return note;

  try {
    const details = JSON.parse(note.slice(jsonStart)) as {
      health?: { status?: string; message?: string };
      provision_test?: { error?: string } | null;
    };
    const reason = details.health?.message ?? details.provision_test?.error;
    if (reason) return t("reviewConnectFailed", { reason });
  } catch {
    // Keep free-form admin notes when the payload is not valid JSON.
  }
  return t("reviewNeedUpdate");
}

function EndpointMapEditor({ entries, onChange }: { entries: EndpointEntry[]; onChange: (entries: EndpointEntry[]) => void }) {
  const t = useTranslations("seller");
  const tc = useTranslations("common");
  const update = (index: number, key: keyof EndpointEntry, value: string) => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  };

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">{t("endpointMapHint")}</p>
      {entries.map((entry, index) => (
        <div key={`${index}-${entry.name}`} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
          <Input value={entry.name} onChange={(e) => update(index, "name", e.target.value)} placeholder="search" aria-label={t("endpointName")} />
          <Input value={entry.path} onChange={(e) => update(index, "path", e.target.value)} placeholder="/v2/search" aria-label={t("endpointPath")} />
          <Button size="sm" variant="ghost" onClick={() => onChange(entries.filter((_, i) => i !== index))}>{tc("delete")}</Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...entries, { name: "", path: "" }])}>{t("addEndpoint")}</Button>
    </div>
  );
}

function TestSummary({ result }: { result: { health: Record<string, unknown>; provision_test: Record<string, unknown> | null; provision_test_skipped_reason?: string | null } }) {
  const t = useTranslations("seller");
  const health = result.health ?? {};
  const healthy = health.status === "healthy";
  const probeSkipped = health.probe === "skipped";
  const provisionSucceeded = result.provision_test?.success === true;
  return (
    <div className="space-y-2 text-[12.5px]">
      <p className={healthy ? "text-good" : "text-bad"}>{healthy ? t("testConfigValid") : t("testConfigInvalid")}</p>
      {probeSkipped ? (
        <p className="text-warn">{t("testUpstreamUnverified", { message: String(health.message) })}</p>
      ) : health.message ? (
        <p className="text-muted">{String(health.message)}</p>
      ) : null}
      {result.provision_test ? (
        <p className={provisionSucceeded ? "text-good" : "text-bad"}>
          {provisionSucceeded
            ? t("testProvisionOk")
            : t("testProvisionFailed", { error: String(result.provision_test.error ?? t("testProvisionUnknown")) })}
        </p>
      ) : null}
      {result.provision_test_skipped_reason && (
        <p className="text-muted">{t("testProvisionSkipped", { reason: result.provision_test_skipped_reason })}</p>
      )}
    </div>
  );
}

function ProviderCard({ provider, onChanged }: { provider: Provider; onChanged: () => void }) {
  const t = useTranslations("seller");
  const adapterOptions = useAdapterOptions();
  const reviewInfo = useReviewTag(provider.review_status);
  const ReviewIcon = reviewInfo.icon;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    name: provider.name,
    adapter_type: provider.adapter_type,
    base_url: (provider.config.base_url as string) ?? "",
    api_key: "",
    webhook_secret: "",
    endpoint_map: endpointEntries(provider.config.endpoint_map),
  }));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    health: Record<string, unknown>;
    provision_test: Record<string, unknown> | null;
    provision_test_skipped_reason?: string | null;
  } | null>(null);
  const [error, setError] = useState("");

  const handleTest = async () => {
    setTesting(true);
    setError("");
    try {
      setTestResult(await api.testSellerProvider(provider.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("providerTestFailed"));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const config: Record<string, unknown> = { base_url: form.base_url };
      if (form.api_key) config.api_key = form.api_key;
      if (provider.adapter_type === "seller_task_webhook" && form.webhook_secret) {
        config.webhook_secret = form.webhook_secret;
      }
      const endpointMap = buildEndpointMap(form.endpoint_map, t as (key: string, values?: Record<string, string>) => string);
      if (endpointMap) config.endpoint_map = endpointMap;
      await api.updateSellerProvider(provider.id, { config });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("providerSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14.5px] font-semibold">{provider.name}</h3>
            <Tag tone={reviewInfo.tone}><ReviewIcon size={11} />{reviewInfo.label}</Tag>
          </div>
          <p className="text-[12.5px] text-muted mt-0.5">
            {adapterOptions.find((o) => o.value === provider.adapter_type)?.label ?? provider.adapter_type}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={handleTest} disabled={testing}>
            {testing ? t("testing") : t("testConnection")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            <Edit2 size={13} />{editing ? t("close") : t("edit")}
          </Button>
        </div>
      </div>

      {provider.review_status === "rejected" && provider.review_note && (
        <p className="text-[12.5px] text-bad bg-bad-soft border border-bad/25 rounded-lg px-3 py-2">
          <strong>{t("providerRejected")}</strong>{reviewMessage(provider.review_note, t)}
        </p>
      )}
      {provider.review_status === "pending_review" && (
        <p className="text-[12.5px] text-muted">
          {t("providerPending")}
        </p>
      )}
      {provider.review_status === "approved" && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-good-soft border border-good/25 px-3 py-2">
          <p className="text-[12.5px] text-good">{t("providerReady")}</p>
          <Link href="/seller/products" className="text-[12.5px] font-medium text-iris-hi underline">{t("goToProducts")}</Link>
        </div>
      )}

      {testResult && <div className="bg-raised border border-line rounded-lg p-3"><TestSummary result={testResult} /></div>}

      {editing && (
        <div className="space-y-3 border-t border-line pt-4">
          <Field label={t("apiBaseUrl")}>
            <Input autoComplete="url" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.your-backend.com" />
          </Field>
          <Field label={t("apiKey")} hint={t("apiKeyHint")}>
            <Input type="password" autoComplete="new-password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder={t("apiKeyPlaceholder")} />
          </Field>
          {provider.adapter_type === "seller_task_webhook" && (
            <Field label={t("webhookSecretLabel")} hint={t("webhookSecretHint")}>
              <Input type="password" autoComplete="new-password" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} placeholder={t("webhookSecretPlaceholder")} />
            </Field>
          )}
          <Field label={t("nonStandardEndpoints")}>
            <EndpointMapEditor entries={form.endpoint_map} onChange={(endpoint_map) => setForm({ ...form, endpoint_map })} />
          </Field>
          {error && <p className="text-[12.5px] text-bad">{error}</p>}
          <div className="flex items-center gap-2 bg-warn-soft border border-warn/25 rounded-lg px-3 py-2">
            <Shield size={14} className="text-warn shrink-0" />
            <p className="text-[12px] text-warn">{t("configurationWarning")}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>{t("cancel")}</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? t("saving") : t("saveChanges")}</Button>
          </div>
        </div>
      )}
      {!editing && error && <p className="text-[12.5px] text-bad">{error}</p>}
    </Card>
  );
}

function CreateProviderForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const t = useTranslations("seller");
  const adapterOptions = useAdapterOptions();
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setSaving(true);
    setError("");
    try {
      const config = buildConfig(form, t as (key: string, values?: Record<string, string>) => string);
      await api.createSellerProvider({ name: form.name, adapter_type: form.adapter_type, config });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("submitFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="p-5 sm:p-6 space-y-6">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-iris-hi">{t("newConnection")}</p>
            <h3 className="mt-1 text-[19px] font-semibold tracking-tight">{t("connectYourBackend")}</h3>
            <p className="mt-1.5 text-[13px] leading-5 text-muted max-w-xl">
              {t("createIntro")}
            </p>
          </div>

          <section className="space-y-3" aria-labelledby="connection-name">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-faint">{t("step", { count: 1 })}</p>
              <h4 id="connection-name" className="text-[14px] font-semibold">{t("nameStepTitle")}</h4>
            </div>
            <Field label={t("connectionName")} hint={t("connectionNameHint")}>
              <Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("connectionNamePlaceholder")} />
            </Field>
          </section>

          <section className="space-y-3 border-t border-line pt-5" aria-labelledby="connection-mode">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-faint">{t("step2")}</p>
              <h4 id="connection-mode" className="text-[14px] font-semibold">{t("modeStepTitle")}</h4>
              <p className="mt-0.5 text-[12px] text-muted">{t("modeStepHint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("modeAria")}>
              {adapterOptions.map((option) => {
                const selected = form.adapter_type === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setForm({ ...form, adapter_type: option.value })}
                    className={`min-w-0 rounded-xl border p-4 text-left transition-colors ${selected ? "border-iris bg-iris-soft shadow-sm" : "border-line bg-surface hover:border-line-2 hover:bg-raised"}`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-iris bg-iris text-white" : "border-line-2 bg-surface"}`}>
                      {selected && <Check size={12} />}
                    </span>
                    <span className="mt-3 block text-[13px] font-semibold">{option.label}</span>
                    <span className="mt-1 block text-[12px] leading-5 text-muted">{option.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 border-t border-line pt-5" aria-labelledby="connection-access">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-faint">{t("step3")}</p>
              <h4 id="connection-access" className="text-[14px] font-semibold">{t("accessStepTitle")}</h4>
              <p className="mt-0.5 text-[12px] text-muted">{t("accessStepHint")}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-iris-hi">{t("directionOut")}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted">{t("directionOutDesc")}</p>
              </div>
              <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-iris-hi">{t("directionIn")}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted">{t("directionInDesc")}</p>
              </div>
            </div>
            <Field label={t("baseUrlLabel")} hint={t("baseUrlHint")}>
              <Input autoComplete="url" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder={t("baseUrlPlaceholder")} />
            </Field>
            <Field label={t("apiKeyCreateLabel")} hint={t("apiKeyCreateHint")}>
              <Input type="password" autoComplete="new-password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder={t("apiKeyCreatePlaceholder")} />
            </Field>
            {form.adapter_type === "seller_task_webhook" && (
              <Field label={t("webhookCreateLabel")} hint={t("webhookCreateHint")}>
                <Input type="password" autoComplete="new-password" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} placeholder={t("webhookCreatePlaceholder")} />
              </Field>
            )}
            {form.adapter_type === "seller_gateway" && (
              <details className="rounded-lg border border-line bg-raised px-3 py-2.5">
                <summary className="cursor-pointer text-[12.5px] font-medium">{t("nonStandardDetails")}</summary>
                <div className="pt-3">
                  <EndpointMapEditor entries={form.endpoint_map} onChange={(endpoint_map) => setForm({ ...form, endpoint_map })} />
                </div>
              </details>
            )}
          </section>

          {error && <p role="alert" className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2.5 text-[12.5px] text-bad">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <p className="text-[12px] leading-5 text-muted max-w-md">{t("connectionSubmittedHint")}</p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleSubmit} disabled={saving || !form.name || !form.base_url}>
                {saving ? t("submitting") : t("submitForTesting")}<ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </div>

        <aside className="border-t border-line bg-raised p-5 sm:p-6 lg:border-t-0 lg:border-l" aria-label={t("roadmapAria")}>
          <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-faint">{t("roadmapKicker")}</p>
          <h4 className="mt-1 text-[14px] font-semibold">{t("roadmapTitle")}</h4>
          <ol className="mt-5 space-y-5">
            <li className="relative flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-iris text-[11px] font-semibold text-white">1</span>
              <div><p className="text-[12.5px] font-medium">{t("roadmap1Title")}</p><p className="mt-0.5 text-[12px] leading-5 text-muted">{t("roadmap1Desc")}</p></div>
            </li>
            <li className="relative flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface text-[11px] font-semibold">2</span>
              <div><p className="text-[12.5px] font-medium">{t("roadmap2Title")}</p><p className="mt-0.5 text-[12px] leading-5 text-muted">{t("roadmap2Desc")}</p></div>
            </li>
            <li className="relative flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface text-[11px] font-semibold">3</span>
              <div><p className="text-[12.5px] font-medium">{t("roadmap3Title")}</p><p className="mt-0.5 text-[12px] leading-5 text-muted">{t("roadmap3Desc")}</p></div>
            </li>
          </ol>
          <div className="mt-6 rounded-lg border border-iris/20 bg-iris-soft px-3 py-3">
            <div className="flex gap-2"><Info size={14} className="mt-0.5 shrink-0 text-iris-hi" /><p className="text-[12px] leading-5 text-muted">{t("buyerKeyNote")}</p></div>
          </div>
        </aside>
      </div>
    </Card>
  );
}

export default function SellerProvidersPage() {
  const t = useTranslations("seller");
  const { account } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const eligible = account?.seller_tier === "trusted" || account?.seller_tier === "enterprise";

  const load = async () => {
    setLoading(true);
    try {
      setProviders(await api.sellerProviders());
    } catch {
      // Tier gate below handles empty list for ineligible sellers.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <div className="py-16"><Spinner /></div>;

  if (!eligible) {
    return (
      <Card className="p-8 text-center">
        <Shield size={40} className="mx-auto text-faint mb-3" />
        <h2 className="text-[16px] font-semibold mb-1.5">{t("tierRequiredTitle", { tier: MIN_TIER_LABEL })}</h2>
        <p className="text-[13px] text-muted max-w-md mx-auto">
          {t("tierRequiredProviders", { tier: MIN_TIER_LABEL, current: sellerTierLabel(account?.seller_tier) })}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-faint">{t("providersKicker")}</p>
          <h2 className="mt-1 text-[20px] font-semibold tracking-tight">{t("providersTitle")}</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted max-w-2xl">{t("providersSubtitle")}</p>
        </div>
        {!creating && <Button onClick={() => { setJustSubmitted(false); setCreating(true); }}>{t("connectBackend")} <ArrowRight size={14} /></Button>}
      </div>

      {!creating && providers.length === 0 && (
        <Card className="border-iris/20 bg-iris-soft p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-[13px] font-semibold">{t("providersReadyTitle")}</p><p className="mt-1 text-[12.5px] leading-5 text-muted">{t("providersReadyDescription")}</p></div>
            <Button size="sm" onClick={() => setCreating(true)}>{t("startConnection")}</Button>
          </div>
        </Card>
      )}

      {creating && (
        <CreateProviderForm
          onCreated={() => { setCreating(false); setJustSubmitted(true); load(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {justSubmitted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-good/25 bg-good-soft px-4 py-3">
          <div><p className="text-[13px] font-semibold text-good">{t("providerSubmitted")}</p><p className="mt-0.5 text-[12.5px] text-muted">{t("providerSubmittedNext")}</p></div>
          <Tag tone="warn"><Clock size={11} />{t("needsChecking")}</Tag>
        </div>
      )}

      {providers.length === 0 && !creating ? (
        <Card className="p-8 text-center">
          <Plug size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] font-medium">{t("providersEmptyTitle")}</p>
          <p className="mt-1 text-[12.5px] text-muted">{t("providersEmptyDescription")}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => <ProviderCard key={p.id} provider={p} onChanged={load} />)}
        </div>
      )}

      {providers.some((p) => p.review_status === "approved") && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3 border-good/25 bg-good-soft">
          <div>
            <p className="text-[13px] font-medium">{t("providerApproved")}</p>
            <p className="text-[12px] text-muted">{t("providerApprovedNext")}</p>
          </div>
          <Link href="/seller/products"><Button size="sm">{t("goToProducts")}</Button></Link>
        </Card>
      )}
    </div>
  );
}
