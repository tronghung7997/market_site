"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAuth } from "@/lib/auth";
import { canUseSellerProviders, sellerTierLabel } from "@/lib/seller-tier";
import type { Provider } from "@/lib/types";
import { Button, Card, Field, Input, Spinner, Tag } from "@/components/ui";
import { ArrowRight, Check, Edit2, Info, Package, Plug, Shield } from "@/components/Icons";

const MIN_TIER_LABEL = sellerTierLabel("trusted");
const MASKED_SECRET = "********";

type IntegrationType = "seller_gateway" | "seller_task_webhook";
type EndpointEntry = { name: string; path: string };
type TestResult = {
  health: Record<string, unknown>;
  provision_test: Record<string, unknown> | null;
  provision_test_skipped_reason?: string | null;
};
type TestDisplay = {
  passed?: boolean;
  health?: Record<string, unknown>;
  provision_test?: Record<string, unknown> | null;
  provision_test_skipped_reason?: string | null;
};

const STATUS_TONE: Record<Provider["review_status"], "good" | "warn" | "bad" | "neutral" | "iris"> = {
  draft: "neutral",
  test_failed: "bad",
  tested: "iris",
  pending_review: "warn",
  approved: "good",
  rejected: "bad",
  disabled: "neutral",
};

function emptyForm(type: IntegrationType = "seller_gateway") {
  return {
    name: "",
    adapter_type: type,
    base_url: "",
    api_key: "",
    webhook_secret: "",
    endpoint_map: [{ name: "", path: "" }] as EndpointEntry[],
  };
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
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const name = entry.name.trim();
    const path = entry.path.trim();
    if (!name && !path) continue;
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) throw new Error(t("endpointNameInvalid"));
    if (!path.startsWith("/")) throw new Error(t("endpointPathInvalid", { name }));
    if (result[name]) throw new Error(t("endpointDuplicate", { name }));
    result[name] = path;
  }
  if (Object.keys(result).length === 0) throw new Error(t("endpointRequired"));
  return result;
}

function EndpointEditor({ entries, onChange }: { entries: EndpointEntry[]; onChange: (entries: EndpointEntry[]) => void }) {
  const t = useTranslations("seller");
  const update = (index: number, key: keyof EndpointEntry, value: string) => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  };
  return (
    <div className="space-y-2">
      <p className="text-[12px] leading-5 text-muted">{t("endpointMapHint")}</p>
      {entries.map((entry, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)_auto]">
          <Input value={entry.name} onChange={(event) => update(index, "name", event.target.value)} placeholder="search" aria-label={t("endpointName")} />
          <Input value={entry.path} onChange={(event) => update(index, "path", event.target.value)} placeholder="/v1/search" aria-label={t("endpointPath")} />
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(entries.filter((_, i) => i !== index))}>{t("removeEndpoint")}</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...entries, { name: "", path: "" }])}>{t("addEndpoint")}</Button>
    </div>
  );
}

function ContractGuide({ type }: { type: IntegrationType }) {
  const t = useTranslations("seller");
  const gateway = type === "seller_gateway";
  return (
    <div className="rounded-xl border border-iris/20 bg-iris-soft p-4">
      <p className="text-[13px] font-semibold text-fg">{gateway ? t("gatewayContractTitle") : t("taskContractTitle")}</p>
      <p className="mt-1 text-[12.5px] leading-5 text-muted">{gateway ? t("gatewayContractBody") : t("taskContractBody")}</p>
      <p className="mt-3 text-[12px] leading-5 text-muted">{gateway ? t("gatewayBuyerResult") : t("taskBuyerResult")}</p>
    </div>
  );
}

function IntegrationForm({ provider, onSaved, onCancel }: { provider?: Provider; onSaved: () => void; onCancel: () => void }) {
  const t = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();
  const editing = Boolean(provider);
  const initialType = (provider?.adapter_type ?? "seller_gateway") as IntegrationType;
  const [form, setForm] = useState(() => ({
    ...emptyForm(initialType),
    name: provider?.name ?? "",
    base_url: (provider?.config.base_url as string) ?? "",
    endpoint_map: endpointEntries(provider?.config.endpoint_map).length > 0
      ? endpointEntries(provider?.config.endpoint_map)
      : [{ name: "", path: "" }],
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const config: Record<string, unknown> = {
        base_url: form.base_url.trim(),
        api_key: editing ? form.api_key || MASKED_SECRET : form.api_key,
      };
      if (form.adapter_type === "seller_gateway") {
        config.endpoint_map = buildEndpointMap(form.endpoint_map, t as (key: string, values?: Record<string, string>) => string);
      } else {
        config.webhook_secret = editing ? form.webhook_secret || MASKED_SECRET : form.webhook_secret;
      }
      if (provider) await api.updateSellerProvider(provider.id, { config });
      else await api.createSellerProvider({ name: form.name.trim(), adapter_type: form.adapter_type, config });
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause, t("providerSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(
    form.name.trim()
    && form.base_url.trim()
    && (editing || form.api_key.trim())
    && (form.adapter_type === "seller_gateway"
      ? form.endpoint_map.some((entry) => entry.name.trim() && entry.path.trim())
      : editing || form.webhook_secret.trim()),
  );

  return (
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6 p-5 sm:p-6">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight">{editing ? t("editIntegration") : t("createIntegration")}</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{t("integrationFormIntro")}</p>
          </div>

          {!editing && (
            <section className="space-y-3">
              <div>
                <h3 className="text-[14px] font-semibold">{t("chooseIntegrationType")}</h3>
                <p className="mt-0.5 text-[12px] text-muted">{t("chooseIntegrationTypeHint")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("chooseIntegrationType")}>
                {(["seller_gateway", "seller_task_webhook"] as const).map((type) => {
                  const selected = form.adapter_type === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setForm((current) => ({ ...emptyForm(type), name: current.name }))}
                      className={`rounded-xl border p-4 text-left transition-colors ${selected ? "border-iris bg-iris-soft ring-1 ring-iris" : "border-line bg-surface hover:border-line-2"}`}
                    >
                      <span className={`grid h-6 w-6 place-items-center rounded-full border ${selected ? "border-iris bg-iris text-white" : "border-line-2"}`}>{selected && <Check size={13} />}</span>
                      <span className="mt-3 block text-[13px] font-semibold">{type === "seller_gateway" ? t("apiIntegration") : t("taskIntegration")}</span>
                      <span className="mt-1 block text-[12px] leading-5 text-muted">{type === "seller_gateway" ? t("apiIntegrationDesc") : t("taskIntegrationDesc")}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <ContractGuide type={form.adapter_type} />

          <section className="space-y-4">
            <div>
              <h3 className="text-[14px] font-semibold">{t("connectionDetails")}</h3>
              <p className="mt-0.5 text-[12px] text-muted">{t("connectionDetailsHint")}</p>
            </div>
            {!editing && (
              <Field label={t("connectionName")} hint={t("connectionNameHint")}>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={t("connectionNamePlaceholder")} />
              </Field>
            )}
            <Field label={t("baseUrlLabel")} hint={t("baseUrlHint")}>
              <Input autoComplete="url" value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} placeholder="https://api.your-company.com" />
            </Field>
            <Field label={t("apiKeyCreateLabel")} hint={editing ? t("apiKeyHint") : t("apiKeyCreateHint")}>
              <Input type="password" autoComplete="new-password" value={form.api_key} onChange={(event) => setForm({ ...form, api_key: event.target.value })} placeholder={editing ? t("apiKeyPlaceholder") : t("apiKeyCreatePlaceholder")} />
            </Field>
            {form.adapter_type === "seller_gateway" ? (
              <Field label={t("allowedEndpoints")} hint={t("allowedEndpointsHint")}>
                <EndpointEditor entries={form.endpoint_map} onChange={(endpoint_map) => setForm({ ...form, endpoint_map })} />
              </Field>
            ) : (
              <Field label={t("webhookCreateLabel")} hint={editing ? t("webhookSecretHint") : t("webhookCreateHint")}>
                <Input type="password" autoComplete="new-password" value={form.webhook_secret} onChange={(event) => setForm({ ...form, webhook_secret: event.target.value })} placeholder={editing ? t("webhookSecretPlaceholder") : t("webhookCreatePlaceholder")} />
              </Field>
            )}
          </section>

          {error && <p role="alert" className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2.5 text-[12.5px] text-bad">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <p className="max-w-md text-[12px] leading-5 text-muted">{t("saveDraftHint")}</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel}>{t("cancel")}</Button>
              <Button size="sm" disabled={!canSave || saving} onClick={save}>{saving ? t("saving") : t("saveDraftIntegration")}</Button>
            </div>
          </div>
        </div>

        <aside className="border-t border-line bg-raised p-5 sm:p-6 lg:border-l lg:border-t-0">
          <h3 className="text-[14px] font-semibold">{t("afterSaveTitle")}</h3>
          <div className="mt-4 space-y-4">
            {[
              [t("saveConnectionTitle"), t("saveConnectionBody")],
              [t("testConnectionTitle"), t("testConnectionBody")],
              [t("submitReviewTitle"), t("submitReviewBody")],
            ].map(([title, body], index) => (
              <div key={title} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-2 bg-surface text-[11px] font-semibold">{index + 1}</span>
                <div><p className="text-[12.5px] font-medium">{title}</p><p className="mt-0.5 text-[12px] leading-5 text-muted">{body}</p></div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-lg border border-iris/20 bg-iris-soft px-3 py-3">
            <div className="flex gap-2"><Shield size={14} className="mt-0.5 shrink-0 text-iris-hi" /><p className="text-[12px] leading-5 text-muted">{t("buyerKeyNote")}</p></div>
          </div>
        </aside>
      </div>
    </Card>
  );
}

function TestSummary({ result }: { result: TestDisplay | null }) {
  const t = useTranslations("seller");
  if (!result) return null;
  const health = result.health ?? {};
  const provision = result.provision_test;
  const passed = result.passed === true || (health.status === "healthy" && provision?.success === true);
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${passed ? "border-good/25 bg-good-soft" : "border-bad/25 bg-bad-soft"}`}>
      <p className={`text-[12.5px] font-medium ${passed ? "text-good" : "text-bad"}`}>{passed ? t("contractTestPassed") : t("contractTestFailed")}</p>
      {!passed && <p className="mt-1 text-[12px] text-muted">{String(health.message ?? provision?.error ?? t("testProvisionUnknown"))}</p>}
    </div>
  );
}

function IntegrationCard({ provider, onChanged }: { provider: Provider; onChanged: () => void }) {
  const t = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState<"test" | "submit" | null>(null);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const status = provider.review_status;
  const canTest = !["pending_review", "disabled"].includes(status);
  const canEdit = status !== "approved" && status !== "pending_review" && status !== "disabled";

  const test = async () => {
    setWorking("test");
    setError("");
    try {
      setTestResult(await api.testSellerProvider(provider.id));
      onChanged();
    } catch (cause) {
      setError(apiErrorMessage(cause, t("providerTestFailed")));
    } finally {
      setWorking(null);
    }
  };

  const submit = async () => {
    setWorking("submit");
    setError("");
    try {
      await api.submitSellerProvider(provider.id);
      onChanged();
    } catch (cause) {
      setError(apiErrorMessage(cause, t("submitFailed")));
    } finally {
      setWorking(null);
    }
  };

  if (editing) {
    return <IntegrationForm provider={provider} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14.5px] font-semibold">{provider.name}</h3>
            <Tag tone={STATUS_TONE[status]}>{t(`integrationStatus.${status}`)}</Tag>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">{provider.adapter_type === "seller_gateway" ? t("apiIntegration") : t("taskIntegration")}</p>
          <p className="mt-0.5 break-all font-mono text-[11.5px] text-faint">{String(provider.config.base_url ?? "")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Edit2 size={13} />{t("edit")}</Button>}
          {canTest && <Button size="sm" variant="secondary" disabled={working !== null} onClick={test}>{working === "test" ? t("testing") : t("testConnection")}</Button>}
          {status === "tested" && <Button size="sm" disabled={working !== null} onClick={submit}>{working === "submit" ? t("submittingReview") : t("submitForReview")}<ArrowRight size={13} /></Button>}
          {status === "approved" && <Button size="sm" onClick={() => router.push("/seller/products/new")}>{t("createProductWithIntegration")}</Button>}
        </div>
      </div>

      {provider.adapter_type === "seller_task_webhook" && (
        <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
          <p className="text-[11.5px] font-medium text-muted">{t("callbackEndpointLabel")}</p>
          <code className="mt-1 block break-all text-[11.5px] text-fg">POST /webhooks/providers/{provider.id}/tasks/{"{external_task_id}"}</code>
        </div>
      )}
      {status === "draft" && <p className="text-[12.5px] text-muted">{t("draftIntegrationHint")}</p>}
      {status === "tested" && <p className="text-[12.5px] text-iris-hi">{t("testedIntegrationHint")}</p>}
      {status === "pending_review" && <p className="text-[12.5px] text-muted">{t("pendingIntegrationHint")}</p>}
      {status === "approved" && (
        <div className="flex gap-2 rounded-lg border border-good/25 bg-good-soft px-3 py-2.5">
          <Check size={14} className="mt-0.5 shrink-0 text-good" />
          <p className="text-[12px] leading-5 text-muted">{t("approvedIntegrationHint")}</p>
        </div>
      )}
      {(status === "rejected" || status === "test_failed") && (
        <div className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2.5 text-[12.5px] text-bad">
          {status === "rejected" ? provider.review_note || t("reviewNeedUpdate") : t("testFailedHint")}
        </div>
      )}
      <TestSummary result={testResult ?? provider.last_test_result} />
      {error && <p role="alert" className="text-[12.5px] text-bad">{error}</p>}
    </Card>
  );
}

export default function SellerProvidersPage() {
  const t = useTranslations("seller");
  const router = useRouter();
  const { account } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const eligible = canUseSellerProviders(account?.seller_tier);

  const load = async () => {
    setLoading(true);
    try {
      setProviders(await api.sellerProviders());
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="py-16"><Spinner /></div>;
  if (!eligible) {
    return (
      <Card className="p-8 text-center">
        <Shield size={40} className="mx-auto mb-3 text-faint" />
        <h2 className="text-[16px] font-semibold">{t("tierRequiredTitle", { tier: MIN_TIER_LABEL })}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted">{t("tierRequiredProviders", { tier: MIN_TIER_LABEL, current: sellerTierLabel(account?.seller_tier) })}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">{t("integrationsTitle")}</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{t("integrationsSubtitle")}</p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>{t("createIntegration")}<ArrowRight size={14} /></Button>}
      </header>

      {creating && <IntegrationForm onSaved={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />}

      {!creating && providers.length === 0 && (
        <Card className="overflow-hidden">
          <div className="grid md:grid-cols-2">
            <div className="p-6">
              <Plug size={28} className="text-iris-hi" />
              <h2 className="mt-4 text-[15px] font-semibold">{t("haveBackendTitle")}</h2>
              <p className="mt-1 text-[12.5px] leading-5 text-muted">{t("haveBackendBody")}</p>
              <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>{t("connectMyApi")}</Button>
            </div>
            <div className="border-t border-line bg-raised p-6 md:border-l md:border-t-0">
              <Package size={28} className="text-muted" />
              <h2 className="mt-4 text-[15px] font-semibold">{t("noBackendTitle")}</h2>
              <p className="mt-1 text-[12.5px] leading-5 text-muted">{t("noBackendBody")}</p>
              <Button className="mt-4" size="sm" variant="secondary" onClick={() => router.push("/seller/products/new")}>{t("sellWithoutApi")}</Button>
            </div>
          </div>
        </Card>
      )}

      {!creating && providers.length > 0 && (
        <div className="space-y-3">{providers.map((provider) => <IntegrationCard key={provider.id} provider={provider} onChanged={load} />)}</div>
      )}

      {!creating && providers.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-line bg-raised px-3 py-2.5">
          <Info size={14} className="mt-0.5 shrink-0 text-muted" />
          <p className="text-[12px] leading-5 text-muted">{t("approvedEditPolicy")}</p>
        </div>
      )}
    </div>
  );
}
