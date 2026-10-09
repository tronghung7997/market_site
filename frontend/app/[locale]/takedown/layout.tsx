import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";
import { TakedownShell } from "@/features/takedown";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return privatePageMetadata(params, "takedown");
}

/* Link takedown: dashboard, request list, new link and request
   pages share one frame — title, section menu, "new takedown" action. */
export default function TakedownLayout({ children }: { children: ReactNode }) {
  return <TakedownShell>{children}</TakedownShell>;
}
