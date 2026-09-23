"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceKind, SourceSellerCandidate, SourceTestResult } from "@/lib/types";
import { Banner, Button, Card, Field, Input, Select, Spinner, Tag } from "@/components/ui";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Info, Plug, ShieldCheck, X } from "@/components/Icons";
import { cn } from "@/lib/cn";

type Step = 1 | 2;

/** Admin thêm nguồn trong 2 bước: (1) kết nối + kiểm tra, (2) cửa hàng đứng
 *  tên bán. Luật giá và ngưỡng an toàn dùng mặc định — sửa ở tab Cài đặt.
 *  Tạo xong vào thẳng tab Kho của nguồn để chọn hàng. */
export function AddSourceWizard() {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [kinds, setKinds] = useState<SourceKind[] | null>(null);
  const [sellers, setSellers] = useState<SourceSellerCandidate[]>([]);
  const [step, setStep] = useState<Step>(1);
  const [adapter, setAdapter] = useState("");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [test, setTest] = useState<SourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [storeChoice, setStoreChoice] = useState<"new" | string>("new");
  const [storeName, setStoreName] = useState("");
  const [storeEmail, setStoreEmail] = useState("");
  const [sellerQ, setSellerQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const defaultName = (k: SourceKind) => k.label.replace(/\s*\(.*\)$/, "");

  const pickKind = (k: SourceKind, all: SourceKind[] | null = kinds) => {
    setAdapter(k.adapter_type);
    setTest(null);
    setConfig(Object.fromEntries(k.fields.map((f) => [f.key, f.default != null ? String(f.default) : ""])));
    // Giữ tên người dùng tự gõ; tên mặc định của loại trước thì đổi theo loại mới.
    setName((n) => (!n || (all ?? []).some((o) => defaultName(o) === n) ? defaultName(k) : n));
  };

  useEffect(() => {
    Promise.all([api.sources.kinds(), api.sources.sellers()])
      .then(([k, s]) => {
        setKinds(k);
        setSellers(s);
        if (k.length) pickKind(k[0], k);
      })
      .catch((e) => setError(apiErrorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kind = useMemo(() => kinds?.find((k) => k.adapter_type === adapter) ?? null, [kinds, adapter]);
  const mainFields = kind?.fields.filter((f) => !f.advanced) ?? [];
  const advancedFields = kind?.fields.filter((f) => f.advanced) ?? [];

  const typedConfig = () => {
    const out: Record<string, string | number> = {};
    for (const f of kind?.fields ?? []) {
      const v = (config[f.key] ?? "").trim();
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
        seller_id: storeChoice !== "new" ? Number(storeChoice) : null,
        new_seller: storeChoice === "new" ? { email: storeEmail.trim(), business_name: (storeName || name).trim() } : null,
      });
      router.push(
        r.kind === "catalog" ? `/admin/sources/${r.provider_id}?tab=catalog&created=1`
          : r.kind === "proxy" ? `/admin/sources/${r.provider_id}?add=1`
          : r.kind === "gateway" ? `/admin/sources/${r.provider_id}?tab=packages&created=1`
          : "/admin/sources",
      );
    } catch (e) {
      setError(apiErrorMessage(e));
      setSaving(false);
    }
  };

  // Seller nội bộ luôn hiện; seller thường chỉ khi gõ tìm (danh sách dài).
  const visibleSellers = useMemo(() => {
    const needle = sellerQ.trim().toLowerCase();
    if (needle) return sellers.filter((s) => `${s.email} ${s.business_name ?? ""}`.toLowerCase().includes(needle)).slice(0, 8);
    return sellers.filter((s) => s.is_internal);
  }, [sellers, sellerQ]);

  const secretsFilled = (kind?.fields ?? []).every((f) => !f.secret || (config[f.key] ?? "").trim().length > 0);
  const step1Ok = Boolean(kind) && name.trim().length > 0 && secretsFilled && Boolean(test?.ok);
  const step2Ok = storeChoice === "new" ? /.+@.+\..+/.test(storeEmail.trim()) && (storeName || name).trim().length > 0 : true;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/admin/sources" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ChevronLeft size={14} />{t("title")}</Link>
          <h1 className="font-serif text-2xl font-semibold text-fg">{t("wizard.title")}</h1>
        </div>
        <Link href="/admin/sources"><Button size="sm" variant="ghost"><X size={15} />{t("cancel")}</Button></Link>
      </div>

      <ol className="flex flex-wrap items-center gap-3 text-[13px]" aria-label={t("wizard.stepsLabel")}>
        {([1, 2] as Step[]).map((n) => (
          <li key={n} className="flex items-center gap-3" aria-current={step === n ? "step" : undefined}>
            <span className={cn("flex items-center gap-2 font-semibold", step === n ? "text-fg" : step > n ? "text-good" : "text-muted")}>
              <span className={cn(
                "grid h-6 w-6 place-items-center rounded-full border text-[11.5px]",
                step === n ? "border-iris bg-iris text-white" : step > n ? "border-good/30 bg-good-soft text-good" : "border-line-2",
              )}>
                {step > n ? <Check size={12} /> : n}
              </span>
              {t(`wizard.step${n}`)}
            </span>
            {n < 2 && <span className="h-px w-10 bg-line-2" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      {error && <Banner tone="bad" icon={<AlertTriangle size={15} />}>{error}</Banner>}

      {kinds === null ? <Spinner /> : (
        <Card className="overflow-hidden">
          {step === 1 && kind && (
            <div className="space-y-6 p-5 sm:p-6">
              <fieldset className="space-y-2.5">
                <legend className="text-[15px] font-semibold text-fg">{t("wizard.kindQ")}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {kinds.map((k) => (
                    <button
                      key={k.adapter_type} type="button" aria-pressed={adapter === k.adapter_type} onClick={() => pickKind(k)}
                      className={cn(
                        "rounded-lg border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
                        adapter === k.adapter_type ? "border-iris bg-iris-soft" : "border-line-2 bg-card hover:border-faint",
                      )}
                    >
                      <span className="block text-[14px] font-semibold text-fg">{k.label}</span>
                      <span className="mt-1 block text-[12.5px] leading-snug text-muted">{k.description}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-4">
                {mainFields.map((f) => (
                  <Field key={f.key} label={f.label} hint={f.secret ? `${f.hint ?? ""} ${t("wizard.secretHint")}`.trim() : f.hint}>
                    {f.type === "select" ? (
                      <Select id={`wiz-${f.key}`} value={config[f.key] ?? ""}
                        onChange={(e) => { setConfig((c) => ({ ...c, [f.key]: e.target.value })); setTest(null); }}>
                        {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    ) : (
                      <Input
                        id={`wiz-${f.key}`} type={f.secret ? "password" : f.type === "number" ? "number" : "text"} autoComplete="off"
                        className={cn(f.type === "number" && "font-mono")}
                        value={config[f.key] ?? ""}
                        onChange={(e) => { setConfig((c) => ({ ...c, [f.key]: e.target.value })); setTest(null); }}
                      />
                    )}
                  </Field>
                ))}
                {advancedFields.length > 0 && (
                  <div>
                    <button type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((o) => !o)}
                      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">
                      <ChevronRight size={13} className={cn("transition-transform", showAdvanced && "rotate-90")} />
                      {t("wizard.advanced")}
                    </button>
                    {showAdvanced && (
                      <div className="mt-3 space-y-4">
                        {advancedFields.map((f) => (
                          <Field key={f.key} label={f.label} hint={f.hint}>
                            <Input id={`wiz-${f.key}`} autoComplete="off" className="font-mono" value={config[f.key] ?? ""}
                              onChange={(e) => { setConfig((c) => ({ ...c, [f.key]: e.target.value })); setTest(null); }} />
                          </Field>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" onClick={runTest} disabled={testing || !secretsFilled}>
                    <Plug size={15} />{testing ? t("wizard.testing") : t("wizard.test")}
                  </Button>
                  {!test && <span className="text-[12.5px] text-muted">{t("wizard.testFirst")}</span>}
                </div>
                {test && (
                  test.ok ? (
                    <div role="status" className="rounded-lg border border-good/25 bg-good-soft p-4">
                      <p className="flex items-center gap-2 text-[14px] font-semibold text-good"><CheckCircle2 size={17} />{t("wizard.testOk")}</p>
                      {kind.kind === "gateway" ? (
                        <p className="mt-1.5 text-[13px] text-fg">{test.health.message}</p>
                      ) : (
                      <dl className="mt-3 grid grid-cols-3 gap-4">
                        <div>
                          <dt className="text-[12px] text-muted">{t("wizard.balance")}</dt>
                          <dd className="font-mono text-[16px] font-semibold tabular-nums text-fg">
                            {typeof test.health.balance_vnd === "number" ? formatLedgerMoney(test.health.balance_vnd, locale) : "—"}
                          </dd>
                        </div>
                        {test.catalog && (
                          <>
                            <div>
                              <dt className="text-[12px] text-muted">{t("wizard.catalogTotal")}</dt>
                              <dd className="font-mono text-[16px] font-semibold tabular-nums text-fg">{test.catalog.total.toLocaleString(locale)}</dd>
                            </div>
                            <div>
                              <dt className="text-[12px] text-muted">{t("wizard.catalogInStock")}</dt>
                              <dd className="font-mono text-[16px] font-semibold tabular-nums text-fg">{test.catalog.in_stock.toLocaleString(locale)}</dd>
                            </div>
                          </>
                        )}
                      </dl>
                      )}
                    </div>
                  ) : (
                    <Banner tone="bad" icon={<AlertTriangle size={15} />} title={t("wizard.testFailed")}>
                      {test.health.message}
                    </Banner>
                  )
                )}
                <Field label={t("wizard.name")} hint={t("wizard.nameHint")}>
                  <Input id="wiz-name" className="max-w-sm" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                {(kind.kind === "catalog" || kind.kind === "gateway") && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-line-2 bg-raised px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                    <p>{kind.kind === "gateway" ? t("wizard.defaultsGateway") : t("wizard.defaults")}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5 p-5 sm:p-6">
              <div className="space-y-2.5">
                <h2 className="text-[15px] font-semibold text-fg">{t("wizard.storeQ")}</h2>
                <div className="flex items-start gap-2.5 rounded-lg bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-fg">
                  <Info size={16} className="mt-0.5 shrink-0 text-iris" />
                  <p>{t("wizard.storeWhy")}</p>
                </div>
              </div>
              <div className="space-y-3" role="radiogroup" aria-label={t("wizard.storeQ")}>
                <label className={cn("block cursor-pointer rounded-lg border p-4", storeChoice === "new" ? "border-iris bg-iris-soft" : "border-line-2")}>
                  <span className="flex items-start gap-3">
                    <input type="radio" name="wiz-store" className="mt-1 accent-iris" checked={storeChoice === "new"} onChange={() => setStoreChoice("new")} />
                    <span>
                      <span className="flex items-center gap-2 text-[14px] font-semibold text-fg">{t("wizard.storeNew")}<Tag tone="iris">{t("wizard.recommended")}</Tag></span>
                      <span className="block text-[12.5px] text-muted">{t("wizard.storeNewHint")}</span>
                    </span>
                  </span>
                  {storeChoice === "new" && (
                    <span className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
                      <Field label={t("wizard.storeName")}><Input id="wiz-store-name" value={storeName || name} onChange={(e) => setStoreName(e.target.value)} /></Field>
                      <Field label={t("wizard.storeEmail")}><Input id="wiz-store-email" type="email" value={storeEmail} onChange={(e) => setStoreEmail(e.target.value)} /></Field>
                    </span>
                  )}
                </label>
                <div className={cn("rounded-lg border p-4", storeChoice !== "new" ? "border-iris bg-iris-soft" : "border-line-2")}>
                  <p className="text-[14px] font-semibold text-fg">{t("wizard.storeExisting")}</p>
                  <p className="text-[12.5px] text-muted">{t("wizard.storeExistingHint")}</p>
                  <Input id="wiz-seller-q" className="mt-3 max-w-sm" placeholder={t("wizard.searchSeller")} value={sellerQ} onChange={(e) => setSellerQ(e.target.value)} />
                  <div className="mt-2 space-y-2">
                    {visibleSellers.length === 0 && <p className="text-[12.5px] text-muted">{sellerQ ? t("noMatch") : t("wizard.noInternal")}</p>}
                    {visibleSellers.map((s) => (
                      <label key={s.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3", storeChoice === String(s.id) ? "border-iris" : "border-line")}>
                        <input type="radio" name="wiz-store" className="accent-iris" checked={storeChoice === String(s.id)} onChange={() => setStoreChoice(String(s.id))} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium text-fg">{s.business_name ?? s.email.split("@")[0]}</span>
                          <span className="block truncate text-[12px] text-muted">{s.email} · {t("wizard.sourcesN", { n: s.source_count })}</span>
                        </span>
                        {!s.is_internal && <Tag tone="neutral">{t("wizard.becomesInternal")}</Tag>}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 text-[12.5px] text-muted">
                <p className="font-medium text-fg">{t("wizard.storeCan")}</p>
                <p className="flex items-center gap-1.5"><Check size={14} className="text-good" />{t("wizard.storeCan1")}</p>
                <p className="flex items-center gap-1.5"><Check size={14} className="text-good" />{t("wizard.storeCan2")}</p>
                <p className="flex items-center gap-1.5"><X size={14} className="text-bad" />{t("wizard.storeCannot")}</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line bg-raised px-5 py-3.5 sm:px-6">
            {step === 1 ? <span className="text-[12.5px] text-muted">{t("wizard.stepOf", { n: 1, total: 2 })}</span> : (
              <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}><ChevronLeft size={15} />{t("back")}</Button>
            )}
            {step === 1 ? (
              <Button onClick={() => setStep(2)} disabled={!step1Ok}>{t("wizard.next")}<ArrowRight size={15} /></Button>
            ) : (
              <Button onClick={create} disabled={!step2Ok || saving}>{saving ? t("wizard.creating") : t(kind?.kind === "gateway" ? "wizard.createGateway" : "wizard.create")}<ArrowRight size={15} /></Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
