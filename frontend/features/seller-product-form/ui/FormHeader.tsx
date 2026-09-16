"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Tag } from "@/components/ui";

/** Sticky page header: title + status + one line of "what is left", with the
 *  primary actions on the right. */
export function FormHeader({
  backHref, backLabel, title, tags, meta, actions,
}: {
  backHref: string;
  backLabel: string;
  title: ReactNode;
  tags?: ReactNode;
  meta?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header className="sticky top-[65px] z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-base/95 px-1 py-3 backdrop-blur">
      <div className="min-w-0">
        <Link href={backHref} className="text-[12px] font-medium text-muted transition-colors hover:text-fg">← {backLabel}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h1 className="font-serif text-[20px] font-semibold tracking-tight text-fg">{title}</h1>
          {tags}
        </div>
        {meta && <div className="mt-0.5 text-[12px] text-muted">{meta}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

export function StatusTag({ tone, children }: { tone: "good" | "warn" | "bad" | "neutral" | "iris"; children: ReactNode }) {
  return <Tag tone={tone}>{children}</Tag>;
}
