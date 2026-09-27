"use client";

/** Seller application in three steps (shop → contact and commitments →
 *  review), with the answers kept as a local draft until they are sent. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Category, SellerApplication } from "@/lib/types";
import { Button, Card, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { Check, X } from "@/components/Icons";
import {
  APPLY_STEPS, applyPayload, CATEGORIES_MAX, canSubmit, CONTACT_MAX, DESCRIPTION_MAX, draftKey, EMPTY_DRAFT,
  NAME_MAX, parseDraft, REFERRAL_SOURCES, SELLER_EXPERIENCE, SELLER_TYPES, stepErrors, WARRANTY_MAX,
  type ApplyDraft, type ApplyError, type ApplyStep,
} from "../model";

const BANNED = ["stolen", "malware", "payments", "piracy", "resale"] as const;

function flatten(categories: Category[]): Category[] {
  return categories.flatMap((c) => [c, ...flatten(c.children ?? [])]).filter((c) => c.is_active);
}

/** A rejected applicant starts from what they sent last time. */
function fromApplication(app: SellerApplication): ApplyDraft {
  return {
    ...EMPTY_DRAFT,
    businessName: app.business_name ?? "",
    sellerType: app.seller_type ?? "individual",
    categoryIds: app.category_ids ?? [],
    experience: app.experience ?? "",
    description: app.description ?? "",
    contact: app.contact ?? "",
    phone: app.phone ?? "",
    warrantyPolicy: app.warranty_policy ?? "",
    referralSource: app.referral_source ?? "",
  };
}

function readDraft(key: string): ApplyDraft | null {
  try { return parseDraft(window.localStorage.getItem(key)); } catch { return null; }
}

function writeDraft(key: string, draft: ApplyDraft | null) {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: the form still works, only without a draft.
  }
}

export function ApplyWizard({ accountId, previous, onSubmitted }: {
  accountId: number;
  previous: SellerApplication | null;
  onSubmitted: (application: SellerApplication) => void;
}) {
  const t = useTranslations("seller");
  const ta = useTranslations("seller.apply");
  const apiErrorMessage = useApiErrorMessage();
  const storageKey = draftKey(accountId);
  const [draft, setDraft] = useState<ApplyDraft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState<"draft" | "previous" | null>(null);
  const [step, setStep] = useState<ApplyStep>("shop");
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.categories(), staleTime: 5 * 60_000 });
  const options = useMemo(() => flatten(categories.data ?? []), [categories.data]);
  const names = useMemo(() => new Map(options.map((c) => [c.id, c.name])), [options]);

  // Restore once per account and application state. The page re-fetches the
  // application (a new object each time); re-running would read back the
  // draft this form just saved from it and call it a browser draft.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${storageKey}|${previous?.id ?? ""}|${previous?.status ?? ""}`;
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    const saved = readDraft(storageKey);
    if (saved) {
      setDraft(saved);
      setRestored("draft");
    } else if (previous) {
      setDraft(fromApplication(previous));
      setRestored("previous");
    }
    setLoaded(true);
  }, [storageKey, previous]);

  useEffect(() => {
    if (loaded) writeDraft(storageKey, draft);
  }, [storageKey, draft, loaded]);

  const index = APPLY_STEPS.indexOf(step);
  const errors = step === "review" ? [] : stepErrors(step, draft);
  const errorFor = (...keys: ApplyError[]) => {
    const hit = showErrors ? errors.find((e) => keys.includes(e)) : undefined;
    return hit ? ta(`errors.${hit}`) : undefined;
  };
  const set = <K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const go = (next: ApplyStep) => {
    setStep(next);
    setShowErrors(false);
    setError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  /** Bring the first message into view; it can sit above the fold when the
   *  seller pressed Continue at the bottom of a long step. */
  const revealErrors = () => {
    setShowErrors(true);
    requestAnimationFrame(() => {
      const first = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true'], [role='alert']");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (first?.matches("input, textarea")) first.focus({ preventScroll: true });
    });
  };

  const forward = () => {
    if (errors.length > 0) {
      revealErrors();
      return;
    }
    go(APPLY_STEPS[index + 1]);
  };

  const toggleCategory = (id: number) => {
    const on = draft.categoryIds.includes(id);
    if (!on && draft.categoryIds.length >= CATEGORIES_MAX) return;
    set("categoryIds", on ? draft.categoryIds.filter((x) => x !== id) : [...draft.categoryIds, id]);
  };

  const submit = async () => {
    if (!canSubmit(draft)) {
      go(stepErrors("shop", draft).length > 0 ? "shop" : "contact");
      revealErrors();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const application = await api.sellerApply(applyPayload(draft));
      setLoaded(false);
      writeDraft(storageKey, null);
      onSubmitted(application);
    } catch (err) {
      setError(apiErrorMessage(err, t("submitFailed")));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setDraft(EMPTY_DRAFT);
    setRestored(null);
    go("shop");
  };

  return (
    <Card className="p-5 sm:p-7">
      <div ref={formRef}>
        <ol className="grid grid-cols-3 gap-2" aria-label={ta("stepsLabel")}>
          {APPLY_STEPS.map((s, i) => {
            const done = i < index;
            const current = i === index;
            return (
              <li key={s} aria-current={current ? "step" : undefined} className="min-w-0">
                <span className={cn("block h-1 rounded-full", done || current ? "bg-iris" : "bg-line")} />
                <span className={cn("mt-2 flex items-center gap-1.5 text-[12px] font-medium", current ? "text-fg" : "text-muted")}>
                  <span className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                    done ? "border-iris bg-iris text-white" : current ? "border-iris text-iris-hi" : "border-line-2 text-faint",
                  )}>
                    {done ? <Check size={11} /> : i + 1}
                  </span>
                  <span className="truncate">{ta(`steps.${s}`)}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 ref={headingRef} tabIndex={-1} className="font-serif text-[20px] tracking-tight focus:outline-none">{ta(`stepTitles.${step}`)}</h2>
          <span className="font-mono text-[11.5px] text-faint">{ta("stepOf", { step: index + 1, total: APPLY_STEPS.length })}</span>
        </div>

        {restored && step === "shop" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised/50 px-3.5 py-2.5 text-[12.5px] text-muted">
            <span>{restored === "draft" ? ta("restoredDraft") : previous?.status === "needs_info" ? ta("restoredNeedsInfo") : ta("restoredPrevious")}</span>
            <button type="button" onClick={clear} className="font-medium text-fg underline underline-offset-2 hover:no-underline">{ta("startOver")}</button>
          </div>
        )}

        {step === "shop" && (
          <div className="mt-5 flex flex-col gap-5">
            <Field label={t("businessName")} error={errorFor("nameRequired", "nameTooLong")}>
              <Input
                value={draft.businessName}
                maxLength={NAME_MAX}
                onChange={(e) => set("businessName", e.target.value)}
                placeholder={t("businessPlaceholder")}
                aria-invalid={!!errorFor("nameRequired", "nameTooLong")}
              />
            </Field>

            <fieldset>
              <legend className="text-[13px] font-medium text-muted">{ta("sellerType")}</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {SELLER_TYPES.map((type) => (
                  <label
                    key={type}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-3 transition-colors",
                      draft.sellerType === type ? "border-iris bg-iris-soft" : "border-line bg-surface hover:border-line-2",
                    )}
                  >
                    <input
                      type="radio"
                      name="seller-type"
                      className="mt-0.5 accent-[var(--color-iris)]"
                      checked={draft.sellerType === type}
                      onChange={() => set("sellerType", type)}
                    />
                    <span>
                      <span className="block text-[13px] font-medium">{ta(`types.${type}.title`)}</span>
                      <span className="block text-[12px] text-muted">{ta(`types.${type}.body`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="flex w-full items-baseline justify-between gap-2 text-[13px] font-medium text-muted">
                <span>{ta("categories")}</span>
                <span className="font-mono text-[11.5px] font-normal text-faint">{draft.categoryIds.length}/{CATEGORIES_MAX}</span>
              </legend>
              {categories.isPending ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5" aria-hidden>
                  {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-24" />)}
                </div>
              ) : categories.isError ? (
                <p className="mt-1.5 flex items-center gap-2 text-[12.5px] text-bad">
                  {ta("categoriesLoadFail")}
                  <button type="button" onClick={() => categories.refetch()} className="font-medium text-fg underline underline-offset-2">{t("retry")}</button>
                </p>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {options.map((category) => {
                    const on = draft.categoryIds.includes(category.id);
                    const full = !on && draft.categoryIds.length >= CATEGORIES_MAX;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        aria-pressed={on}
                        disabled={full}
                        onClick={() => toggleCategory(category.id)}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors disabled:opacity-40",
                          on ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
                        )}
                      >
                        {on && <Check size={12} />}
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {errorFor("categoryRequired", "tooManyCategories")
                ? <p role="alert" className="mt-1.5 text-[12px] text-bad">{errorFor("categoryRequired", "tooManyCategories")}</p>
                : <p className="mt-1.5 text-[12px] text-faint">{ta("categoriesHint")}</p>}
            </fieldset>

            <Field label={ta("experience")}>
              <Select value={draft.experience} onChange={(e) => set("experience", e.target.value as ApplyDraft["experience"])}>
                <option value="">{ta("optionalPick")}</option>
                {SELLER_EXPERIENCE.map((value) => <option key={value} value={value}>{ta(`experiences.${value}`)}</option>)}
              </Select>
            </Field>

            <Field label={t("description")} hint={ta("descriptionHint", { max: DESCRIPTION_MAX })} error={errorFor("descriptionTooLong")}>
              <Textarea
                rows={4}
                maxLength={DESCRIPTION_MAX}
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder={ta("descriptionPlaceholder")}
              />
            </Field>
          </div>
        )}

        {step === "contact" && (
          <div className="mt-5 flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t("contact")} hint={t("contactHint")} error={errorFor("contactTooLong")}>
                <Input value={draft.contact} maxLength={CONTACT_MAX} onChange={(e) => set("contact", e.target.value)} placeholder="telegram @yourshop" />
              </Field>
              <Field label={ta("phone")} hint={ta("phoneHint")} error={errorFor("phoneInvalid")}>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={32}
                  value={draft.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  aria-invalid={!!errorFor("phoneInvalid")}
                />
              </Field>
            </div>

            <Field label={ta("warranty")} hint={ta("warrantyHint")} error={errorFor("warrantyTooLong")}>
              <Textarea rows={3} maxLength={WARRANTY_MAX} value={draft.warrantyPolicy} onChange={(e) => set("warrantyPolicy", e.target.value)} placeholder={ta("warrantyPlaceholder")} />
            </Field>

            <Field label={ta("referral")}>
              <Select value={draft.referralSource} onChange={(e) => set("referralSource", e.target.value as ApplyDraft["referralSource"])}>
                <option value="">{ta("optionalPick")}</option>
                {REFERRAL_SOURCES.map((value) => <option key={value} value={value}>{ta(`referrals.${value}`)}</option>)}
              </Select>
            </Field>

            <section aria-labelledby="apply-rules" className="rounded-lg border border-line bg-raised/40 p-4">
              <h3 id="apply-rules" className="text-[13px] font-semibold">{ta("rulesTitle")}</h3>
              <ul className="mt-2.5 space-y-1.5 text-[12.5px] leading-relaxed">
                <li className="flex items-start gap-2"><Check size={13} className="mt-0.5 shrink-0 text-good" /><span>{ta("ruleEscrow")}</span></li>
                <li className="flex items-start gap-2"><Check size={13} className="mt-0.5 shrink-0 text-good" /><span>{ta("ruleAccurate")}</span></li>
                {BANNED.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <X size={13} className="mt-0.5 shrink-0 text-bad" />
                    <span>{ta("ruleBanned", { item: ta(`banned.${item}`) })}</span>
                  </li>
                ))}
              </ul>
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 border-t border-line pt-3.5 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-iris)]"
                  checked={draft.acceptRules}
                  onChange={(e) => set("acceptRules", e.target.checked)}
                  aria-invalid={!!errorFor("rulesRequired")}
                />
                <span>
                  {ta.rich("acceptRules", {
                    terms: (chunks) => <Link href="/legal/terms" target="_blank" className="font-medium text-iris-hi underline underline-offset-2 hover:no-underline">{chunks}</Link>,
                  })}
                </span>
              </label>
              {errorFor("rulesRequired") && <p role="alert" className="mt-1.5 text-[12px] text-bad">{errorFor("rulesRequired")}</p>}
            </section>
          </div>
        )}

        {step === "review" && (
          <div className="mt-5">
            <ReviewGroup title={ta("steps.shop")} onEdit={() => go("shop")} editLabel={ta("edit")}>
              <ReviewRow label={t("businessName")} value={draft.businessName.trim()} empty={ta("notProvided")} />
              <ReviewRow label={ta("sellerType")} value={ta(`types.${draft.sellerType}.title`)} empty={ta("notProvided")} />
              <ReviewRow label={ta("categories")} value={draft.categoryIds.map((id) => names.get(id) ?? `#${id}`).join(", ")} empty={ta("notProvided")} />
              <ReviewRow label={ta("experience")} value={draft.experience ? ta(`experiences.${draft.experience}`) : ""} empty={ta("notProvided")} />
              <ReviewRow label={t("description")} value={draft.description.trim()} empty={ta("notProvided")} multiline />
            </ReviewGroup>
            <ReviewGroup title={ta("steps.contact")} onEdit={() => go("contact")} editLabel={ta("edit")}>
              <ReviewRow label={t("contact")} value={draft.contact.trim()} empty={ta("notProvided")} />
              <ReviewRow label={ta("phone")} value={draft.phone.trim()} empty={ta("notProvided")} />
              <ReviewRow label={ta("warranty")} value={draft.warrantyPolicy.trim()} empty={ta("notProvided")} multiline />
              <ReviewRow label={ta("referral")} value={draft.referralSource ? ta(`referrals.${draft.referralSource}`) : ""} empty={ta("notProvided")} />
              <ReviewRow label={ta("rulesTitle")} value={draft.acceptRules ? ta("rulesAccepted") : ""} empty={ta("notProvided")} />
            </ReviewGroup>
            <p className="mt-4 text-[12.5px] leading-relaxed text-muted">{ta("reviewNote")}</p>
          </div>
        )}

        {error && <p role="alert" className="mt-4 text-[13px] text-bad">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-faint">{ta("draftNote")}</p>
          <div className="flex gap-2 sm:shrink-0">
            {index > 0 && (
              <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => go(APPLY_STEPS[index - 1])} disabled={busy}>{ta("back")}</Button>
            )}
            {step === "review" ? (
              <Button className="flex-1 sm:flex-none" onClick={submit} loading={busy}>{busy ? t("submitting") : t("submit")}</Button>
            ) : (
              <Button className="flex-1 sm:flex-none" onClick={forward}>{ta("next")}</Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ReviewGroup({ title, onEdit, editLabel, children }: { title: string; onEdit: () => void; editLabel: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-3 first:pt-0 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <button type="button" onClick={onEdit} className="text-[12.5px] font-medium text-iris-hi hover:underline">{editLabel}</button>
      </div>
      <dl className="mt-2 space-y-1.5">{children}</dl>
    </section>
  );
}

function ReviewRow({ label, value, empty, multiline }: { label: string; value: string; empty: string; multiline?: boolean }) {
  return (
    <div className="grid gap-0.5 text-[12.5px] sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cn(value ? "text-fg" : "italic text-faint", multiline && "whitespace-pre-line", "break-words")}>{value || empty}</dd>
    </div>
  );
}
