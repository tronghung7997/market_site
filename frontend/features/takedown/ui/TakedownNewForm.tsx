"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { cn } from "@/lib/cn";
import { Button, Card, Field, InlineNotice, Input, Textarea } from "@/components/ui";
import { AlertCircle } from "@/components/Icons";
import { NOTE_MAX, SERVICES, URL_MAX, WARRANTY_HOURS, type TakedownService, type TakedownWarrantyHours } from "../model";
import { useCreateTakedown } from "../useTakedown";
import { useServiceLabel, useWarrantyLabel } from "./parts";

/** The link, the kind of violation, a warranty and an optional note — nothing is looked up here; the partner reviews it when quoting. */
export function TakedownNewForm() {
  const t = useTranslations("takedown");
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const serviceLabel = useServiceLabel();
  const warrantyLabel = useWarrantyLabel();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [service, setService] = useState<TakedownService>("article_copyright");
  const [warranty, setWarranty] = useState<TakedownWarrantyHours>(24);
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const create = useCreateTakedown();
  const empty = !url.trim();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setFailure(null);
    if (empty) return;
    try {
      const request = await create.mutateAsync({ url: url.trim(), note: note.trim() || null, service, warranty_hours: warranty });
      router.push(`/takedown/requests/${request.code}?sent=1`);
    } catch (err) {
      setFailure(errorMessage(err, t("form.errGeneric")));
    }
  };

  return (
    <form onSubmit={onSubmit} className="max-w-[760px]" noValidate>
      <Card className="flex flex-col gap-6 p-5 sm:p-6">
        <h2 className="text-[18px] font-semibold text-fg">{t("form.title")}</h2>

        <Field label={t("form.link")} hint={t("form.linkHint")} error={touched && empty ? t("form.errEmpty") : undefined}>
          <Input
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            maxLength={URL_MAX}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t("form.linkPlaceholder")}
            aria-invalid={(touched && empty) || undefined}
            className="h-12 font-mono text-[14px]"
          />
        </Field>

        <ChoiceGroup
          legend={t("form.service")}
          value={service}
          options={SERVICES.map((s) => ({ value: s, label: serviceLabel(s) }))}
          onChange={setService}
        />

        <ChoiceGroup
          legend={t("form.warranty")}
          hint={t("form.warrantyHint")}
          value={warranty}
          options={WARRANTY_HOURS.map((h) => ({ value: h, label: warrantyLabel(h) }))}
          onChange={setWarranty}
        />

        <Field label={t("form.note")} hint={t("form.noteHint")}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={NOTE_MAX} placeholder={t("form.notePlaceholder")} />
        </Field>

        {failure && <InlineNotice tone="bad" icon={<AlertCircle size={13} aria-hidden />}>{failure}</InlineNotice>}

        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
          <p className="min-w-0 flex-1 basis-64 text-[13px] text-muted">{t("form.noCharge")}</p>
          <Button type="submit" size="lg" loading={create.isPending}>{t("form.submit")}</Button>
        </div>
      </Card>
    </form>
  );
}

/** Single-choice pill group backed by native radios (keyboard and screen-reader friendly). */
function ChoiceGroup<T extends string | number>({
  legend, hint, value, options, onChange,
}: { legend: string; hint?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[13px] font-medium text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={String(o.value)}
              className={cn(
                "flex h-11 cursor-pointer items-center rounded-lg border px-4 text-[14px] font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-iris",
                checked ? "border-iris bg-iris-soft text-iris-hi" : "border-line-2 bg-surface text-fg hover:border-faint",
              )}
            >
              <input type="radio" name={name} className="sr-only" checked={checked} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          );
        })}
      </div>
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </fieldset>
  );
}
