"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { Check, Copy, Share } from "@/components/Icons";
import { cn } from "@/lib/cn";

/** Share block of a post: copy its canonical link, plus the device's own share
 *  sheet where the browser has one (phones, Safari). No social-network widget,
 *  so nothing loads from a third party. `compact` is the desktop right-column
 *  size; the default keeps 40px touch targets. */
export function SharePost({ url, title, labels, compact, className }: {
  url: string;
  title: string;
  labels: { heading: string; copy: string; copied: string; shareVia: string };
  compact?: boolean;
  className?: string;
}) {
  const buttonSize = compact ? { size: "sm" as const } : { size: "md" as const, className: "h-10" };
  const [copied, setCopied] = useState(false);
  // Known only in the browser; the button appears after hydration.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => setCopied(true), () => {});
  };
  // Dismissing the sheet rejects; that is not an error worth showing.
  const share = () => navigator.share({ title, url }).catch(() => {});

  return (
    <section aria-label={labels.heading} className={cn("text-[13px]", className)}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{labels.heading}</div>
      <div className="flex flex-wrap gap-2">
        <Button {...buttonSize} variant="secondary" onClick={copy}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? labels.copied : labels.copy}
        </Button>
        {canShare && (
          <Button {...buttonSize} variant="secondary" onClick={share}>
            <Share size={13} /> {labels.shareVia}
          </Button>
        )}
      </div>
      <span role="status" className="sr-only">{copied ? labels.copied : ""}</span>
    </section>
  );
}
