"use client";

/** `<input type="date">` for filters. Typing a date by hand passes through
 *  half-typed values ("0002-10-06"…); this keeps them in the field and only
 *  hands the filter a complete date (after a short pause, or at once on blur
 *  / Enter / clear), so the list does not refetch and jump on every keystroke. */

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { committableDate } from "@/lib/date-input";
import { Input } from "@/components/ui";

const TYPING_PAUSE_MS = 450;

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> & {
  value: string;
  onCommit: (value: string) => void;
  min?: string | null;
  max?: string | null;
};

export function DateInput({ value, onCommit, min, max, onBlur, onKeyDown, ...props }: DateInputProps) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(value);

  // A new value from outside (reset, back button) replaces the draft.
  useEffect(() => {
    committed.current = value;
    setDraft(value);
  }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = (raw: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = committableDate(raw, { min, max });
    if (next === null || next === committed.current) return;
    committed.current = next;
    onCommit(next);
  };

  return (
    <Input
      {...props}
      type="date"
      value={draft}
      min={min ?? undefined}
      max={max ?? undefined}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (timer.current) clearTimeout(timer.current);
        // Clearing applies at once; a date waits for a pause in typing.
        if (raw === "") commit(raw);
        else timer.current = setTimeout(() => commit(raw), TYPING_PAUSE_MS);
      }}
      onBlur={(e) => {
        commit(draft);
        // Leaving a half-typed date restores the filter that is applied.
        if (committableDate(draft, { min, max }) === null) setDraft(committed.current);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(draft);
        onKeyDown?.(e);
      }}
    />
  );
}
