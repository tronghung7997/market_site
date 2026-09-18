"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceCreateResult, SourceKind, SourceSellerCandidate, SourceTestResult } from "@/lib/types";
import { Button, Card, Field, Input, Spinner, Tag } from "@/components/ui";
import { ArrowRight, Check, CheckCircle2, ChevronLeft, Plus, X } from "@/components/Icons";
import { cn } from "@/lib/cn";

type Step = 1 | 2 | 3;

/** Admin thêm nguồn trong một màn: kết nối (test trước khi lưu) → giao cho
 *  seller nội bộ (có sẵn / tạo mới) → tạo. Bước 3 (chọn sản phẩm) mở ngay
 *  drawer "Thêm sản phẩm" ở trang nguồn vừa tạo. */
export function AddSourceWizard() {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [kinds, setKinds] = useState<SourceKind[] | null>(null);
  const [sellers, setSellers] = useState<SourceSellerCandidate[]>([]);
  const [step, setStep] = useState<Step>(1);
  const [adapter, setAdapter] = useState<string>("");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [test, setTest] = useState<SourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [sellerChoice, setSellerChoice] = useState<string>("");   // "<id>" | "new"
  const [sellerQ, setSellerQ] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SourceCreateResult | null>(null);

  useEffect(() => {
    Promise.all([api.sources.kinds(), api.sources.sellers()])
      .then(([k, s]) => {
        setKinds(k);
        setSellers(s);
        if (k.length && !adapter) pickKind(k[0]);
        if (s.length) setSellerChoice(String(s[0].id));
      })
      .catch((e) => setError(apiErrorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kind = useMemo(() => kinds?.find((k) => k.adapter_type === adapter) ?? null, [kinds, adapter]);

  const pickKind = (k: SourceKind) => {
    setAdapter(k.adapter_type);
    setTest(null);
    setConfig(Object.fromEntries(k.fields.map((f) => [f.key, f.default != null ? String(f.default) : ""])));
    if (!name) setName(k.label.replace(/\s*\(.*\)$/, ""));
  };

  const typedConfig = () => {
    const out: Record<string, string | number> = {};
    for (const f of kind?.fields ?? []) {
      const v = config[f.key] ?? "";
      if (v === "") continue;
      out[f.key] = f.type === "number" ? Number(v) : v;
    }
    return out;
  };

  const runTest = async () => {
    setTesting(true);
    setError("");
    try {
      setTest(await api.sources.test(adapter, typedConfig()));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const create = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api.sources.create({
        adapter_type: adapter, name: name.trim(), config: typedConfig(),
        seller_id: sellerChoice !== "new" && sellerChoice ? Number(sellerChoice) : null,
        new_seller: sellerChoice === "new" ? { email: newEmail.trim(), business_name: newName.trim() } : null,
      });
      setResult(r);
      setStep(3);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Nội bộ luôn hiện; seller thường chỉ hiện khi gõ tìm (danh sách có thể rất dài).
  const visibleSellers = useMemo(() => {
    const needle = sellerQ.trim().toLowerCase();
    if (needle) return sellers.filter((s) => `${s.email} ${s.business_name ?? ""}`.toLowerCase().includes(needle)).slice(0, 8);
    return sellers.filter((s) => s.is_internal);
  }, [sellers, sellerQ]);

  const step1Ok = Boolean(kind) && name.trim().length > 0 && (kind?.fields ?? []).every((f) => !f.secret || (config[f.key] ?? "").length > 0);
  const step2Ok = sellerChoice === "new" ? newEmail.includes("@") && newName.trim().length > 0 : sellerChoice !== "";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/admin/sources" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg"><ChevronLeft className="h-3.5 w-3.5" />{t("adminTitle")}</Link>
          <h1 className="text-lg font-bold text-fg">{t("addSource")}</h1>
        </div>
        <Link href="/admin/sources"><Button size="sm" variant="ghost"><X className="h-4 w-4" />{t("cancel")}</Button></Link>
      </div>

      <ol className="flex flex-wrap items-center gap-3 text-[13px]">
        {([1, 2, 3] as Step[]).map((n) => (
          <li key={n} className="flex items-center gap-3">
            <span className={cn("flex items-center gap-2 font-semibold", step === n ? "text-iris" : step > n ? "text-good" : "text-faint")}>
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-[11px]",
                step === n ? "border-iris bg-iris text-white" : step > n ? "border-good bg-good-soft text-good" : "border-line")}>
                {step > n ? <Check className="h-3 w-3" /> : n}
              </span>
              {t(`wizStep${n}`)}
            </span>
            {n < 3 && <span className="h-px w-8 bg-line" />}
          </li>
        ))}
      </ol>

      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
      {kinds === null ? <Spinner /> : (
        <Card className="space-y-5 p-5">
          {step === 1 && kind && (
            <>
              <div>
                <p className="text-[15px] font-bold text-fg">{t("wizKindQ")}</p>
                <p className="text-[12.5px] text-muted">{t("wizKindHint")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {kinds.map((k) => (
                  <button key={k.adapter_type} type="button" onClick={() => pickKind(k)}
                    className={cn("rounded-lg border p-3 text-left", adapter === k.adapter_type ? "border-iris bg-iris-soft/40" : "border-line bg-card hover:border-line-2")}>
                    <span className="flex items-center gap-2 font-semibold text-fg">
                      <span className={cn("h-4 w-4 rounded-full border", adapter === k.adapter_type ? "border-[5px] border-iris" : "border-line-2")} />
                      {k.label}
                    </span>
                    <span className="mt-1 block text-[12px] text-muted">{k.description}</span>
                    <Tag tone="iris" className="mt-2">{k.kind === "catalog" ? t("kindCatalog") : t("kindServer")}</Tag>
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("wizName")} hint={t("wizNameHint")}>
                  <Input id="wiz-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                {kind.fields.map((f) => (
                  <Field key={f.key} label={f.label} hint={f.secret ? t("wizSecretHint") : undefined}>
                    <Input
                      id={`wiz-${f.key}`} type={f.secret ? "password" : f.type === "number" ? "number" : "text"}
                      className={cn(f.type === "number" && "font-mono")} autoComplete="off"
                      value={config[f.key] ?? ""} onChange={(e) => { setConfig((c) => ({ ...c, [f.key]: e.target.value })); setTest(null); }}
                    />
                  </Field>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="secondary" onClick={runTest} disabled={testing || !step1Ok}>{testing ? t("testing") : t("testConnection")}</Button>
                {test && (
                  <span className={cn("inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px]", test.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad")}>
                    {test.ok && <CheckCircle2 className="h-4 w-4" />}
                    {test.ok ? t("testOk") : t("testFailed")}
                    {typeof test.health.balance_vnd === "number" && ` · ${t("balance")} ${formatLedgerMoney(test.health.balance_vnd, locale)}`}
                    {test.health.message && !test.ok && ` · ${test.health.message}`}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-line pt-4">
                <span className="text-[12px] text-faint">{t("stepOf", { n: 1, total: 3 })}</span>
                <Button size="sm" disabled={!step1Ok || !test?.ok} onClick={() => setStep(2)} title={!test?.ok ? t("testFirst") : undefined}>
                  {t("continue")}<ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <p className="text-[15px] font-bold text-fg">{t("wizSellerQ")}</p>
                <p className="text-[12.5px] text-muted">{t("wizSellerHint")}</p>
              </div>
              <Input id="wiz-seller-q" className="h-9 max-w-sm" placeholder={t("searchSeller")} value={sellerQ} onChange={(e) => setSellerQ(e.target.value)} />
              <div className="space-y-2">
                {visibleSellers.length === 0 && <p className="text-[12.5px] text-muted">{sellerQ ? t("noMatch") : t("noInternalYet")}</p>}
                {visibleSellers.map((s) => (
                  <label key={s.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3", sellerChoice === String(s.id) ? "border-iris bg-iris-soft/40" : "border-line bg-card")}>
                    <input type="radio" name="wiz-seller" value={s.id} checked={sellerChoice === String(s.id)} onChange={() => setSellerChoice(String(s.id))} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-fg">{s.business_name ?? s.email.split("@")[0]}</span>
                      <span className="block text-[12px] text-muted">{s.email} · {t("sourcesN", { n: s.source_count })}</span>
                    </span>
                    {s.is_internal ? <Tag tone="iris">{t("internalSeller")}</Tag> : <Tag tone="neutral">{t("willBecomeInternal")}</Tag>}
                  </label>
                ))}
                <label className={cn("block cursor-pointer rounded-lg border p-3", sellerChoice === "new" ? "border-iris bg-iris-soft/40" : "border-line bg-card")}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name="wiz-seller" value="new" checked={sellerChoice === "new"} onChange={() => setSellerChoice("new")} />
                    <span className="font-semibold text-fg"><Plus className="mr-1 inline h-3.5 w-3.5" />{t("newInternalSeller")}</span>
                  </span>
                  <span className="mt-0.5 block pl-7 text-[12px] text-muted">{t("newInternalSellerHint")}</span>
                  {sellerChoice === "new" && (
                    <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
                      <Field label={t("newSellerEmail")}><Input id="wiz-new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></Field>
                      <Field label={t("newSellerName")}><Input id="wiz-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
                    </div>
                  )}
                </label>
              </div>
              <p className="rounded-md bg-iris-soft/40 px-3 py-2 text-[12.5px] text-fg">{t("sellerCanDo")}</p>
              <div className="flex items-center justify-between border-t border-line pt-4">
                <Button size="sm" variant="ghost" onClick={() => setStep(1)} disabled={saving}><ChevronLeft className="h-4 w-4" />{t("back")}</Button>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] text-faint">{t("stepOf", { n: 2, total: 3 })}</span>
                  <Button size="sm" disabled={!step2Ok || saving} onClick={create}>{saving ? t("creating") : t("createSource")}<ArrowRight className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </>
          )}

          {step === 3 && result && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 text-good" />
                <div>
                  <p className="text-[15px] font-bold text-fg">{t("createdTitle", { name: result.name })}</p>
                  <p className="text-[13px] text-muted">
                    {result.seller_email ? t("createdAssigned", { email: result.seller_email }) : t("createdUnassigned")}
                    {result.kind === "catalog" && (result.sync_error ? ` · ${t("syncFailed")}: ${result.sync_error}` : ` · ${t("createdCatalog", { n: result.catalog_items })}`)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                {result.kind === "catalog" ? (
                  <>
                    <Button size="sm" onClick={() => router.push(`/admin/sources/${result.provider_id}?add=1`)}><Plus className="h-3.5 w-3.5" />{t("pickProductsNow")}</Button>
                    <Link href={`/admin/sources/${result.provider_id}`}><Button size="sm" variant="secondary">{t("skipForNow")}</Button></Link>
                  </>
                ) : (
                  <Link href="/admin/sources"><Button size="sm">{t("backToList")}</Button></Link>
                )}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
