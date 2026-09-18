"use client";

import Script from "next/script";
import { usePathname } from "@/i18n/navigation";

/** Loads the Microsoft Clarity tag everywhere EXCEPT the admin console —
 *  we want buyer/seller behaviour, not our own back-office sessions.
 *  Rendered only when the server found a valid CLARITY_PROJECT_ID. */
export default function ClarityTag({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${JSON.stringify(projectId)});`}
    </Script>
  );
}
