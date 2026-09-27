"use client";

/** Prepared Q&A as question/answer pairs instead of one text box with a
 *  blank-line convention. The stored value stays the same text format
 *  (lib/faq-text), so saving and the admin editor are unchanged. */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { faqToText, parseFaqBlocks, type FaqPair } from "@/lib/faq-text";
import { Button, Input, Textarea } from "@/components/ui";
import { Plus, X } from "@/components/Icons";

const complete = (pair: FaqPair) => pair.q.trim() !== "" && pair.a.trim() !== "";

export function FaqPairsEditor({ value, onChange, max }: { value: string; onChange: (text: string) => void; max: number }) {
  const t = useTranslations("sellerProductForm.content");
  // The text this editor last produced; anything else (another language tab)
  // is parsed again, while half-typed pairs survive our own round trips.
  const [source, setSource] = useState(value);
  const [pairs, setPairs] = useState<FaqPair[]>(() => parseFaqBlocks(value));
  if (value !== source) {
    setSource(value);
    setPairs(parseFaqBlocks(value));
  }

  const update = (next: FaqPair[]) => {
    setPairs(next);
    // A blank line would split an answer into two pairs, so answers keep single line breaks.
    const text = faqToText(next.filter(complete).map((p) => ({ q: p.q.trim(), a: p.a.replace(/\n\s*\n/g, "\n").trim() })));
    setSource(text);
    onChange(text);
  };

  return (
    <div className="space-y-2.5">
      {pairs.map((pair, index) => (
        <div key={index} className="rounded-lg border border-line bg-raised/30 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-2.5 font-mono text-[11px] text-faint">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1 space-y-2">
              <Input
                value={pair.q}
                onChange={(e) => update(pairs.map((p, i) => (i === index ? { ...p, q: e.target.value } : p)))}
                placeholder={t("faqQuestionPlaceholder")}
                aria-label={t("faqQuestion", { n: index + 1 })}
                maxLength={200}
              />
              <Textarea
                rows={2}
                value={pair.a}
                onChange={(e) => update(pairs.map((p, i) => (i === index ? { ...p, a: e.target.value } : p)))}
                placeholder={t("faqAnswerPlaceholder")}
                aria-label={t("faqAnswer", { n: index + 1 })}
                maxLength={1000}
              />
              {!complete(pair) && (pair.q || pair.a) && <p className="text-[11.5px] text-warn">{t("faqIncomplete")}</p>}
            </div>
            <button
              type="button"
              onClick={() => update(pairs.filter((_, i) => i !== index))}
              aria-label={t("faqRemove", { n: index + 1 })}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint hover:bg-bad-soft hover:text-bad"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      ))}
      {pairs.length < max && (
        <Button type="button" size="sm" variant="secondary" onClick={() => setPairs([...pairs, { q: "", a: "" }])} className="gap-1.5">
          <Plus size={14} /> {t("faqAdd")}
        </Button>
      )}
    </div>
  );
}
